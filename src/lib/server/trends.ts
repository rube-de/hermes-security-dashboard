import { db } from './db';
import type { TrendBucket } from '$lib/types';

const DAY_MS = 86_400_000;

function startOfUtcDay(ts: number): number {
	return Math.floor(ts / DAY_MS) * DAY_MS;
}

/**
 * Daily new/resolved/review counts over the last `days` days (continuous,
 * zero-filled), aligned to UTC-day boundaries. Optionally scoped to one repo.
 * Aggregated from the denormalized per-review delta columns — cheap, no N+1.
 */
export function getTrends(days = 14, opts: { repoId?: string } = {}, now = Date.now()): TrendBucket[] {
	const span = Math.max(1, Math.min(365, Math.floor(days)));
	const today0 = startOfUtcDay(now);
	const since = today0 - (span - 1) * DAY_MS;

	const where = ['created_at >= ?', 'created_at < ?'];
	const params: (string | number)[] = [since, today0 + DAY_MS];
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
		const key = startOfUtcDay(row.created_at);
		const cur = agg.get(key) ?? { n: 0, r: 0, reviews: 0 };
		cur.n += row.new_count;
		cur.r += row.resolved_count;
		cur.reviews += 1;
		agg.set(key, cur);
	}

	const out: TrendBucket[] = [];
	for (let i = span - 1; i >= 0; i--) {
		const dayStart = today0 - i * DAY_MS;
		const d = new Date(dayStart);
		const a = agg.get(dayStart) ?? { n: 0, r: 0, reviews: 0 };
		out.push({
			day: `${d.getUTCMonth() + 1}/${d.getUTCDate()}`,
			date: dayStart,
			newFindings: a.n,
			resolvedFindings: a.r,
			reviews: a.reviews
		});
	}
	return out;
}
