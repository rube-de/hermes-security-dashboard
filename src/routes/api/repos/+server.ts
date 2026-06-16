import { json } from '@sveltejs/kit';
import { addRepo, getRepoDetail, listRepoSummaries } from '$lib/server/store';
import { checkWriteAuth } from '$lib/server/auth';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = () => json(listRepoSummaries());

/**
 * Register (or update) a repository Hermes watches.
 *   { id, lang, description?, path?, branch?, lines? }
 */
export const POST: RequestHandler = async ({ request }) => {
	const denied = checkWriteAuth(request);
	if (denied) return denied;

	let body: Record<string, unknown>;
	try {
		body = await request.json();
	} catch {
		return json({ error: 'invalid JSON body' }, { status: 400 });
	}

	const id = typeof body.id === 'string' ? body.id.trim() : '';
	const lang = typeof body.lang === 'string' ? body.lang.trim() : '';
	if (!id) return json({ error: '`id` (string) is required' }, { status: 400 });
	if (!lang) return json({ error: '`lang` (string) is required' }, { status: 400 });

	addRepo({
		id,
		lang,
		description: typeof body.description === 'string' ? body.description : '',
		path: typeof body.path === 'string' ? body.path : undefined,
		branch: typeof body.branch === 'string' ? body.branch : undefined,
		lines: typeof body.lines === 'number' ? body.lines : 0
	});

	return json(getRepoDetail(id), { status: 201 });
};
