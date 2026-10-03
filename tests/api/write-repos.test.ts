import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { POST as createRepo } from '../../src/routes/api/repos/+server';
import { POST as requestRerun } from '../../src/routes/api/repos/[id]/rerun/+server';
import { PUT as updateTriage } from '../../src/routes/api/repos/[id]/findings/[fingerprint]/triage/+server';
import { addRepo, repoExists } from '$lib/server/repos';
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

	it('returns 400 for a new id that is not a single URL-safe segment (I1)', async () => {
		const bad = ['repo with spaces', 'org/repo', '.', '..', 'naïve', 'x'.repeat(101)];
		for (const id of bad) {
			const res = await callApi<ErrorResponse>(createRepo, {
				method: 'POST',
				body: { id, lang: 'TypeScript' }
			});
			expect(res.status).toBe(400);
			expect(res.body.error).toContain('`id` must match');
			expect(repoExists(id)).toBe(false);
		}
	});

	it('accepts new ids at the edges of the allowed shape', async () => {
		for (const id of ['a', 'Oasis.SDK_v2-rc', '...', 'x'.repeat(100)]) {
			const res = await callApi<RepoResponse>(createRepo, {
				method: 'POST',
				body: { id, lang: 'Go' }
			});
			expect(res.status).toBe(201);
			expect(res.body.id).toBe(id);
		}
	});

	it('still updates a repo whose id predates the id rule', async () => {
		addRepo({ id: 'legacy repo/id', lang: 'Go' });
		const res = await callApi<RepoResponse>(createRepo, {
			method: 'POST',
			body: { id: 'legacy repo/id', lang: 'Rust' }
		});
		expect(res.status).toBe(201);
		expect(res.body.lang).toBe('Rust');
	});

	it('returns 400 when lines is not a non-negative integer', async () => {
		for (const lines of [12.5, -1, '100']) {
			const res = await callApi<ErrorResponse>(createRepo, {
				method: 'POST',
				body: { id: 'repo-lines', lang: 'Go', lines }
			});
			expect(res.status).toBe(400);
			expect(res.body.error).toBe('`lines` must be a non-negative integer');
		}
		expect(repoExists('repo-lines')).toBe(false);
	});

	it('returns 400 when the JSON body is not an object', async () => {
		const res = await callApi<ErrorResponse>(createRepo, { method: 'POST', body: null });
		expect(res.status).toBe(400);
		expect(res.body.error).toBe('JSON body must be an object');
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

	// KNOWN-WRONG (E3/D8, fixed by T13): triage does not require note on crit/high or record x-hermes-user
	it('allows empty note on critical finding (KNOWN-WRONG: E3/D8)', async () => {
		const res = await callApi<TriageResponse>(updateTriage, {
			method: 'PUT',
			params: { id: repoId, fingerprint: fp },
			body: { status: 'false_positive', note: '' }
		});
		expect(res.status).toBe(200);
		expect(res.body.ok).toBe(true);
		expect(res.body.status).toBe('false_positive');
		expect(res.body.note).toBe('');
	});

	it('returns 200 when clearing triage with status: open or null', async () => {
		// Set triage first
		await callApi<TriageResponse>(updateTriage, {
			method: 'PUT',
			params: { id: repoId, fingerprint: fp },
			body: { status: 'false_positive' }
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
