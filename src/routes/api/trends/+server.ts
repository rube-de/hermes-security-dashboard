import { json } from '@sveltejs/kit';
import { getTrends } from '$lib/server/store';
import { readInt } from '$lib/server/params';
import type { RequestHandler } from './$types';

/**
 * Pre-aggregated daily trend buckets (continuous, zero-filled), newest day last.
 *
 *   GET /api/trends?days=<1..365>&repo=<id>
 *
 * Each bucket: { day, date, newFindings, resolvedFindings, reviews }.
 * `days` defaults to 14. Optional `repo` scopes the series to one repository.
 */
export const GET: RequestHandler = ({ url }) => {
	const days = readInt(url, 'days', { min: 1, max: 365, def: 14 });
	if (!days.ok) return json({ error: days.error }, { status: 400 });

	const repoId = url.searchParams.get('repo') ?? undefined;
	const buckets = getTrends(days.value ?? 14, { repoId });
	return json({ days: days.value ?? 14, repo: repoId ?? null, buckets });
};
