import { json } from '@sveltejs/kit';
import { getScan, setScan } from '$lib/server/scan';
import { repoExists } from '$lib/server/repos';
import { checkWriteAuth } from '$lib/server/auth';
import { intField, readJsonObject } from '$lib/server/params';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = () => json(getScan());

const STRING_FIELDS = ['repoId', 'commit', 'currentFile', 'engine'] as const;

/**
 * Update the live active-run state. The Hermes agent calls this as it scans:
 *   { active: true, repoId, commit, currentFile, progress, engine, startedAt }
 * and once more with { active: false } when the run completes.
 *
 * Every field is type-checked (400, never a storage error): the string fields are
 * string-or-null, `progress` is an integer clamped to 0–100, `startedAt` an integer
 * epoch-ms. An active scan must name a registered repo, since the banner links to it.
 */
export const PUT: RequestHandler = async ({ request }) => {
	const denied = checkWriteAuth(request);
	if (denied) return denied;

	const parsed = await readJsonObject(request);
	if (!parsed.ok) return json({ error: parsed.error }, { status: 400 });
	const body = parsed.value;
	if (typeof body.active !== 'boolean') {
		return json({ error: '`active` (boolean) is required' }, { status: 400 });
	}

	const str: Record<(typeof STRING_FIELDS)[number], string | null> = {
		repoId: null,
		commit: null,
		currentFile: null,
		engine: null
	};
	for (const k of STRING_FIELDS) {
		const v = body[k];
		if (v === undefined || v === null) continue;
		if (typeof v !== 'string') {
			return json({ error: `\`${k}\` must be a string or null` }, { status: 400 });
		}
		str[k] = v;
	}
	const progress = intField(body.progress, '`progress`', { signed: true });
	if (!progress.ok) return json({ error: progress.error }, { status: 400 });
	const startedAt = intField(body.startedAt, '`startedAt`');
	if (!startedAt.ok) return json({ error: startedAt.error }, { status: 400 });

	if (body.active && str.repoId !== null && !repoExists(str.repoId)) {
		return json(
			{ error: `unknown repoId "${str.repoId}" — register it with POST /api/repos first` },
			{ status: 400 }
		);
	}

	const state = setScan({
		active: body.active,
		...str,
		// setScan clamps to 0–100.
		progress: progress.value ?? 0,
		startedAt: startedAt.value
	});
	return json(state);
};

export const POST = PUT;
