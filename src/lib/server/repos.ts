import { db } from './db';
import { type RepoRow, type ReviewRow } from './rows';
import { repoHead, latestReviewRowForCommit, unionFindingsForCommit } from './commits';
import { reviewSummary } from './reviews';
import { triageMapForRepo } from './triage';
import { getScan } from './scan';
import { countSeverities, quiets } from '$lib/format';
import { compareRepos } from '$lib/repo-sort';
import type { RepoDetail, RepoSummary } from '$lib/types';

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

export function getRepoRow(id: string): RepoRow | undefined {
	return db.prepare('SELECT * FROM repos WHERE id = ?').get(id) as RepoRow | undefined;
}

export function allRepoRows(): RepoRow[] {
	return db.prepare('SELECT * FROM repos ORDER BY created_at ASC').all() as unknown as RepoRow[];
}

/** Cheap existence check for endpoints that only need to 404 on an unknown repo —
 *  avoids the full summary build (head union + all review rows) getRepoDetail does. */
export function repoExists(id: string): boolean {
	return !!db.prepare('SELECT 1 FROM repos WHERE id = ? LIMIT 1').get(id);
}

export function buildRepoSummary(repo: RepoRow, scanRepoId: string | null): RepoSummary {
	// The card describes the *current code state* = the head commit (the most
	// recently introduced one). Status counts AND the "last scan" fields both come
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
	let oldestOpenAt: number | null = null;
	for (const f of open) {
		if (f.severity !== 'crit' && f.severity !== 'high') continue;
		if (oldestOpenAt === null || f.firstSeenAt < oldestOpenAt) oldestOpenAt = f.firstSeenAt;
	}
	const status: 'flagged' | 'clean' = counts.total > 0 ? 'flagged' : 'clean';
	return {
		id: repo.id,
		lang: repo.lang,
		description: repo.description,
		path: repo.path,
		branch: repo.branch,
		lines: repo.lines,
		counts,
		quietedCount,
		status,
		clean: status === 'clean',
		scanning: scanRepoId === repo.id,
		oldestOpenAt,
		lastRunAt: headScan?.created_at ?? null,
		lastDurationSecs: headScan?.duration_secs ?? null,
		filesScanned: headScan?.files_scanned ?? 0,
		headCommit: head?.commit ?? null,
		headScanCount: head?.scans ?? 0
	};
}

export function listRepoSummaries(): RepoSummary[] {
	const scan = getScan();
	const scanRepoId = scan.active ? scan.repoId : null;
	return allRepoRows().map((r) => buildRepoSummary(r, scanRepoId)).sort(compareRepos);
}

export function getRepoDetail(id: string): RepoDetail | null {
	const repo = getRepoRow(id);
	if (!repo) return null;
	const scan = getScan();
	const summary = buildRepoSummary(repo, scan.active ? scan.repoId : null);
	const reviewRows = db
		.prepare('SELECT * FROM reviews WHERE repo_id = ? ORDER BY created_at DESC')
		.all(id) as unknown as ReviewRow[];
	return { ...summary, reviews: reviewRows.map((rv) => reviewSummary(rv)) };
}
