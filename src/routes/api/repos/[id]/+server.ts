import { json } from '@sveltejs/kit';
import { getRepoDetail } from '$lib/server/repos';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = ({ params }) => {
	const repo = getRepoDetail(params.id);
	if (!repo) return json({ error: 'repository not found' }, { status: 404 });
	return json(repo);
};
