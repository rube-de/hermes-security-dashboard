import { db } from './db';
import type { TrendBucket } from '$lib/types';

export function startOfLocalDay(ts: number): number {
	const d = new Date(ts);
	d.setHours(0, 0, 0, 0);
	return d.getTime();
}

/**
 * `n` local days from `ts` via calendar arithmetic (not fixed-ms). Starting at a
 * local midnight, the result is the local midnight `n` days away — correct across
 * DST transitions, where a "day" is 23 or 25 hours, not always 86_400_000 ms.
 */
export function addLocalDays(ts: number, n: number): number {
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
