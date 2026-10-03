import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { POST as createRepo } from '../../src/routes/api/repos/+server';
import { POST as requestRerun } from '../../src/routes/api/repos/[id]/rerun/+server';
import { PUT as updateTriage } from '../../src/routes/api/repos/[id]/findings/[fingerprint]/triage/+server';
import { addRepo } from '$lib/server/repos';
import { insertReview } from '$lib/server/ingest';
import { fingerprint } from '$lib/server/fingerprint';
import { resetDb, callApi } from '../test-utils';

interface ErrorResponse {
	error: string;
}

interface RepoResponse {
	id: string;
	lang: string;
}

interface RerunResponse {
	ok: boolean;
	repoId: string;
	requestedAt: number;
}

interface TriageResponse {
	ok: boolean;
	status: string;
	note?: string;
	triagedBy?: string;
	cleared?: boolean;
}

describe('POST /api/repos', () => {
	const originalToken = process.env.HERMES_API_TOKEN;

	beforeEach(() => {
		resetDb();
		delete process.env.HERMES_API_TOKEN;
	});

	afterEach(() => {
		if (originalToken !== undefined) {
			process.env.HERMES_API_TOKEN = originalToken;
		} else {
			delete process.env.HERMES_API_TOKEN;
		}
	});

	it('returns 401 when auth token is configured and missing/wrong', async () => {
		process.env.HERMES_API_TOKEN = 'secret';

		const resWithout = await callApi<ErrorResponse>(createRepo, {
			method: 'POST',
			body: { id: 'test-repo', lang: 'Rust' }
		});
		expect(resWithout.status).toBe(401);
		expect(resWithout.body.error).toBe('unauthorized');

		const resWrong = await callApi<ErrorResponse>(createRepo, {
			method: 'POST',
			headers: { authorization: 'Bearer wrong' },
			body: { id: 'test-repo', lang: 'Rust' }
		});
		expect(resWrong.status).toBe(401);
	});

	it('returns 400 on invalid JSON body', async () => {
		const res = await callApi<ErrorResponse>(createRepo, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: 'not-valid-json{'
		});
		expect(res.status).toBe(400);
		expect(res.body.error).toBe('invalid JSON body');
	});

	it('returns 400 when id is missing or empty', async () => {
		const res = await callApi<ErrorResponse>(createRepo, {
			method: 'POST',
			body: { lang: 'Go' }
		});
		expect(res.status).toBe(400);
		expect(res.body.error).toBe('`id` (string) is required');
	});

	it('returns 400 when lang is missing or empty', async () => {
		const res = await callApi<ErrorResponse>(createRepo, {
			method: 'POST',
			body: { id: 'repo-1' }
		});
		expect(res.status).toBe(400);
		expect(res.body.error).toBe('`lang` (string) is required');
	});

	it('returns 201 on valid repo creation', async () => {
		const res = await callApi<RepoResponse>(createRepo, {
			method: 'POST',
			body: { id: 'oasis-core', lang: 'Rust', description: 'Core consensus' }
		});
		expect(res.status).toBe(201);
		expect(res.body.id).toBe('oasis-core');
		expect(res.body.lang).toBe('Rust');
	});

	// KNOWN-WRONG (I1, fixed by T06): POST /api/repos allows any id string (e.g. spaces/slashes); T06 will enforce ^[A-Za-z0-9._-]{1,100}$
	it('allows arbitrary id characters without regex validation (KNOWN-WRONG: I1)', async () => {
		const res = await callApi<RepoResponse>(createRepo, {
			method: 'POST',
			body: { id: 'repo with spaces and / slashes', lang: 'TypeScript' }
		});
		expect(res.status).toBe(201);
		expect(res.body.id).toBe('repo with spaces and / slashes');
	});
});

describe('POST /api/repos/[id]/rerun', () => {
	beforeEach(() => {
		resetDb();
	});

	it('returns 404 when repository does not exist', async () => {
		const res = await callApi<ErrorResponse>(requestRerun, {
			method: 'POST',
			params: { id: 'missing-repo' }
		});
		expect(res.status).toBe(404);
		expect(res.body.error).toContain('not found');
	});

	it('returns 202 when repository exists', async () => {
		addRepo({ id: 'repo-exists', lang: 'Solidity' });
		const res = await callApi<RerunResponse>(requestRerun, {
			method: 'POST',
			params: { id: 'repo-exists' }
		});
		expect(res.status).toBe(202);
		expect(res.body.ok).toBe(true);
		expect(res.body.repoId).toBe('repo-exists');
		expect(typeof res.body.requestedAt).toBe('number');
	});
});

describe('PUT /api/repos/[id]/findings/[fingerprint]/triage', () => {
	const repoId = 'triage-api-repo';
	const fp = fingerprint('contracts/Vault.sol', 'Reentrancy Bug');

	beforeEach(() => {
		resetDb();
		addRepo({ id: repoId, lang: 'Solidity' });
		insertReview(repoId, {
			commit: 'c001',
			findings: [{ severity: 'crit', file: 'contracts/Vault.sol', title: 'Reentrancy Bug' }]
		});
	});

	it('returns 404 when repository does not exist', async () => {
		const res = await callApi<ErrorResponse>(updateTriage, {
			method: 'PUT',
			params: { id: 'unknown-repo', fingerprint: fp },
			body: { status: 'acknowledged' }
		});
		expect(res.status).toBe(404);
		expect(res.body.error).toContain('not found');
	});

	it('returns 400 on invalid JSON body', async () => {
		const res = await callApi<ErrorResponse>(updateTriage, {
			method: 'PUT',
			params: { id: repoId, fingerprint: fp },
			headers: { 'content-type': 'application/json' },
			body: 'bad-json{'
		});
		expect(res.status).toBe(400);
		expect(res.body.error).toBe('invalid JSON body');
	});

	it('returns 400 on invalid triage status', async () => {
		const res = await callApi<ErrorResponse>(updateTriage, {
			method: 'PUT',
			params: { id: repoId, fingerprint: fp },
			body: { status: 'invalid_status' }
		});
		expect(res.status).toBe(400);
		expect(res.body.error).toContain('status must be one of');
	});

	it('returns 404 when finding fingerprint does not exist in repository', async () => {
		const res = await callApi<ErrorResponse>(updateTriage, {
			method: 'PUT',
			params: { id: repoId, fingerprint: 'nonexistent-fp' },
			body: { status: 'acknowledged' }
		});
		expect(res.status).toBe(404);
		expect(res.body.error).toContain('no finding with fingerprint');
	});

	it('returns 200 on setting valid triage status', async () => {
		const res = await callApi<TriageResponse>(updateTriage, {
			method: 'PUT',
			params: { id: repoId, fingerprint: fp },
			body: { status: 'acknowledged', note: 'Under investigation' }
		});
		expect(res.status).toBe(200);
		expect(res.body.ok).toBe(true);
		expect(res.body.status).toBe('acknowledged');
		expect(res.body.note).toBe('Under investigation');
	});
	it('rejects empty note on critical/high false_positive or accepted_risk with 400', async () => {
		const resFP = await callApi<ErrorResponse>(updateTriage, {
			method: 'PUT',
			params: { id: repoId, fingerprint: fp },
			body: { status: 'false_positive', note: '' }
		});
		expect(resFP.status).toBe(400);
		expect(resFP.body.error).toContain('non-empty note is required');

		const resWhitespace = await callApi<ErrorResponse>(updateTriage, {
			method: 'PUT',
			params: { id: repoId, fingerprint: fp },
			body: { status: 'accepted_risk', note: '   ' }
		});
		expect(resWhitespace.status).toBe(400);
		expect(resWhitespace.body.error).toContain('non-empty note is required');
	});

	it('allows empty note for acknowledged on critical findings', async () => {
		const res = await callApi<TriageResponse>(updateTriage, {
			method: 'PUT',
			params: { id: repoId, fingerprint: fp },
			body: { status: 'acknowledged', note: '' }
		});
		expect(res.status).toBe(200);
		expect(res.body.ok).toBe(true);
		expect(res.body.status).toBe('acknowledged');
	});

	it('allows empty note on medium/low findings for false_positive or accepted_risk', async () => {
		const medFp = fingerprint('src/utils.ts', 'Medium Severity Finding');
		insertReview(repoId, {
			commit: 'c002',
			findings: [{ severity: 'med', file: 'src/utils.ts', title: 'Medium Severity Finding' }]
		});

		const res = await callApi<TriageResponse>(updateTriage, {
			method: 'PUT',
			params: { id: repoId, fingerprint: medFp },
			body: { status: 'false_positive', note: '' }
		});
		expect(res.status).toBe(200);
		expect(res.body.ok).toBe(true);
		expect(res.body.status).toBe('false_positive');
	});

	it('records attribution from x-hermes-user header, defaulting to unknown when omitted', async () => {
		const resWithHeader = await callApi<TriageResponse>(updateTriage, {
			method: 'PUT',
			params: { id: repoId, fingerprint: fp },
			headers: { 'x-hermes-user': '0x1234567890abcdef' },
			body: { status: 'false_positive', note: 'Verified false positive' }
		});
		expect(resWithHeader.status).toBe(200);
		expect(resWithHeader.body.triagedBy).toBe('0x1234567890abcdef');

		const resWithoutHeader = await callApi<TriageResponse>(updateTriage, {
			method: 'PUT',
			params: { id: repoId, fingerprint: fp },
			body: { status: 'accepted_risk', note: 'Risk accepted' }
		});
		expect(resWithoutHeader.status).toBe(200);
		expect(resWithoutHeader.body.triagedBy).toBe('unknown');

		const resBlankHeader = await callApi<TriageResponse>(updateTriage, {
			method: 'PUT',
			params: { id: repoId, fingerprint: fp },
			headers: { 'x-hermes-user': '   ' },
			body: { status: 'acknowledged' }
		});
		expect(resBlankHeader.status).toBe(200);
		expect(resBlankHeader.body.triagedBy).toBe('unknown');
	});
	it('returns 200 when clearing triage with status: open or null', async () => {
		// Set triage first
		await callApi<TriageResponse>(updateTriage, {
			method: 'PUT',
			params: { id: repoId, fingerprint: fp },
			body: { status: 'false_positive', note: 'Initial dismissal' }
		});

		// Clear triage with 'open'
		const resOpen = await callApi<TriageResponse>(updateTriage, {
			method: 'PUT',
			params: { id: repoId, fingerprint: fp },
			body: { status: 'open' }
		});
		expect(resOpen.status).toBe(200);
		expect(resOpen.body.status).toBe('open');
		expect(resOpen.body.cleared).toBe(true);

		// Clear triage with null
		const resNull = await callApi<TriageResponse>(updateTriage, {
			method: 'PUT',
			params: { id: repoId, fingerprint: fp },
			body: { status: null }
		});
		expect(resNull.status).toBe(200);
		expect(resNull.body.status).toBe('open');
	});
});
