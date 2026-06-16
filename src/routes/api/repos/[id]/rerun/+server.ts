import { json } from '@sveltejs/kit';
import { getRepoDetail, requestRerun, getRerunRequest } from '$lib/server/store';
import type { RequestHandler } from './$types';

/**
 * Re-run requests. A dashboard user can ask for a repository to be re-reviewed on
 * the next Hermes cycle; the agent polls GET to discover pending requests. This
 * only records intent — the dashboard never runs scans itself. Unauthenticated by
 * design: it is a user affordance, not an agent data write.
 */
export const POST: RequestHandler = ({ params }) => {
	if (!getRepoDetail(params.id)) {
		return json({ error: `repository "${params.id}" not found` }, { status: 404 });
	}
	const requestedAt = requestRerun(params.id);
	return json({ ok: true, repoId: params.id, requestedAt }, { status: 202 });
};

export const GET: RequestHandler = ({ params }) => {
	if (!getRepoDetail(params.id)) {
		return json({ error: `repository "${params.id}" not found` }, { status: 404 });
	}
	const requestedAt = getRerunRequest(params.id);
	return json({ repoId: params.id, requestedAt, pending: requestedAt !== null });
};
