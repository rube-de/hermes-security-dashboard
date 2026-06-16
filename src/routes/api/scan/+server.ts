import { json } from '@sveltejs/kit';
import { getScan, setScan } from '$lib/server/store';
import { checkWriteAuth } from '$lib/server/auth';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = () => json(getScan());

/**
 * Update the live active-run state. The Hermes agent calls this as it scans:
 *   { active: true, repoId, commit, currentFile, progress, engine, startedAt }
 * and once more with { active: false } when the run completes.
 */
export const PUT: RequestHandler = async ({ request }) => {
	const denied = checkWriteAuth(request);
	if (denied) return denied;

	let body: Record<string, unknown>;
	try {
		body = await request.json();
	} catch {
		return json({ error: 'invalid JSON body' }, { status: 400 });
	}
	if (typeof body.active !== 'boolean') {
		return json({ error: '`active` (boolean) is required' }, { status: 400 });
	}

	const state = setScan({
		active: body.active,
		repoId: (body.repoId as string) ?? null,
		commit: (body.commit as string) ?? null,
		currentFile: (body.currentFile as string) ?? null,
		progress: typeof body.progress === 'number' ? body.progress : 0,
		engine: (body.engine as string) ?? null,
		startedAt: typeof body.startedAt === 'number' ? body.startedAt : undefined
	});
	return json(state);
};

export const POST = PUT;
