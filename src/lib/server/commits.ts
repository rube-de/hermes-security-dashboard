import { db } from './db';
import { VALID_SEV, type ReviewRow } from './rows';
import { emptyCounts, SEV_RANK } from '$lib/format';
import type { Severity, SeverityCounts } from '$lib/types';

export function countsForReview(reviewId: string): SeverityCounts {
	const rows = db
		.prepare('SELECT severity, COUNT(*) AS n FROM findings WHERE review_id = ? GROUP BY severity')
		.all(reviewId) as { severity: Severity; n: number }[];
	const c = emptyCounts();
	for (const r of rows) if (VALID_SEV.has(r.severity)) c[r.severity] = r.n;
	c.total = c.crit + c.high + c.med + c.low;
	return c;
}

export interface UnionFinding {
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
export function unionFindingsForCommit(repoId: string, commit: string): UnionFinding[] {
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
export function latestReviewRowForCommit(repoId: string, commit: string): ReviewRow | undefined {
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
export function repoHead(repoId: string, exclude?: string): { commit: string; scans: number } | null {
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
