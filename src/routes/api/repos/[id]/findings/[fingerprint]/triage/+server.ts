import { json } from '@sveltejs/kit';
import { repoExists } from '$lib/server/repos';
import { setTriage, clearTriage, findingIdentity } from '$lib/server/triage';
import type { TriageStatus } from '$lib/types';
import type { RequestHandler } from './$types';

const VALID = new Set<TriageStatus>(['acknowledged', 'false_positive', 'accepted_risk']);

/**
 * Set or clear a human triage verdict on a finding. Keyed on the finding's stable
 * fingerprint (not its ephemeral, per-scan row id), so the tag persists across agent
 * re-runs. Body: { status: 'acknowledged'|'false_positive'|'accepted_risk'|'open', note? }.
 * status 'open' (or null) clears the verdict back to untriaged.
 * Authenticated via trusted gateway identity header `x-hermes-user`, set by the wallet
 * gateway from the signed-in session address. When missing or blank, attribution defaults
 * to 'unknown'. Note is required for false_positive / accepted_risk on critical/high findings.
 */
export const PUT: RequestHandler = async ({ params, request }) => {
	if (!repoExists(params.id)) {
		return json({ error: `repository "${params.id}" not found` }, { status: 404 });
	}

	let body: { status?: unknown; note?: unknown };
	try {
		body = await request.json();
	} catch {
		return json({ error: 'invalid JSON body' }, { status: 400 });
	}

	const status = body.status;
	const note = typeof body.note === 'string' ? body.note.trim() : '';
	const rawUser = request.headers.get('x-hermes-user');
	const triagedBy = rawUser && rawUser.trim() ? rawUser.trim().slice(0, 100) : 'unknown';
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
	const ident = findingIdentity(params.id, params.fingerprint);
	if (!ident) {
		return json(
			{ error: `no finding with fingerprint "${params.fingerprint}" in "${params.id}"` },
			{ status: 404 }
		);
	}

	const isCritOrHigh = ident.severity === 'crit' || ident.severity === 'high';
	const isDismissal = status === 'false_positive' || status === 'accepted_risk';
	if (isCritOrHigh && isDismissal && !note) {
		return json(
			{ error: 'a non-empty note is required when triaging critical or high findings as false positive or accepted risk' },
			{ status: 400 }
		);
	}

	setTriage(params.id, params.fingerprint, status as TriageStatus, note, triagedBy);
	return json({ ok: true, status, note, triagedBy });
};
