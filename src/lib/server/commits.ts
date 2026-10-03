import { db } from './db';
import { VALID_SEV, type ReviewRow } from './rows';
import { countSeverities, quiets, SEV_RANK } from '$lib/format';
import { triageMapForRepo } from './triage';
import type { CommitGroup, Severity, SeverityCounts } from '$lib/types';

/**
 * One entry per issue identity (`fingerprint`) among finding rows, at the most severe
 * rating any of its rows carries; the other fields come from its first row. A review
 * stores one row per location of an issue, and the same issue appears again in every
 * sibling scan of a commit, so anything that counts issues goes through here.
 */
function worstPerIssue<T extends { fingerprint: string; severity: Severity }>(rows: T[]): T[] {
	const byFp = new Map<string, T>();
	for (const row of rows) {
		if (!VALID_SEV.has(row.severity)) continue;
		const cur = byFp.get(row.fingerprint);
		if (!cur) byFp.set(row.fingerprint, { ...row });
		else if (SEV_RANK[row.severity] < SEV_RANK[cur.severity]) cur.severity = row.severity;
	}
	return [...byFp.values()];
}

/** Severity counts of a review's issues (not its rows: a multi-location issue counts once). */
export function countsForReview(reviewId: string): SeverityCounts {
	const rows = db
		.prepare('SELECT fingerprint, severity FROM findings WHERE review_id = ?')
		.all(reviewId) as { fingerprint: string; severity: Severity }[];
	return countSeverities(worstPerIssue(rows));
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
 * disagreement the most severe rating wins. Deduped by issue identity so the same
 * issue seen by two models (or at several locations) counts once — hiding a real
 * issue because the latest model happened to miss it is the wrong failure mode for a
 * security board. This is the single source for both the headline status and a later
 * commit's diff base.
 */
export function unionFindingsForCommit(repoId: string, commit: string): UnionFinding[] {
	const rows = db
		.prepare(
			`SELECT f.fingerprint AS fingerprint, f.severity AS severity, f.title AS title, f.file AS file
			   FROM findings f JOIN reviews r ON f.review_id = r.id
			  WHERE r.repo_id = ? AND r.commit_hash = ?`
		)
		.all(repoId, commit) as { fingerprint: string; severity: Severity; title: string; file: string }[];
	return worstPerIssue(rows);
}

/** Newest scan of a specific commit. Drives the repo's `lastRunAt` / `lastDurationSecs`
 *  (so they describe the same commit the headline counts come from). rowid DESC breaks
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
		'GROUP BY commit_hash ORDER BY MIN(created_at) DESC, MIN(rowid) DESC LIMIT 1';
	// `commit` is a SQLite keyword — keep the column name and rename in JS.
	const sql = `SELECT commit_hash, COUNT(*) AS scans FROM reviews WHERE repo_id = ? ${tail}`;
	const stmt = db.prepare(sql);
	const row = (exclude ? stmt.get(repoId, exclude) : stmt.get(repoId)) as
		| { commit_hash: string; scans: number }
		| undefined;
	return row ? { commit: row.commit_hash, scans: row.scans } : null;
}

/**
 * History compares consecutive code states, not scan arrivals. Every commit unions
 * all its scans, so a later model's discoveries belong to that commit's transition.
 *
 * Precondition: `reviewRows` must contain all reviews for `repoId`, sorted newest-first
 * (`ORDER BY created_at DESC, rowid DESC`), ensuring scans within each commit group
 * retain newest-first ordering without re-sorting.
 */
export function commitHistoryForRepo(repoId: string, reviewRows: ReviewRow[]): CommitGroup[] {
	const commitRows = db
		.prepare(
			`SELECT commit_hash, MIN(created_at) AS created_at FROM reviews
			 WHERE repo_id = ? GROUP BY commit_hash
			 ORDER BY MIN(created_at) ASC, MIN(rowid) ASC`
		)
		.all(repoId) as { commit_hash: string; created_at: number }[];
	const findingRows = db
		.prepare(
			`SELECT f.review_id, f.fingerprint, f.severity FROM findings f
			 JOIN reviews r ON f.review_id = r.id WHERE r.repo_id = ?`
		)
		.all(repoId) as { review_id: string; fingerprint: string; severity: Severity }[];
	const triage = triageMapForRepo(repoId);
	const findingsByReview = new Map<string, typeof findingRows>();
	for (const finding of findingRows) {
		if (quiets(triage.get(finding.fingerprint))) continue;
		let findings = findingsByReview.get(finding.review_id);
		if (!findings) {
			findings = [];
			findingsByReview.set(finding.review_id, findings);
		}
		findings.push(finding);
	}
	const reviewsByCommit = new Map<string, ReviewRow[]>();
	for (const review of reviewRows) {
		let reviews = reviewsByCommit.get(review.commit_hash);
		if (!reviews) {
			reviews = [];
			reviewsByCommit.set(review.commit_hash, reviews);
		}
		reviews.push(review);
	}

	let previous: Set<string> | null = null;
	const history = commitRows.map((commit): CommitGroup => {
		const scans = (reviewsByCommit.get(commit.commit_hash) ?? []).map((review) => ({
			review,
			issues: worstPerIssue(findingsByReview.get(review.id) ?? [])
		}));
		const union = worstPerIssue(scans.flatMap((scan) => scan.issues));
		const current = new Set(union.map((issue) => issue.fingerprint));
		const modelsByIssue = new Map<string, Set<string>>();
		for (const scan of scans) {
			for (const issue of scan.issues) {
				let models = modelsByIssue.get(issue.fingerprint);
				if (!models) {
					models = new Set();
					modelsByIssue.set(issue.fingerprint, models);
				}
				models.add(scan.review.model);
			}
		}
		let newCount = 0;
		let fixedCount = 0;
		if (previous) {
			for (const fp of current) if (!previous.has(fp)) newCount++;
			for (const fp of previous) if (!current.has(fp)) fixedCount++;
		}
		previous = current;
		return {
			commit: commit.commit_hash,
			createdAt: commit.created_at,
			counts: countSeverities(union),
			newCount,
			fixedCount,
			scans: scans.map(({ review, issues }) => ({
				reviewId: review.id,
				model: review.model,
				createdAt: review.created_at,
				counts: countSeverities(issues),
				uniqueCount: issues.reduce(
					(total, issue) =>
						modelsByIssue.get(issue.fingerprint)?.size === 1 ? total + 1 : total,
					0
				)
			}))
		};
	});
	return history.reverse();
}
