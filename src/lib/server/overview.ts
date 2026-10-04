import { db } from './db';
import { listRepoSummaries } from './repos';
import { getMeta } from './meta';
import { getTrends } from './trends';
import { emptyCounts } from '$lib/format';
import type { Overview } from '$lib/types';

export function getOverview(now = Date.now()): Overview {
	const repos = listRepoSummaries();
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

	return {
		totals,
		quietedTotal,
		flagged,
		clean: repos.length - flagged,
		reposCount: repos.length,
		reviewsAllTime,
		avgScanSecs: avgRow.a === null ? null : Math.round(avgRow.a),
		lastRunAt: lastRow.m,
		nextRunAt: storedNext > 0 ? storedNext : null,
		trend: getTrends(14, {}, now),
		repos
	};
}
