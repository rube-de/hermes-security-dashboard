import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { POST as submitReview } from '../../src/routes/api/repos/[id]/reviews/+server';
import { PUT as updateScan, POST as postScan } from '../../src/routes/api/scan/+server';
import { addRepo, getReviewDetail } from '$lib/server/store';
import { resetDb, callApi } from '../test-utils';

interface ErrorResponse {
	error: string;
}

interface ReviewSubmitResponse {
	ok: boolean;
	reviewId: string;
	repoId: string;
	duplicate?: boolean;
	findings?: number;
}

interface ScanResponse {
	active: boolean;
	repoId: string | null;
	commit: string | null;
	currentFile: string | null;
	progress: number;
	engine: string | null;
	startedAt: number | null;
}

describe('POST /api/repos/[id]/reviews', () => {
	const originalToken = process.env.HERMES_API_TOKEN;
	const repoId = 'scan-repo';

	beforeEach(() => {
		resetDb();
		delete process.env.HERMES_API_TOKEN;
		addRepo({ id: repoId, lang: 'Rust' });
	});

	afterEach(() => {
		if (originalToken !== undefined) {
			process.env.HERMES_API_TOKEN = originalToken;
		} else {
			delete process.env.HERMES_API_TOKEN;
		}
	});

	it('returns 401 when auth is configured and unauthorized', async () => {
		process.env.HERMES_API_TOKEN = 'token-123';
		const res = await callApi<ErrorResponse>(submitReview, {
			method: 'POST',
			params: { id: repoId },
			body: { commit: 'c001' }
		});
		expect(res.status).toBe(401);
		expect(res.body.error).toBe('unauthorized');
	});

	it('returns 404 when repository does not exist', async () => {
		const res = await callApi<ErrorResponse>(submitReview, {
			method: 'POST',
			params: { id: 'unknown-repo' },
			body: { commit: 'c001' }
		});
		expect(res.status).toBe(404);
		expect(res.body.error).toContain('not found');
	});

	it('returns 400 on invalid JSON body', async () => {
		const res = await callApi<ErrorResponse>(submitReview, {
			method: 'POST',
			params: { id: repoId },
			headers: { 'content-type': 'application/json' },
			body: 'bad-json{'
		});
		expect(res.status).toBe(400);
		expect(res.body.error).toBe('invalid JSON body');
	});

	it('returns 400 when commit is missing or empty', async () => {
		const res = await callApi<ErrorResponse>(submitReview, {
			method: 'POST',
			params: { id: repoId },
			body: { findings: [] }
		});
		expect(res.status).toBe(400);
		expect(res.body.error).toBe('`commit` (string) is required');
	});

	it('returns 400 on invalid nextRunAt value', async () => {
		const res = await callApi<ErrorResponse>(submitReview, {
			method: 'POST',
			params: { id: repoId },
			body: { commit: 'c001', nextRunAt: 'invalid-date' }
		});
		expect(res.status).toBe(400);
		expect(res.body.error).toContain('`nextRunAt` must be an epoch-ms number or ISO-8601 date');
	});

	it('returns 400 when findings contains a non-object element', async () => {
		const res = await callApi<ErrorResponse>(submitReview, {
			method: 'POST',
			params: { id: repoId },
			body: { commit: 'c001', findings: ['not-an-object'] }
		});
		expect(res.status).toBe(400);
		expect(res.body.error).toBe('findings[0] must be an object');
	});

	it('returns 400 when finding severity is invalid', async () => {
		const res = await callApi<ErrorResponse>(submitReview, {
			method: 'POST',
			params: { id: repoId },
			body: {
				commit: 'c001',
				findings: [{ severity: 'ultra-critical', title: 'Bug' }]
			}
		});
		expect(res.status).toBe(400);
		expect(res.body.error).toBe('findings[0].severity must be one of crit|high|med|low');
	});

	it('returns 400 when finding title is missing or empty', async () => {
		const res = await callApi<ErrorResponse>(submitReview, {
			method: 'POST',
			params: { id: repoId },
			body: {
				commit: 'c001',
				findings: [{ severity: 'high', title: '   ' }]
			}
		});
		expect(res.status).toBe(400);
		expect(res.body.error).toBe('findings[0].title (string) is required');
	});

	it('returns 201 on valid review submission', async () => {
		const res = await callApi<ReviewSubmitResponse>(submitReview, {
			method: 'POST',
			params: { id: repoId },
			body: {
				commit: 'c001',
				findings: [{ severity: 'high', file: 'src/main.rs', title: 'Buffer overflow' }]
			}
		});
		expect(res.status).toBe(201);
		expect(res.body.ok).toBe(true);
		expect(res.body.repoId).toBe(repoId);
		expect(res.body.findings).toBe(1);
		expect(res.body.reviewId).toBeDefined();
	});

	it('returns 200 with duplicate: true on duplicate resubmit', async () => {
		const payload = {
			commit: 'c001',
			findings: [{ severity: 'high', file: 'src/main.rs', title: 'Buffer overflow' }]
		};

		const res1 = await callApi<ReviewSubmitResponse>(submitReview, {
			method: 'POST',
			params: { id: repoId },
			body: payload
		});
		expect(res1.status).toBe(201);

		const res2 = await callApi<ReviewSubmitResponse>(submitReview, {
			method: 'POST',
			params: { id: repoId },
			body: payload
		});
		expect(res2.status).toBe(200);
		expect(res2.body.ok).toBe(true);
		expect(res2.body.duplicate).toBe(true);
		expect(res2.body.reviewId).toBe(res1.body.reviewId);
	});

	// KNOWN-WRONG (N2/D4, fixed by T10): trigger/engine default to Scheduled and slither+semgrep+llm instead of empty string
	it('defaults trigger and engine to legacy strings when omitted (KNOWN-WRONG: N2)', async () => {
		const res = await callApi<ReviewSubmitResponse>(submitReview, {
			method: 'POST',
			params: { id: repoId },
			body: {
				commit: 'c002',
				findings: []
			}
		});
		expect(res.status).toBe(201);

		const detail = getReviewDetail(res.body.reviewId);
		expect(detail?.trigger).toBe('Scheduled');
		expect(detail?.engine).toBe('slither+semgrep+llm');
	});
});

describe('PUT /api/scan', () => {
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

	it('returns 401 when auth is configured and unauthorized', async () => {
		process.env.HERMES_API_TOKEN = 'secret-scan-token';
		const res = await callApi<ErrorResponse>(updateScan, {
			method: 'PUT',
			body: { active: true }
		});
		expect(res.status).toBe(401);
		expect(res.body.error).toBe('unauthorized');
	});

	it('returns 400 on invalid JSON body', async () => {
		const res = await callApi<ErrorResponse>(updateScan, {
			method: 'PUT',
			headers: { 'content-type': 'application/json' },
			body: 'not-json{'
		});
		expect(res.status).toBe(400);
		expect(res.body.error).toBe('invalid JSON body');
	});

	it('returns 400 when active is missing or not a boolean', async () => {
		const resMissing = await callApi<ErrorResponse>(updateScan, {
			method: 'PUT',
			body: { repoId: 'oasis-core' }
		});
		expect(resMissing.status).toBe(400);
		expect(resMissing.body.error).toBe('`active` (boolean) is required');

		const resNotBool = await callApi<ErrorResponse>(updateScan, {
			method: 'PUT',
			body: { active: 'true' }
		});
		expect(resNotBool.status).toBe(400);
		expect(resNotBool.body.error).toBe('`active` (boolean) is required');
	});

	it('updates active scan state when active: true', async () => {
		const res = await callApi<ScanResponse>(updateScan, {
			method: 'PUT',
			body: {
				active: true,
				repoId: 'oasis-core',
				commit: 'abcdef',
				currentFile: 'src/main.rs',
				progress: 45
			}
		});
		expect(res.status).toBe(200);
		expect(res.body.active).toBe(true);
		expect(res.body.repoId).toBe('oasis-core');
		expect(res.body.commit).toBe('abcdef');
		expect(res.body.currentFile).toBe('src/main.rs');
		expect(res.body.progress).toBe(45);
	});

	it('clears active scan state when active: false', async () => {
		// Set active first
		await callApi<ScanResponse>(updateScan, {
			method: 'PUT',
			body: { active: true, repoId: 'oasis-core' }
		});

		// Clear
		const res = await callApi<ScanResponse>(updateScan, {
			method: 'PUT',
			body: { active: false }
		});
		expect(res.status).toBe(200);
		expect(res.body.active).toBe(false);
		expect(res.body.repoId).toBeNull();
		expect(res.body.commit).toBeNull();
		expect(res.body.currentFile).toBeNull();
		expect(res.body.progress).toBe(0);
	});

	it('POST /api/scan behaves identically to PUT /api/scan', async () => {
		const res = await callApi<ScanResponse>(postScan, {
			method: 'POST',
			body: { active: true, repoId: 'oasis-sdk', progress: 80 }
		});
		expect(res.status).toBe(200);
		expect(res.body.active).toBe(true);
		expect(res.body.repoId).toBe('oasis-sdk');
		expect(res.body.progress).toBe(80);
	});

	// KNOWN-WRONG (U1, fixed by T06): PUT /api/scan does not reject unknown repoId with 400
	it('accepts unknown repoId without rejecting (KNOWN-WRONG: U1)', async () => {
		const res = await callApi<ScanResponse>(updateScan, {
			method: 'PUT',
			body: { active: true, repoId: 'completely-unknown-repo' }
		});
		expect(res.status).toBe(200);
		expect(res.body.active).toBe(true);
		expect(res.body.repoId).toBe('completely-unknown-repo');
	});

	// KNOWN-WRONG (R1/R2, fixed by T06): PUT /api/scan does not type-check non-active fields
	it('accepts negative progress or non-int progress (KNOWN-WRONG: R1/R2)', async () => {
		// store.ts clamps progress Math.max(0, Math.min(100, progress)), but allows float
		const res = await callApi<ScanResponse>(updateScan, {
			method: 'PUT',
			body: { active: true, progress: 12.34 }
		});
		expect(res.status).toBe(200);
		expect(res.body.progress).toBe(12.34);
	});
});
