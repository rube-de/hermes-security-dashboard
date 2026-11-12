import { json } from '@sveltejs/kit';
import { repoExists } from '$lib/server/repos';
import { checkWriteAuth } from '$lib/server/auth';
import { readJsonObject } from '$lib/server/params';
import {
	associateIssue,
	listIssueAliases,
	requireIssueId,
	requireReason
} from '$lib/server/issue-continuity';
import { db } from '$lib/server/db';
import { tx } from '$lib/server/ingest';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = ({ params }) => {
	if (!repoExists(params.id)) return json({ error: 'repository not found' }, { status: 404 });
	return json({ aliases: listIssueAliases(params.id) });
};

export const POST: RequestHandler = async ({ params, request }) => {
	// Historical identity edits are privileged even on otherwise open private instances.
	if (!process.env.HERMES_API_TOKEN)
		return json(
			{ error: 'alias mutations require configured API-token authentication' },
			{ status: 503 }
		);
	const denied = checkWriteAuth(request);
	if (denied) return denied;
	if (!repoExists(params.id)) return json({ error: 'repository not found' }, { status: 404 });
	const parsed = await readJsonObject(request);
	if (!parsed.ok) return json({ error: parsed.error }, { status: 400 });
	const body = parsed.value;
	try {
		requireIssueId(body.fingerprint, 'fingerprint');
		requireIssueId(body.issueId);
		requireReason(body.reason, 'reason');
		const fingerprint = body.fingerprint,
			issueId = body.issueId,
			reason = body.reason;
		if (!Array.isArray(body.sourceReviewIds)) throw new Error('sourceReviewIds must be an array');
		const sourceReviewIds = body.sourceReviewIds as string[];
		if (
			sourceReviewIds.length < 1 ||
			sourceReviewIds.length > 100 ||
			sourceReviewIds.some((id) => typeof id !== 'string' || !id.trim() || id.length > 200)
		)
			throw new Error(
				'sourceReviewIds must contain 1..100 nonblank review IDs of at most 200 characters'
			);
		if (fingerprint === issueId) throw new Error('self aliases are forbidden');
		for (const id of sourceReviewIds) {
			if (!db.prepare('SELECT 1 FROM reviews WHERE id = ? AND repo_id = ?').get(id, params.id))
				throw new Error('source review not found in repository');
		}
		const refs = [...new Set(sourceReviewIds)];
		for (const fp of [fingerprint, issueId]) {
			if (
				!db
					.prepare(
						`SELECT 1 FROM findings WHERE repo_id = ? AND fingerprint = ? AND review_id IN (${refs.map(() => '?').join(',')}) LIMIT 1`
					)
					.get(params.id, fp, ...refs)
			)
				throw new Error('source reviews must contain both alias and canonical root evidence');
		}
		const result = tx(() => {
			const before = listIssueAliases(params.id).find((a) => a.fingerprint === fingerprint);
			associateIssue(
				params.id,
				fingerprint,
				issueId,
				reason,
				{
					actor: 'api-token',
					sourceReviewIds
				},
				'exact-edge'
			);
			const alias = listIssueAliases(params.id).find((a) => a.fingerprint === fingerprint);
			return { ok: true, duplicate: !!before, alias };
		});
		return json(result, { status: result.duplicate ? 200 : 201 });
	} catch (err) {
		return json({ error: (err as Error).message }, { status: 400 });
	}
};
