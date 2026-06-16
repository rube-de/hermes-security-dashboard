import { randomUUID } from 'node:crypto';
import { db } from './db';
import { fingerprint } from './fingerprint';
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
	TrendBucket,
	TrendPoint
} from '$lib/types';

const VALID_SEV = new Set<Severity>(['crit', 'high', 'med', 'low']);

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

function cadenceHours(): number {
	return Number(getMeta('cadence_hours', '6')) || 6;
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

function latestReviewRow(repoId: string): ReviewRow | undefined {
	return db
		.prepare('SELECT * FROM reviews WHERE repo_id = ? ORDER BY created_at DESC LIMIT 1')
		.get(repoId) as ReviewRow | undefined;
}

/** Existing review id for a (repo, commit) pair, or null. Drives idempotent submits. */
export function findReviewByCommit(repoId: string, commit: string): string | null {
	const row = db
		.prepare('SELECT id FROM reviews WHERE repo_id = ? AND commit_hash = ? LIMIT 1')
		.get(repoId, commit) as { id: string } | undefined;
	return row?.id ?? null;
}

/* ------------------------------------------------------------------ */
/* summaries                                                           */
/* ------------------------------------------------------------------ */

function buildRepoSummary(repo: RepoRow, scanRepoId: string | null, now: number): RepoSummary {
	const latest = latestReviewRow(repo.id);
	const counts = latest ? countsForReview(latest.id) : emptyCounts();
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
		status,
		statusLabel:
			status === 'clean' ? 'Clean' : `${counts.total} issue${counts.total > 1 ? 's' : ''}`,
		clean: status === 'clean',
		glyph: status === 'clean' ? '[ok]' : '[!!]',
		scanning: scanRepoId === repo.id,
		lastRunLabel: latest ? fmtAgo(latest.created_at, now) : 'never',
		lastDurationLabel: latest ? fmtDur(latest.duration_secs) : '—',
		filesScanned: latest?.files_scanned ?? 0
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

export function getReviewDetail(reviewId: string, now = Date.now()): ReviewDetail | null {
	const rv = db.prepare('SELECT * FROM reviews WHERE id = ?').get(reviewId) as ReviewRow | undefined;
	if (!rv) return null;
	const ch = cadenceHours();
	const rows = db
		.prepare(
			`SELECT * FROM findings WHERE review_id = ?
			 ORDER BY CASE severity WHEN 'crit' THEN 0 WHEN 'high' THEN 1 WHEN 'med' THEN 2 ELSE 3 END, id`
		)
		.all(reviewId) as unknown as FindingRow[];

	const findings: Finding[] = rows.map((f) => {
		const ageHours = Math.max(0, (rv.created_at - f.first_seen_at) / 3_600_000);
		const openRuns = Math.max(1, Math.floor(ageHours / ch) + 1);
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
			ageHours: Math.round(ageHours)
		};
	});

	const counts = countSeverities(rows);
	let resolved: ResolvedFinding[] = [];
	try {
		resolved = JSON.parse(rv.resolved_json) as ResolvedFinding[];
	} catch {
		resolved = [];
	}

	const summary = reviewSummary(rv, now);
	return {
		...summary,
		counts,
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

export function insertReview(repoId: string, input: ReviewInput): string {
	const repo = getRepoRow(repoId);
	if (!repo) throw new Error(`unknown repo: ${repoId}`);

	const now = input.createdAt ?? Date.now();
	const reviewId = randomUUID();
	const findings = (input.findings ?? []).filter((f) => VALID_SEV.has(f.severity));

	// Previous review (latest existing for this repo) drives the diff.
	const prev = latestReviewRow(repoId);
	const prevFindings = prev
		? (db
				.prepare('SELECT severity, title, file, fingerprint FROM findings WHERE review_id = ?')
				.all(prev.id) as Pick<FindingRow, 'severity' | 'title' | 'file' | 'fingerprint'>[])
		: [];
	const prevFps = new Set(prevFindings.map((f) => f.fingerprint));

	const prepared = findings.map((f) => {
		const file = f.file ?? '';
		const fp = fingerprint(file, f.title);
		const seen = db
			.prepare('SELECT MIN(first_seen_at) AS m FROM findings WHERE repo_id = ? AND fingerprint = ?')
			.get(repoId, fp) as { m: number | null };
		const firstSeen = seen.m ?? now;
		return { f, file, fp, isNew: !prevFps.has(fp), firstSeen };
	});

	const curFps = new Set(prepared.map((p) => p.fp));
	const resolved: ResolvedFinding[] = prevFindings
		.filter((f) => !curFps.has(f.fingerprint))
		.map((f) => ({ severity: f.severity, title: f.title, file: f.file }));
	const newCount = prepared.filter((p) => p.isNew).length;

	const lines = input.lines ?? repo.lines;
	const html = input.html ? sanitizeReportHtml(input.html) : null;

	tx(() => {
		db.prepare(
			`INSERT INTO reviews
			 (id, repo_id, commit_hash, trigger, engine, summary, html, duration_secs, lines,
			  files_scanned, prev_commit, new_count, resolved_count, resolved_json, created_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
		).run(
			reviewId,
			repoId,
			input.commit,
			input.trigger ?? 'Scheduled',
			input.engine ?? 'slither+semgrep+llm',
			input.summary ?? '',
			html,
			input.durationSecs ?? 0,
			lines,
			input.filesScanned ?? 0,
			prev?.commit_hash ?? null,
			newCount,
			resolved.length,
			JSON.stringify(resolved),
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

	return reviewId;
}

/* ------------------------------------------------------------------ */
/* overview                                                            */
/* ------------------------------------------------------------------ */

export function getOverview(now = Date.now()): Overview {
	const repos = listRepoSummaries(now);
	const totals = emptyCounts();
	for (const r of repos) {
		totals.crit += r.counts.crit;
		totals.high += r.counts.high;
		totals.med += r.counts.med;
		totals.low += r.counts.low;
	}
	totals.total = totals.crit + totals.high + totals.med + totals.low;

	const flagged = repos.filter((r) => r.status === 'flagged').length;
	const reviewsAllTime =
		(db.prepare('SELECT COUNT(*) AS n FROM reviews').get() as { n: number }).n +
		Number(getMeta('reviews_base', '0'));
	const avgRow = db.prepare('SELECT AVG(duration_secs) AS a FROM reviews').get() as { a: number | null };
	const lastRow = db.prepare('SELECT MAX(created_at) AS m FROM reviews').get() as { m: number | null };

	const ch = cadenceHours();
	const storedNext = Number(getMeta('next_run_at', '0'));
	const nextRunAt =
		storedNext > now ? storedNext : (lastRow.m ?? now) + ch * 3_600_000;

	return {
		totals,
		flagged,
		clean: repos.length - flagged,
		reposCount: repos.length,
		reviewsAllTime,
		avgScanLabel: avgRow.a ? fmtDur(avgRow.a) : '—',
		cadence: getMeta('cadence', 'Every 6 hours'),
		cadenceHours: ch,
		orgLabel: getMeta('org_label', 'Oasis Protocol'),
		lastRunLabel: lastRow.m ? fmtAgo(lastRow.m, now) : 'never',
		nextRunLabel: fmtUntil(nextRunAt, now),
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
