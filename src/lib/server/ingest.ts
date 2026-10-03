import { randomUUID } from 'node:crypto';
import { db } from './db';
import { getRepoRow } from './repos';
import { repoHead, unionFindingsForCommit } from './commits';
import { findReviewByHash } from './reviews';
import { canonicalFindings, issueIdentity } from './fingerprint';
import { contentHash } from './content-hash';
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
	// Store every finding: canonicalFindings() only drops unknown severities and collapses
	// exact duplicates (same issue identity at the same line + locationKey). Several
	// locations of one issue are separate rows sharing a `fingerprint` (the identity); the
	// counts, the diff, the union and triage all key on that identity, never on rows.
	const findings = canonicalFindings(input.findings ?? []);

	// Idempotent on scan content, not (repo, commit): a commit can be scanned many
	// times. A resubmit with the same content (commit + model + engine + issue set)
	// is an at-least-once delivery retry — return the existing review unchanged.
	const hash = contentHash({ commit: input.commit, model, engine, findings });
	const dup = findReviewByHash(repoId, hash);
	if (dup) return { id: dup, duplicate: true };

	// `is_new` means "the first time this identity has ever been seen in this repo",
	// NOT "new since the previous commit". This is independent of whether the scan is a
	// re-scan: a second model that uniquely surfaces an issue genuinely discovered it,
	// so it counts as new — while a re-scan that merely re-reports known findings adds
	// nothing. It is keyed on the EXISTENCE of an earlier finding row (seen.m === null),
	// not on a timestamp equality, so two sibling scans landing in the same millisecond
	// don't both claim the discovery. An identity is new on exactly one row (its first
	// location in its first review), so new_count counts issues and getTrends can sum it
	// over every row without double-counting. firstSeen is clamped with the earliest known
	// time so a finding's stored first_seen_at never post-dates its own review; every
	// location of an issue shares it.
	const earliest = new Map<string, number | null>();
	const newIds = new Set<string>();
	const prepared = findings.map((f) => {
		const fp = issueIdentity(f);
		if (!earliest.has(fp)) {
			const seen = db
				.prepare('SELECT MIN(first_seen_at) AS m FROM findings WHERE repo_id = ? AND fingerprint = ?')
				.get(repoId, fp) as { m: number | null };
			earliest.set(fp, seen.m);
		}
		const m = earliest.get(fp) ?? null;
		const isNew = m === null && !newIds.has(fp);
		if (isNew) newIds.add(fp);
		return { f, file: f.file ?? '', fp, isNew, firstSeen: m === null ? now : Math.min(m, now) };
	});
	const newCount = newIds.size;

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
				.map((f) => ({
					severity: f.severity,
					title: f.title,
					file: f.file,
					fingerprint: f.fingerprint
				}))
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
