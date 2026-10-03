import { db } from './db';
import { type ReviewRow, type FindingRow } from './rows';
import { countsForReview } from './commits';
import { triageMapForRepo, quiets } from './triage';
import { fingerprint } from './fingerprint';
import { fmtAgo, fmtDate, fmtDur, SEVERITIES, countSeverities } from '$lib/format';
import type { Finding, ResolvedFinding, ReviewDetail, ReviewSummary } from '$lib/types';

// SQL severity ordering, derived from SEVERITIES so it can't drift from SEV_RANK.
// SEVERITIES holds only fixed internal keys, so interpolation here is injection-safe.
export const SEV_ORDER_SQL = `CASE severity ${SEVERITIES.map((s, i) => `WHEN '${s}' THEN ${i}`).join(' ')} ELSE ${SEVERITIES.length} END`;

/** Existing review id whose content matches `hash` (repo-scoped), or null. A scan's
 *  content hash (commit + model + engine + finding set) is its identity, so this
 *  drives idempotent resubmits — a delivery retry returns the existing review. */
export function findReviewByHash(repoId: string, hash: string): string | null {
	const row = db
		.prepare('SELECT id FROM reviews WHERE repo_id = ? AND content_hash = ? LIMIT 1')
		.get(repoId, hash) as { id: string } | undefined;
	return row?.id ?? null;
}

export function reviewSummary(rv: ReviewRow, now: number): ReviewSummary {
	const counts = countsForReview(rv.id);
	return {
		id: rv.id,
		repoId: rv.repo_id,
		commit: rv.commit_hash,
		model: rv.model,
		prevCommit: rv.prev_commit,
		trigger: rv.trigger,
		createdAt: rv.created_at,
		dateLabel: fmtDate(rv.created_at),
		agoLabel: fmtAgo(rv.created_at, now),
		durationLabel: fmtDur(rv.duration_secs),
		durationSecs: rv.duration_secs,
		counts,
		clean: counts.total === 0,
		newCount: rv.new_count,
		resolvedCount: rv.resolved_count,
		hasDelta: rv.new_count > 0 || rv.resolved_count > 0
	};
}

export interface ListReviewsOpts {
	repoId?: string;
	/** Inclusive lower bound on created_at (ms). */
	since?: number;
	/** Inclusive upper bound on created_at (ms). */
	until?: number;
	/** Max rows (clamped 1..1000, default 200). */
	limit?: number;
}

/**
 * Reviews across all repos (or one repo), newest first. Each row carries its
 * severity counts plus new/resolved deltas, so a consumer can build any trend
 * or analytics view it likes.
 */
export function listReviews(opts: ListReviewsOpts = {}, now = Date.now()): ReviewSummary[] {
	const where: string[] = [];
	const params: (string | number)[] = [];
	if (opts.repoId) {
		where.push('repo_id = ?');
		params.push(opts.repoId);
	}
	if (typeof opts.since === 'number' && Number.isFinite(opts.since)) {
		where.push('created_at >= ?');
		params.push(opts.since);
	}
	if (typeof opts.until === 'number' && Number.isFinite(opts.until)) {
		where.push('created_at <= ?');
		params.push(opts.until);
	}
	const limit = Math.max(1, Math.min(1000, Math.floor(opts.limit ?? 200)));
	const sql =
		`SELECT * FROM reviews ${where.length ? 'WHERE ' + where.join(' AND ') : ''}` +
		' ORDER BY created_at DESC LIMIT ?';
	const rows = db.prepare(sql).all(...params, limit) as unknown as ReviewRow[];
	return rows.map((rv) => reviewSummary(rv, now));
}

export function getReviewDetail(reviewId: string, now = Date.now()): ReviewDetail | null {
	const rv = db.prepare('SELECT * FROM reviews WHERE id = ?').get(reviewId) as ReviewRow | undefined;
	if (!rv) return null;
	const rows = db
		.prepare(`SELECT * FROM findings WHERE review_id = ? ORDER BY ${SEV_ORDER_SQL}, id`)
		.all(reviewId) as unknown as FindingRow[];

	// Runs of this repo up to and including this review, oldest first. "Open N runs"
	// counts the distinct *commits* (code states) a finding has spanned since it was
	// first seen — not raw scan rows, so re-scanning one commit several times (LLM
	// re-runs, multiple models) doesn't inflate it.
	const runRows = db
		.prepare('SELECT created_at, commit_hash FROM reviews WHERE repo_id = ? AND created_at <= ?')
		.all(rv.repo_id, rv.created_at) as { created_at: number; commit_hash: string }[];

	// Human triage verdicts for this repo, joined onto findings by fingerprint below.
	const triage = triageMapForRepo(rv.repo_id);

	// Rows are locations; an issue is every row sharing an identity (`fingerprint`). Rows
	// arrive most severe first, then in insertion order, so each issue's first row is its
	// primary location and the issues come out in severity order.
	const byIssue = new Map<string, FindingRow[]>();
	for (const r of rows) {
		const locs = byIssue.get(r.fingerprint);
		if (locs) locs.push(r);
		else byIssue.set(r.fingerprint, [r]);
	}

	const findings: Finding[] = [...byIssue.values()].map((locs) => {
		const f = locs[0];
		const ageHours = Math.max(0, (rv.created_at - f.first_seen_at) / 3_600_000);
		const openRuns = Math.max(
			1,
			new Set(
				runRows.filter((r) => r.created_at >= f.first_seen_at).map((r) => r.commit_hash)
			).size
		);
		return {
			severity: f.severity,
			title: f.title,
			file: f.file,
			line: f.line,
			cwe: f.cwe,
			description: f.description,
			code: f.code,
			recommendation: f.recommendation,
			ruleId: f.rule_id,
			locationKey: f.location_key,
			locations: locs
				.map((l) => ({ file: l.file, line: l.line, locationKey: l.location_key }))
				.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line),
			isNew: locs.some((l) => l.is_new === 1),
			openRuns,
			ageHours: Math.round(ageHours),
			fingerprint: f.fingerprint,
			triage: triage.get(f.fingerprint) ?? null
		};
	});

	// Quiet dismissed issues from the band counts — they remain in `findings` (dimmed),
	// just don't tally toward the severity totals shown above the list.
	const open = findings.filter((f) => !quiets(f.triage));
	const counts = countSeverities(open);
	const quietedCount = findings.length - open.length;
	let stored: (Omit<ResolvedFinding, 'fingerprint'> & { fingerprint?: string })[] = [];
	try {
		stored = JSON.parse(rv.resolved_json);
	} catch {
		stored = [];
	}
	// Entries written before identities were stored lack `fingerprint`; every finding was
	// keyed on the legacy file+title fingerprint then. A dismissed finding the agent later
	// stops reporting must not read as a "fix".
	const resolved: ResolvedFinding[] = stored
		.map((rf) => ({ ...rf, fingerprint: rf.fingerprint ?? fingerprint(rf.file, rf.title) }))
		.filter((rf) => !quiets(triage.get(rf.fingerprint)));

	const summary = reviewSummary(rv, now);
	return {
		...summary,
		counts,
		quietedCount,
		engine: rv.engine,
		agentVersion: rv.agent_version,
		summary: rv.summary,
		lines: rv.lines,
		filesScanned: rv.files_scanned,
		findings,
		resolved,
		html: rv.html,
		diff: {
			newCount: rv.new_count,
			carriedCount: findings.length - rv.new_count,
			resolvedCount: rv.resolved_count
		},
		hasPrev: !!rv.prev_commit
	};
}
