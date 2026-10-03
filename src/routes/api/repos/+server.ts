import { json } from '@sveltejs/kit';
import { addRepo, getRepoDetail, listRepoSummaries, repoExists } from '$lib/server/repos';
import { checkWriteAuth } from '$lib/server/auth';
import { intField, readJsonObject } from '$lib/server/params';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = () => json(listRepoSummaries());

/** Shape of a new repo id: URL-safe, one path segment. "." and ".." are rejected too:
 *  they match the character class but are dot-segments a URL resolves away. */
const REPO_ID = /^[A-Za-z0-9._-]{1,100}$/;

/**
 * Register (or update) a repository Hermes watches.
 *   { id, lang, description?, path?, branch?, lines? }
 * A new `id` must be a single URL-safe segment; repos registered before that rule
 * existed can still be updated under their old id.
 */
export const POST: RequestHandler = async ({ request }) => {
	const denied = checkWriteAuth(request);
	if (denied) return denied;

	const parsed = await readJsonObject(request);
	if (!parsed.ok) return json({ error: parsed.error }, { status: 400 });
	const body = parsed.value;

	const id = typeof body.id === 'string' ? body.id.trim() : '';
	const lang = typeof body.lang === 'string' ? body.lang.trim() : '';
	if (!id) return json({ error: '`id` (string) is required' }, { status: 400 });
	if (!lang) return json({ error: '`lang` (string) is required' }, { status: 400 });
	const validShape = REPO_ID.test(id) && id !== '.' && id !== '..';
	if (!validShape && !repoExists(id)) {
		return json(
			{ error: '`id` must match ^[A-Za-z0-9._-]{1,100}$ (and not be "." or "..")' },
			{ status: 400 }
		);
	}
	const lines = intField(body.lines, '`lines`');
	if (!lines.ok) return json({ error: lines.error }, { status: 400 });

	addRepo({
		id,
		lang,
		description: typeof body.description === 'string' ? body.description : '',
		path: typeof body.path === 'string' ? body.path : undefined,
		branch: typeof body.branch === 'string' ? body.branch : undefined,
		lines: lines.value ?? 0
	});

	return json(getRepoDetail(id), { status: 201 });
};
