import { randomUUID } from 'node:crypto';
import { db } from './db';
import { fingerprint } from './fingerprint';
import { canonicalFindings, contentHash } from './content-hash';
import { sanitizeReportHtml } from './sanitize';
import {
	countSeverities,
	emptyCounts,
	fmtAgo,
	fmtDate,
	fmtDur,
	fmtUntil,
	langColor,
	sevPills,
	SEV_LABEL,
	SEV_RANK,
	SEVERITIES,
	statusColor
} from '$lib/format';
import type {
	Finding,
	Overview,
	RepoDetail,
	RepoSummary,
	ResolvedFinding,
	ReviewDetail,
	ReviewSummary,
	ScanState,
	Severity,
	SeverityCounts,
	Triage,
	TriageStatus,
	TrendBucket,
	TrendPoint
} from '$lib/types';

const VALID_SEV = new Set<Severity>(['crit', 'high', 'med', 'low']);
const VALID_TRIAGE = new Set<TriageStatus>(['acknowledged', 'false_positive', 'accepted_risk']);
// The two verdicts that "quiet" a finding — drop it from actionable counts and a repo's
// flagged/clean status at read time. `acknowledged` is deliberately NOT here: it marks a
// finding as seen-but-real, so it keeps counting.
const QUIETING = new Set<TriageStatus>(['false_positive', 'accepted_risk']);
function quiets(t: { status: TriageStatus } | null | undefined): boolean {
	return !!t && QUIETING.has(t.status);
}

interface RepoRow {
	id: string;
	lang: string;
	description: string;
	path: string;
	branch: string;
	lines: number;
	created_at: number;
}

interface ReviewRow {
	id: string;
	repo_id: string;
	commit_hash: string;
	model: string;
	trigger: string;
	engine: string;
	summary: string;
	html: string | null;
	duration_secs: number;
	lines: number;
	files_scanned: number;
	prev_commit: string | null;
	new_count: number;
	resolved_count: number;
	resolved_json: string;
	content_hash: string | null;
	created_at: number;
}

interface FindingRow {
	id: number;
	review_id: string;
	repo_id: string;
	severity: Severity;
	title: string;
	file: string;
	line: number;
	cwe: string;
	description: string;
	code: string;
	recommendation: string;
	fingerprint: string;
	is_new: number;
	first_seen_at: number;
}

/* ------------------------------------------------------------------ */
/* meta                                                                */
/* ------------------------------------------------------------------ */

export function getMeta(key: string, fallback: string): string {
	const row = db.prepare('SELECT value FROM meta WHERE key = ?').get(key) as
		| { value: string }
		| undefined;
	return row?.value ?? fallback;
}

export function setMeta(key: string, value: string): void {
	db.prepare(
		'INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
	).run(key, value);
}

/** Persist the agent-reported next planned run (epoch-ms). null/≤0 clears it. */
export function setNextRun(at: number | null): void {
	setMeta('next_run_at', String(at && at > 0 ? at : 0));
}

/* ------------------------------------------------------------------ */
/* re-run requests (user asks; the agent picks them up next cycle)     */
/* ------------------------------------------------------------------ */

/** Record a user request to re-review `repoId` on the next Hermes cycle. */
export function requestRerun(repoId: string, at = Date.now()): number {
	setMeta(`rerun_req:${repoId}`, String(at));
	return at;
}

/** Pending re-run request timestamp for `repoId`, or null if none. */
export function getRerunRequest(repoId: string): number | null {
	const v = getMeta(`rerun_req:${repoId}`, '');
	return v ? Number(v) : null;
}

/* ------------------------------------------------------------------ */
/* repos                                                               */
/* ------------------------------------------------------------------ */

export interface RepoInput {
	id: string;
	lang: string;
	description?: string;
	path?: string;
	branch?: string;
	lines?: number;
}

export function addRepo(input: RepoInput, createdAt = Date.now()): void {
	db.prepare(
		`INSERT INTO repos (id, lang, description, path, branch, lines, created_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?)
		 ON CONFLICT(id) DO UPDATE SET
		   lang = excluded.lang,
		   description = excluded.description,
		   path = excluded.path,
		   branch = excluded.branch,
		   lines = excluded.lines`
	).run(
		input.id,
		input.lang,
		input.description ?? '',
		input.path ?? `oasisprotocol/${input.id}`,
		input.branch ?? 'main',
		input.lines ?? 0,
		createdAt
	);
}

function getRepoRow(id: string): RepoRow | undefined {
	return db.prepare('SELECT * FROM repos WHERE id = ?').get(id) as RepoRow | undefined;
}

function allRepoRows(): RepoRow[] {
	return db.prepare('SELECT * FROM repos ORDER BY created_at ASC').all() as unknown as RepoRow[];
}

/** Cheap existence check for endpoints that only need to 404 on an unknown repo —
 *  avoids the full summary build (head union + all review rows) getRepoDetail does. */
export function repoExists(id: string): boolean {
	return !!db.prepare('SELECT 1 FROM repos WHERE id = ? LIMIT 1').get(id);
}

/* ------------------------------------------------------------------ */
/* counts / latest review                                              */
/* ------------------------------------------------------------------ */

function countsForReview(reviewId: string): SeverityCounts {
	const rows = db
		.prepare('SELECT severity, COUNT(*) AS n FROM findings WHERE review_id = ? GROUP BY severity')
		.all(reviewId) as { severity: Severity; n: number }[];
	const c = emptyCounts();
	for (const r of rows) if (VALID_SEV.has(r.severity)) c[r.severity] = r.n;
	c.total = c.crit + c.high + c.med + c.low;
	return c;
}

interface UnionFinding {
	fingerprint: string;
	severity: Severity;
	title: string;
	file: string;
}

/**
 * The deduped finding set for a repo's commit, unioned across every scan of that
 * commit. A commit can be scanned multiple times (non-deterministic re-runs,
 * different models); a finding any scan flagged is kept, and on a severity
 * disagreement the most severe rating wins. Deduped by fingerprint so the same
 * issue seen by two models counts once — hiding a real issue because the latest
 * model happened to miss it is the wrong failure mode for a security board. This
 * is the single source for both the headline status and a later commit's diff base.
 */
function unionFindingsForCommit(repoId: string, commit: string): UnionFinding[] {
	const rows = db
		.prepare(
			`SELECT f.fingerprint AS fingerprint, f.severity AS severity, f.title AS title, f.file AS file
			   FROM findings f JOIN reviews r ON f.review_id = r.id
			  WHERE r.repo_id = ? AND r.commit_hash = ?`
		)
		.all(repoId, commit) as { fingerprint: string; severity: Severity; title: string; file: string }[];
	const byFp = new Map<string, UnionFinding>();
	for (const row of rows) {
		if (!VALID_SEV.has(row.severity)) continue;
		const cur = byFp.get(row.fingerprint);
		if (!cur) byFp.set(row.fingerprint, { ...row });
		else if (SEV_RANK[row.severity] < SEV_RANK[cur.severity]) cur.severity = row.severity;
	}
	return [...byFp.values()];
}

/** Newest scan of a specific commit. Drives the repo card's "last scan" labels (so
 *  they describe the same commit the headline counts come from). rowid DESC breaks
 *  created_at ties deterministically. */
function latestReviewRowForCommit(repoId: string, commit: string): ReviewRow | undefined {
	return db
		.prepare(
			'SELECT * FROM reviews WHERE repo_id = ? AND commit_hash = ? ORDER BY created_at DESC, rowid DESC LIMIT 1'
		)
		.get(repoId, commit) as ReviewRow | undefined;
}

/**
 * The repo's current commit and how many times it has been scanned. "Current" is
 * the most-recently-*introduced* commit — the one whose first scan is newest — not
 * simply the newest scan row, so re-scanning an OLDER commit (a different model on
 * historic code) can't hijack the headline status to a stale code state. `exclude`
 * drops a commit, used to find the previous head as a first scan's diff base.
 */
function repoHead(repoId: string, exclude?: string): { commit: string; scans: number } | null {
	const tail =
		`${exclude ? 'AND commit_hash != ? ' : ''}` +
		'GROUP BY commit_hash ORDER BY MIN(created_at) DESC, MAX(rowid) DESC LIMIT 1';
	// `commit` is a SQLite keyword — keep the column name and rename in JS.
	const sql = `SELECT commit_hash, COUNT(*) AS scans FROM reviews WHERE repo_id = ? ${tail}`;
	const stmt = db.prepare(sql);
	const row = (exclude ? stmt.get(repoId, exclude) : stmt.get(repoId)) as
		| { commit_hash: string; scans: number }
		| undefined;
	return row ? { commit: row.commit_hash, scans: row.scans } : null;
}

/** Existing review id whose content matches `hash` (repo-scoped), or null. A scan's
 *  content hash (commit + model + engine + finding set) is its identity, so this
 *  drives idempotent resubmits — a delivery retry returns the existing review. */
export function findReviewByHash(repoId: string, hash: string): string | null {
	const row = db
		.prepare('SELECT id FROM reviews WHERE repo_id = ? AND content_hash = ? LIMIT 1')
		.get(repoId, hash) as { id: string } | undefined;
	return row?.id ?? null;
}

/* ------------------------------------------------------------------ */
/* summaries                                                           */
/* ------------------------------------------------------------------ */

function buildRepoSummary(repo: RepoRow, scanRepoId: string | null, now: number): RepoSummary {
	// The card describes the *current code state* = the head commit (the most
	// recently introduced one). Status counts AND the "last scan" labels both come
	// from that commit, so re-scanning an older commit — newer activity, but stale
	// code — changes neither. `head.scan` is the head commit's most recent scan.
	const head = repoHead(repo.id);
	const headScan = head ? latestReviewRowForCommit(repo.id, head.commit) : undefined;
	// Quiet triaged findings out of the headline status at read time: a repo whose findings
	// are all dismissed (false-positive / accepted-risk) reads clean; acknowledged keeps
	// counting. quietedCount preserves how many were hidden for the "N triaged" label.
	const union = head ? unionFindingsForCommit(repo.id, head.commit) : [];
	const triage = triageMapForRepo(repo.id);
	const open = union.filter((f) => !quiets(triage.get(f.fingerprint)));
	const counts = countSeverities(open);
	const quietedCount = union.length - open.length;
	const status: 'flagged' | 'clean' = counts.total > 0 ? 'flagged' : 'clean';
	return {
		id: repo.id,
		lang: repo.lang,
		description: repo.description,
		path: repo.path,
		branch: repo.branch,
		lines: repo.lines,
		langColor: langColor(repo.lang),
		counts,
		quietedCount,
		status,
		statusLabel:
			status === 'clean' ? 'Clean' : `${counts.total} issue${counts.total > 1 ? 's' : ''}`,
		clean: status === 'clean',
		glyph: status === 'clean' ? '[ok]' : '[!!]',
		scanning: scanRepoId === repo.id,
		lastRunLabel: headScan ? fmtAgo(headScan.created_at, now) : 'never',
		lastDurationLabel: headScan ? fmtDur(headScan.duration_secs) : '—',
		filesScanned: headScan?.files_scanned ?? 0,
		headCommit: head?.commit ?? null,
		headScanCount: head?.scans ?? 0
	};
}

export function listRepoSummaries(now = Date.now()): RepoSummary[] {
	const scan = getScan();
	const scanRepoId = scan.active ? scan.repoId : null;
	return allRepoRows().map((r) => buildRepoSummary(r, scanRepoId, now));
}

function reviewSummary(rv: ReviewRow, now: number): ReviewSummary {
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

export function getRepoDetail(id: string, now = Date.now()): RepoDetail | null {
	const repo = getRepoRow(id);
	if (!repo) return null;
	const scan = getScan();
	const summary = buildRepoSummary(repo, scan.active ? scan.repoId : null, now);
	const reviewRows = db
		.prepare('SELECT * FROM reviews WHERE repo_id = ? ORDER BY created_at DESC')
		.all(id) as unknown as ReviewRow[];
	return { ...summary, reviews: reviewRows.map((rv) => reviewSummary(rv, now)) };
}

/* ------------------------------------------------------------------ */
/* reviews list (flat, filterable — the raw material for trends)       */
/* ------------------------------------------------------------------ */

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

/* ------------------------------------------------------------------ */
/* review detail (with per-finding lifecycle + diff)                   */
/* ------------------------------------------------------------------ */

// SQL severity ordering, derived from SEVERITIES so it can't drift from SEV_RANK.
// SEVERITIES holds only fixed internal keys, so interpolation here is injection-safe.
const SEV_ORDER_SQL = `CASE severity ${SEVERITIES.map((s, i) => `WHEN '${s}' THEN ${i}`).join(' ')} ELSE ${SEVERITIES.length} END`;

/**
 * Every human triage verdict for a repo, keyed by finding fingerprint. One repo-scoped
 * PK query, joined onto findings at read time — a tag survives every agent re-run untouched
 * because insertReview never writes this table. Unknown statuses are dropped defensively.
 */
function triageMapForRepo(repoId: string): Map<string, Triage> {
	const rows = db
		.prepare(
			'SELECT fingerprint, status, note, created_at, updated_at FROM finding_triage WHERE repo_id = ?'
		)
		.all(repoId) as {
		fingerprint: string;
		status: TriageStatus;
		note: string;
		created_at: number;
		updated_at: number;
	}[];
	const m = new Map<string, Triage>();
	for (const r of rows) {
		if (!VALID_TRIAGE.has(r.status)) continue;
		m.set(r.fingerprint, {
			status: r.status,
			note: r.note,
			createdAt: r.created_at,
			updatedAt: r.updated_at
		});
	}
	return m;
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

	const findings: Finding[] = rows.map((f) => {
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
			isNew: f.is_new === 1,
			openRuns,
			ageHours: Math.round(ageHours),
			fingerprint: f.fingerprint,
			triage: triage.get(f.fingerprint) ?? null
		};
	});

	// Quiet dismissed findings from the band counts — they remain in `findings` (dimmed),
	// just don't tally toward the severity totals shown above the list.
	const openRows = rows.filter((f) => !quiets(triage.get(f.fingerprint)));
	const counts = countSeverities(openRows);
	const quietedCount = rows.length - openRows.length;
	let resolved: ResolvedFinding[] = [];
	try {
		resolved = JSON.parse(rv.resolved_json) as ResolvedFinding[];
	} catch {
		resolved = [];
	}
	// A dismissed finding the agent later stops reporting must not read as a "fix".
	resolved = resolved.filter((rf) => !quiets(triage.get(fingerprint(rf.file, rf.title))));

	const summary = reviewSummary(rv, now);
	return {
		...summary,
		counts,
		quietedCount,
		engine: rv.engine,
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

/* ------------------------------------------------------------------ */
/* finding triage (human verdicts; survive agent re-runs)              */
/* ------------------------------------------------------------------ */

/** Latest stored title/file for a finding identity, or null if no finding in the repo
 *  carries this fingerprint. The authoritative source for the tag-time snapshot. */
function findingIdentity(repoId: string, fp: string): { title: string; file: string } | null {
	const row = db
		.prepare(
			'SELECT title, file FROM findings WHERE repo_id = ? AND fingerprint = ? ORDER BY first_seen_at DESC, id DESC LIMIT 1'
		)
		.get(repoId, fp) as { title: string; file: string } | undefined;
	return row ?? null;
}

/**
 * Upsert a human triage verdict for a finding identity. Last-write-wins on the single
 * (repo_id, fingerprint) row; created_at is preserved across updates, updated_at moves.
 * Returns false WITHOUT writing if no finding in the repo carries this fingerprint, so the
 * caller can 404 rather than store an orphan tag. The fp_title/fp_file snapshot is taken
 * from the finding itself, not the caller, so it can't be spoofed.
 */
export function setTriage(
	repoId: string,
	fp: string,
	status: TriageStatus,
	note = '',
	at = Date.now()
): boolean {
	const ident = findingIdentity(repoId, fp);
	if (!ident) return false;
	db.prepare(
		`INSERT INTO finding_triage
		 (repo_id, fingerprint, status, note, fp_title, fp_file, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?)
		 ON CONFLICT(repo_id, fingerprint) DO UPDATE SET
		   status = excluded.status,
		   note = excluded.note,
		   updated_at = excluded.updated_at`
	).run(repoId, fp, status, note, ident.title, ident.file, at, at);
	return true;
}

/** Clear a finding's triage verdict (back to open/untriaged). Idempotent; returns whether
 *  a row was actually removed. */
export function clearTriage(repoId: string, fp: string): boolean {
	const r = db
		.prepare('DELETE FROM finding_triage WHERE repo_id = ? AND fingerprint = ?')
		.run(repoId, fp);
	return r.changes > 0;
}

/* ------------------------------------------------------------------ */
/* insert review (agent submission + seed)                             */
/* ------------------------------------------------------------------ */

export interface FindingInput {
	severity: Severity;
	title: string;
	file?: string;
	line?: number;
	cwe?: string;
	description?: string;
	code?: string;
	recommendation?: string;
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
}

function tx<T>(fn: () => T): T {
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
			  files_scanned, prev_commit, new_count, resolved_count, resolved_json, content_hash, created_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
			now
		);

		const ins = db.prepare(
			`INSERT INTO findings
			 (review_id, repo_id, severity, title, file, line, cwe, description, code,
			  recommendation, fingerprint, is_new, first_seen_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
				p.firstSeen
			);
		}
	});

	return { id: reviewId, duplicate: false };
}

/* ------------------------------------------------------------------ */
/* overview                                                            */
/* ------------------------------------------------------------------ */

export function getOverview(now = Date.now()): Overview {
	const repos = listRepoSummaries(now);
	const totals = emptyCounts();
	let quietedTotal = 0;
	for (const r of repos) {
		totals.crit += r.counts.crit;
		totals.high += r.counts.high;
		totals.med += r.counts.med;
		totals.low += r.counts.low;
		quietedTotal += r.quietedCount;
	}
	totals.total = totals.crit + totals.high + totals.med + totals.low;

	const flagged = repos.filter((r) => r.status === 'flagged').length;
	const reviewsAllTime =
		(db.prepare('SELECT COUNT(*) AS n FROM reviews').get() as { n: number }).n +
		Number(getMeta('reviews_base', '0'));
	const avgRow = db.prepare('SELECT AVG(duration_secs) AS a FROM reviews').get() as { a: number | null };
	const lastRow = db.prepare('SELECT MAX(created_at) AS m FROM reviews').get() as { m: number | null };

	// Next run is whatever the agent last reported (meta.next_run_at); there is no
	// fixed cadence to fall back on. Unset → null → "unscheduled".
	const storedNext = Number(getMeta('next_run_at', '0'));
	const nextRunAt = storedNext > 0 ? storedNext : null;
	const nextRunLabel = !nextRunAt
		? 'unscheduled'
		: nextRunAt - now < 60_000
			? 'due now'
			: `in ${fmtUntil(nextRunAt, now)}`;

	return {
		totals,
		quietedTotal,
		flagged,
		clean: repos.length - flagged,
		reposCount: repos.length,
		reviewsAllTime,
		avgScanLabel: avgRow.a ? fmtDur(avgRow.a) : '—',
		orgLabel: getMeta('org_label', 'Oasis Protocol'),
		lastRunLabel: lastRow.m ? fmtAgo(lastRow.m, now) : 'never',
		nextRunAt,
		nextRunLabel,
		trend: getTrends(14, {}, now).map((b) => ({ day: b.day, count: b.newFindings }) satisfies TrendPoint),
		repos
	};
}

/* ------------------------------------------------------------------ */
/* trends (daily aggregate time series)                                */
/* ------------------------------------------------------------------ */

function startOfLocalDay(ts: number): number {
	const d = new Date(ts);
	d.setHours(0, 0, 0, 0);
	return d.getTime();
}

/**
 * `n` local days from `ts` via calendar arithmetic (not fixed-ms). Starting at a
 * local midnight, the result is the local midnight `n` days away — correct across
 * DST transitions, where a "day" is 23 or 25 hours, not always 86_400_000 ms.
 */
function addLocalDays(ts: number, n: number): number {
	const d = new Date(ts);
	d.setDate(d.getDate() + n);
	return d.getTime();
}

/**
 * Daily new/resolved/review counts over the last `days` days (continuous,
 * zero-filled), aligned to local-day boundaries. Optionally scoped to one repo.
 * Aggregated from the denormalized per-review delta columns — cheap, no N+1.
 */
export function getTrends(days = 14, opts: { repoId?: string } = {}, now = Date.now()): TrendBucket[] {
	const span = Math.max(1, Math.min(365, Math.floor(days)));
	const today0 = startOfLocalDay(now);
	const since = addLocalDays(today0, -(span - 1));

	const where = ['created_at >= ?'];
	const params: (string | number)[] = [since];
	if (opts.repoId) {
		where.push('repo_id = ?');
		params.push(opts.repoId);
	}
	// Sum every row's stored delta. new_count counts findings seen for the first time
	// in the repo, so each fingerprint contributes new exactly once across all its
	// scans; resolved_count is non-zero only on a commit's first scan (see insertReview).
	// So neither side double-counts when a commit is scanned several times. `reviews`
	// counts every scan that ran, including re-scans.
	const rows = db
		.prepare(`SELECT created_at, new_count, resolved_count FROM reviews WHERE ${where.join(' AND ')}`)
		.all(...params) as unknown as {
		created_at: number;
		new_count: number;
		resolved_count: number;
	}[];

	const agg = new Map<number, { n: number; r: number; reviews: number }>();
	for (const row of rows) {
		const key = startOfLocalDay(row.created_at);
		const cur = agg.get(key) ?? { n: 0, r: 0, reviews: 0 };
		cur.n += row.new_count;
		cur.r += row.resolved_count;
		cur.reviews += 1;
		agg.set(key, cur);
	}

	const out: TrendBucket[] = [];
	for (let i = span - 1; i >= 0; i--) {
		const dayStart = addLocalDays(today0, -i);
		const d = new Date(dayStart);
		const a = agg.get(dayStart) ?? { n: 0, r: 0, reviews: 0 };
		out.push({
			day: `${d.getMonth() + 1}/${d.getDate()}`,
			date: dayStart,
			newFindings: a.n,
			resolvedFindings: a.r,
			reviews: a.reviews
		});
	}
	return out;
}

/* ------------------------------------------------------------------ */
/* scan (live active run)                                              */
/* ------------------------------------------------------------------ */

interface ScanRow {
	id: number;
	active: number;
	repo_id: string | null;
	commit_hash: string | null;
	current_file: string | null;
	progress: number;
	engine: string | null;
	started_at: number | null;
}

export function getScan(): ScanState {
	const r = db.prepare('SELECT * FROM scan WHERE id = 1').get() as ScanRow | undefined;
	if (!r || r.active !== 1) {
		return {
			active: false,
			repoId: null,
			commit: null,
			currentFile: null,
			progress: 0,
			engine: null,
			startedAt: null
		};
	}
	return {
		active: true,
		repoId: r.repo_id,
		commit: r.commit_hash,
		currentFile: r.current_file,
		progress: r.progress,
		engine: r.engine,
		startedAt: r.started_at
	};
}

export interface ScanInput {
	active: boolean;
	repoId?: string | null;
	commit?: string | null;
	currentFile?: string | null;
	progress?: number;
	engine?: string | null;
	startedAt?: number | null;
}

export function setScan(input: ScanInput): ScanState {
	if (!input.active) {
		db.prepare(
			`UPDATE scan SET active = 0, repo_id = NULL, commit_hash = NULL, current_file = NULL,
			 progress = 0, engine = NULL, started_at = NULL WHERE id = 1`
		).run();
		return getScan();
	}
	const startedAt = input.startedAt ?? Date.now();
	db.prepare(
		`UPDATE scan SET active = 1, repo_id = ?, commit_hash = ?, current_file = ?,
		 progress = ?, engine = ?, started_at = ? WHERE id = 1`
	).run(
		input.repoId ?? null,
		input.commit ?? null,
		input.currentFile ?? null,
		Math.max(0, Math.min(100, input.progress ?? 0)),
		input.engine ?? 'slither+semgrep+llm',
		startedAt
	);
	return getScan();
}

/* ------------------------------------------------------------------ */
/* decoration helpers shared with the UI                               */
/* ------------------------------------------------------------------ */

export { sevPills, statusColor, SEV_LABEL };
