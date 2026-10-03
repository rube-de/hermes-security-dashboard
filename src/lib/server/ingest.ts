import { randomUUID } from 'node:crypto';
import { db } from './db';
import { getRepoRow } from './repos';
import { repoHead, unionFindingsForCommit } from './commits';
import { findReviewByHash } from './reviews';
import { fingerprint } from './fingerprint';
import { canonicalFindings, contentHash } from './content-hash';
import { sanitizeReportHtml } from './sanitize';
import type { ResolvedFinding, Severity } from '$lib/types';

export interface FindingInput {
	severity: Severity;
	title: string;
	file?: string;
	line?: number;
	cwe?: string;
	description?: string;
	code?: string;
	recommendation?: string;
	/** Detector/rule id from the tool that raised the finding (e.g. `reentrancy-eth`). */
	ruleId?: string;
	/** Enclosing function or symbol of the finding (e.g. `Vault.withdraw`). */
	locationKey?: string;
}

export interface ReviewInput {
	commit: string;
	model?: string;
	trigger?: string;
	engine?: string;
	summary?: string;
	html?: string;
	durationSecs?: number;
	lines?: number;
	filesScanned?: number;
	createdAt?: number;
	findings?: FindingInput[];
	/** Version of the agent that produced the review; '' when unreported. */
	agentVersion?: string;
}

export function tx<T>(fn: () => T): T {
	db.exec('BEGIN');
	try {
		const r = fn();
		db.exec('COMMIT');
		return r;
	} catch (e) {
		db.exec('ROLLBACK');
		throw e;
	}
}

export function insertReview(
	repoId: string,
	input: ReviewInput
): { id: string; duplicate: boolean } {
	const repo = getRepoRow(repoId);
	if (!repo) throw new Error(`unknown repo: ${repoId}`);

	const now = input.createdAt ?? Date.now();
	const reviewId = randomUUID();
	const model = input.model ?? '';
	const engine = input.engine ?? 'slither+semgrep+llm';
	// Reduce to the canonical finding set used for BOTH storage and identity: drop
	// unknown severities, then collapse same-fingerprint findings to the most severe
	// (otherwise the same issue emitted twice would inflate new_count and the per-
	// review totals while the deduped union counts it once). contentHash() applies the
	// identical reduction, so the rows we store match the hash we dedup on — and a
	// migration backfill of a legacy row lands on the hash a faithful resubmit yields.
	const findings = canonicalFindings(input.findings ?? []);

	// Idempotent on scan content, not (repo, commit): a commit can be scanned many
	// times. A resubmit with the same content (commit + model + engine + finding set)
	// is an at-least-once delivery retry — return the existing review unchanged.
	const hash = contentHash({
		commit: input.commit,
		model,
		engine,
		findings: findings.map((f) => ({ severity: f.severity, file: f.file, title: f.title }))
	});
	const dup = findReviewByHash(repoId, hash);
	if (dup) return { id: dup, duplicate: true };

	// `is_new` means "the first time this fingerprint has ever been seen in this repo",
	// NOT "new since the previous commit". This is independent of whether the scan is a
	// re-scan: a second model that uniquely surfaces an issue genuinely discovered it,
	// so it counts as new — while a re-scan that merely re-reports known findings adds
	// nothing. It is keyed on the EXISTENCE of an earlier finding row (seen.m === null),
	// not on a timestamp equality, so two sibling scans landing in the same millisecond
	// don't both claim the discovery. Because a fingerprint is new on exactly one row,
	// getTrends can sum new_count over every row without double-counting. firstSeen is
	// clamped with the earliest known time so a finding's stored first_seen_at never
	// post-dates its own review.
	const prepared = findings.map((f) => {
		const file = f.file ?? '';
		const fp = fingerprint(file, f.title);
		const seen = db
			.prepare('SELECT MIN(first_seen_at) AS m FROM findings WHERE repo_id = ? AND fingerprint = ?')
			.get(repoId, fp) as { m: number | null };
		const firstSeen = seen.m === null ? now : Math.min(seen.m, now);
		return { f, file, fp, isNew: seen.m === null, firstSeen };
	});
	const newCount = prepared.filter((p) => p.isNew).length;

	// `resolved` is a code-state transition, so only a commit's FIRST scan computes it,
	// against the union of the PREVIOUS head commit (the code state immediately before
	// this one). Re-scans of a commit carry no resolved delta — dropping a finding a
	// sibling scan flagged isn't a fix, and the union keeps it. Using the previous
	// commit's union (not a single prior scan) makes the delta independent of which
	// model's scan happened to run last, matching the headline status.
	const isFirstScanOfCommit = !db
		.prepare('SELECT 1 FROM reviews WHERE repo_id = ? AND commit_hash = ? LIMIT 1')
		.get(repoId, input.commit);
	const prevCommit = isFirstScanOfCommit ? (repoHead(repoId, input.commit)?.commit ?? null) : null;
	const curFps = new Set(prepared.map((p) => p.fp));
	const resolved: ResolvedFinding[] = prevCommit
		? unionFindingsForCommit(repoId, prevCommit)
				.filter((f) => !curFps.has(f.fingerprint))
				.map((f) => ({ severity: f.severity, title: f.title, file: f.file }))
		: [];

	const lines = input.lines ?? repo.lines;
	const html = input.html ? sanitizeReportHtml(input.html) : null;

	tx(() => {
		db.prepare(
			`INSERT INTO reviews
			 (id, repo_id, commit_hash, model, trigger, engine, summary, html, duration_secs, lines,
			  files_scanned, prev_commit, new_count, resolved_count, resolved_json, content_hash,
			  agent_version, created_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
		).run(
			reviewId,
			repoId,
			input.commit,
			model,
			input.trigger ?? 'Scheduled',
			engine,
			input.summary ?? '',
			html,
			input.durationSecs ?? 0,
			lines,
			input.filesScanned ?? 0,
			prevCommit,
			newCount,
			resolved.length,
			JSON.stringify(resolved),
			hash,
			input.agentVersion ?? '',
			now
		);

		const ins = db.prepare(
			`INSERT INTO findings
			 (review_id, repo_id, severity, title, file, line, cwe, description, code,
			  recommendation, fingerprint, is_new, first_seen_at, rule_id, location_key)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
		);
		for (const p of prepared) {
			ins.run(
				reviewId,
				repoId,
				p.f.severity,
				p.f.title,
				p.file,
				p.f.line ?? 0,
				p.f.cwe ?? '',
				p.f.description ?? '',
				p.f.code ?? '',
				p.f.recommendation ?? '',
				p.fp,
				p.isNew ? 1 : 0,
				p.firstSeen,
				p.f.ruleId ?? '',
				p.f.locationKey ?? ''
			);
		}
	});

	return { id: reviewId, duplicate: false };
}
