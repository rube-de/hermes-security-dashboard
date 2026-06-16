import { json } from '@sveltejs/kit';
import { listReviews } from '$lib/server/store';
import { readInt, readTime } from '$lib/server/params';
import type { RequestHandler } from './$types';

/**
 * Flat, filterable list of reviews across all repos (newest first) — the raw
 * material for building trends/analytics externally.
 *
 *   GET /api/reviews?repo=<id>&since=<ms|ISO>&until=<ms|ISO>&limit=<n>
 *
 * Each item is a review summary including severity counts and new/resolved
 * deltas. `limit` is clamped to 1..1000 (default 200).
 */
export const GET: RequestHandler = ({ url }) => {
	const since = readTime(url, 'since');
	if (!since.ok) return json({ error: since.error }, { status: 400 });
	const until = readTime(url, 'until');
	if (!until.ok) return json({ error: until.error }, { status: 400 });
	const limit = readInt(url, 'limit', { min: 1, max: 1000, def: 200 });
	if (!limit.ok) return json({ error: limit.error }, { status: 400 });

	const reviews = listReviews({
		repoId: url.searchParams.get('repo') ?? undefined,
		since: since.value,
		until: until.value,
		limit: limit.value
	});
	return json({ count: reviews.length, reviews });
};
