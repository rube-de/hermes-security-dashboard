import { json } from '@sveltejs/kit';
import { getRepoDetail, setTriage, clearTriage } from '$lib/server/store';
import type { TriageStatus } from '$lib/types';
import type { RequestHandler } from './$types';

const VALID = new Set<TriageStatus>(['acknowledged', 'false_positive', 'accepted_risk']);

/**
 * Set or clear a human triage verdict on a finding. Keyed on the finding's stable
 * fingerprint (not its ephemeral, per-scan row id), so the tag persists across agent
 * re-runs. Body: { status: 'acknowledged'|'false_positive'|'accepted_risk'|'open', note? }.
 * status 'open' (or null) clears the verdict back to untriaged.
 *
 * Unauthenticated by design — a dashboard user affordance like rerun, not an agent data
 * write; the dashboard sits behind a gateway. There is no viewer identity, so a tag is
 * anonymous-but-timestamped (see store.setTriage).
 */
export const PUT: RequestHandler = async ({ params, request }) => {
	if (!getRepoDetail(params.id)) {
		return json({ error: `repository "${params.id}" not found` }, { status: 404 });
	}

	let body: { status?: unknown; note?: unknown };
	try {
		body = await request.json();
	} catch {
		return json({ error: 'invalid JSON body' }, { status: 400 });
	}

	const status = body.status;
	const note = typeof body.note === 'string' ? body.note : '';

	// 'open' (or null) clears the verdict — idempotent, and unlike a set it doesn't require
	// the finding to currently exist (a tag may outlive a finding that's gone quiet).
	if (status === 'open' || status === null) {
		const cleared = clearTriage(params.id, params.fingerprint);
		return json({ ok: true, status: 'open', cleared });
	}

	if (typeof status !== 'string' || !VALID.has(status as TriageStatus)) {
		return json(
			{ error: 'status must be one of: open, acknowledged, false_positive, accepted_risk' },
			{ status: 400 }
		);
	}

	const found = setTriage(params.id, params.fingerprint, status as TriageStatus, note);
	if (!found) {
		return json(
			{ error: `no finding with fingerprint "${params.fingerprint}" in "${params.id}"` },
			{ status: 404 }
		);
	}
	return json({ ok: true, status, note });
};
