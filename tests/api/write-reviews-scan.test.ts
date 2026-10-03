import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { POST as submitReview } from '../../src/routes/api/repos/[id]/reviews/+server';
import { PUT as updateScan, POST as postScan } from '../../src/routes/api/scan/+server';
import { addRepo } from '$lib/server/repos';
import { getReviewDetail, listReviews } from '$lib/server/reviews';
import { getMeta } from '$lib/server/meta';
import { getScan, setScan } from '$lib/server/scan';
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
	dataVersion: number;
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

	it('returns 400 when a numeric review field is not a non-negative integer, storing nothing', async () => {
		const cases: [string, unknown][] = [
			['durationSecs', 12.5],
			['lines', -10],
			['filesScanned', '80']
		];
		for (const [field, value] of cases) {
			const res = await callApi<ErrorResponse>(submitReview, {
				method: 'POST',
				params: { id: repoId },
				body: { commit: 'c001', [field]: value }
			});
			expect(res.status).toBe(400);
			expect(res.body.error).toBe(`\`${field}\` must be a non-negative integer`);
		}
		expect(listReviews({ repoId })).toHaveLength(0);
	});

	it('returns 400 when a finding line is not a non-negative integer', async () => {
		const res = await callApi<ErrorResponse>(submitReview, {
			method: 'POST',
			params: { id: repoId },
			body: { commit: 'c001', findings: [{ severity: 'high', title: 'Bug', line: 42.5 }] }
		});
		expect(res.status).toBe(400);
		expect(res.body.error).toBe('findings[0].line must be a non-negative integer');
	});

	it('returns 400 when findings is present but not an array, instead of storing a clean review', async () => {
		const res = await callApi<ErrorResponse>(submitReview, {
			method: 'POST',
			params: { id: repoId },
			body: { commit: 'c001', findings: { severity: 'crit', title: 'Bug' } }
		});
		expect(res.status).toBe(400);
		expect(res.body.error).toBe('`findings` must be an array');
		expect(listReviews({ repoId })).toHaveLength(0);
	});

	it('returns 400 when nextRunAt is in epoch seconds, leaving the schedule unset', async () => {
		const res = await callApi<ErrorResponse>(submitReview, {
			method: 'POST',
			params: { id: repoId },
			body: { commit: 'c001', nextRunAt: 1790000000 }
		});
		expect(res.status).toBe(400);
		expect(res.body.error).toBe(
			'`nextRunAt` looks like epoch seconds (10 digits); send epoch-ms or an ISO-8601 date'
		);
		expect(getMeta('next_run_at', 'unset')).toBe('unset');
	});

	it('returns 400 when the JSON body is not an object', async () => {
		const res = await callApi<ErrorResponse>(submitReview, {
			method: 'POST',
			params: { id: repoId },
			body: null
		});
		expect(res.status).toBe(400);
		expect(res.body.error).toBe('JSON body must be an object');
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

	it('stores unreported trigger, engine, summary and agentVersion as empty, not invented values (N2/D4)', async () => {
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
		expect(detail?.trigger).toBe('');
		expect(detail?.engine).toBe('');
		expect(detail?.summary).toBe('');
		expect(detail?.agentVersion).toBe('');
		// The history row the repo page renders carries the same empty trigger.
		expect(listReviews({ repoId })[0].trigger).toBe('');
	});

	it('stores trigger and engine as sent', async () => {
		const res = await callApi<ReviewSubmitResponse>(submitReview, {
			method: 'POST',
			params: { id: repoId },
			body: { commit: 'c003', trigger: 'Push to main', engine: ' semgrep ' }
		});
		expect(res.status).toBe(201);
		const detail = getReviewDetail(res.body.reviewId);
		expect(detail?.trigger).toBe('Push to main');
		expect(detail?.engine).toBe('semgrep');
	});
});

describe('PUT /api/scan', () => {
	const originalToken = process.env.HERMES_API_TOKEN;

	beforeEach(() => {
		resetDb();
		delete process.env.HERMES_API_TOKEN;
		addRepo({ id: 'oasis-core', lang: 'Rust' });
		addRepo({ id: 'oasis-sdk', lang: 'Go' });
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

	it('returns 400 for an active scan on an unregistered repoId, leaving state unchanged (U1)', async () => {
		const res = await callApi<ErrorResponse>(updateScan, {
			method: 'PUT',
			body: { active: true, repoId: 'completely-unknown-repo' }
		});
		expect(res.status).toBe(400);
		expect(res.body.error).toContain('unknown repoId "completely-unknown-repo"');
		expect(getScan().active).toBe(false);
	});

	it('still clears the scan when active: false names an unregistered repoId', async () => {
		setScan({ active: true, repoId: 'oasis-core' });
		const res = await callApi<ScanResponse>(updateScan, {
			method: 'PUT',
			body: { active: false, repoId: 'completely-unknown-repo' }
		});
		expect(res.status).toBe(200);
		expect(res.body.active).toBe(false);
	});

	it('returns 400 for a non-integer progress (R1/R2)', async () => {
		for (const progress of [12.34, '50', true]) {
			const res = await callApi<ErrorResponse>(updateScan, {
				method: 'PUT',
				body: { active: true, repoId: 'oasis-core', progress }
			});
			expect(res.status).toBe(400);
			expect(res.body.error).toBe('`progress` must be an integer');
		}
		expect(getScan().active).toBe(false);
	});

	it('clamps an out-of-range integer progress to 0–100', async () => {
		const low = await callApi<ScanResponse>(updateScan, {
			method: 'PUT',
			body: { active: true, repoId: 'oasis-core', progress: -5 }
		});
		expect(low.status).toBe(200);
		expect(low.body.progress).toBe(0);

		const high = await callApi<ScanResponse>(updateScan, {
			method: 'PUT',
			body: { active: true, repoId: 'oasis-core', progress: 150 }
		});
		expect(high.status).toBe(200);
		expect(high.body.progress).toBe(100);
	});

	it('returns 400 when a string field has another type (R2: was a 500 from the DB bind)', async () => {
		for (const field of ['repoId', 'commit', 'currentFile', 'engine']) {
			const res = await callApi<ErrorResponse>(updateScan, {
				method: 'PUT',
				body: { active: true, repoId: 'oasis-core', [field]: { nested: true } }
			});
			expect(res.status).toBe(400);
			expect(res.body.error).toBe(`\`${field}\` must be a string or null`);
		}
		expect(getScan().active).toBe(false);
	});

	it('returns 400 when startedAt is not a non-negative integer', async () => {
		for (const startedAt of ['2026-10-03T12:00:00Z', 1.5, -1]) {
			const res = await callApi<ErrorResponse>(updateScan, {
				method: 'PUT',
				body: { active: true, repoId: 'oasis-core', startedAt }
			});
			expect(res.status).toBe(400);
			expect(res.body.error).toBe('`startedAt` must be a non-negative integer');
		}
	});

	it('returns 400 when the JSON body is not an object', async () => {
		for (const body of [null, [{ active: true }], 'true']) {
			const res = await callApi<ErrorResponse>(updateScan, { method: 'PUT', body });
			expect(res.status).toBe(400);
			expect(res.body.error).toBe('JSON body must be an object');
		}
	});
});
