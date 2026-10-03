import { describe, it, expect, beforeEach } from 'vitest';
import { POST as submitReview } from '../../src/routes/api/repos/[id]/reviews/+server';
import { GET as getReview } from '../../src/routes/api/reviews/[id]/+server';
import { addRepo } from '$lib/server/repos';
import { listReviews } from '$lib/server/reviews';
import { resetDb, callApi } from '../test-utils';
import type { ReviewDetail } from '$lib/types';

interface ErrorResponse {
	error: string;
}

interface ReviewSubmitResponse {
	ok: boolean;
	reviewId: string;
}

const repoId = 'contract-repo';

async function submit(body: unknown) {
	return callApi<ReviewSubmitResponse & ErrorResponse>(submitReview, {
		method: 'POST',
		params: { id: repoId },
		body
	});
}

async function fetchReview(id: string): Promise<ReviewDetail> {
	const res = await callApi<ReviewDetail>(getReview, { params: { id } });
	expect(res.status).toBe(200);
	return res.body;
}

describe('agent contract fields: ruleId, locationKey, agentVersion', () => {
	beforeEach(() => {
		resetDb();
		addRepo({ id: repoId, lang: 'Solidity' });
	});

	it('round-trips through GET /api/reviews/:id, trimmed', async () => {
		const res = await submit({
			commit: 'c001',
			agentVersion: ' hermes-agent 1.4.2 ',
			findings: [
				{
					severity: 'high',
					title: 'Unchecked low-level call',
					file: 'contracts/Vault.sol',
					line: 88,
					ruleId: ' unchecked-lowlevel ',
					locationKey: ' Vault.withdraw '
				}
			]
		});
		expect(res.status).toBe(201);

		const review = await fetchReview(res.body.reviewId);
		expect(review.agentVersion).toBe('hermes-agent 1.4.2');
		expect(review.findings).toHaveLength(1);
		expect(review.findings[0].ruleId).toBe('unchecked-lowlevel');
		expect(review.findings[0].locationKey).toBe('Vault.withdraw');
	});

	it('accepts payloads without them (or with null) and reports empty strings', async () => {
		const res = await submit({
			commit: 'c001',
			agentVersion: null,
			findings: [
				{ severity: 'med', title: 'Old-style finding', file: 'a.sol' },
				{ severity: 'low', title: 'Null fields', file: 'b.sol', ruleId: null, locationKey: null }
			]
		});
		expect(res.status).toBe(201);

		const review = await fetchReview(res.body.reviewId);
		expect(review.agentVersion).toBe('');
		expect(review.findings.map((f) => [f.ruleId, f.locationKey])).toEqual([
			['', ''],
			['', '']
		]);
	});

	it('returns 400 when a field is not a string, storing nothing', async () => {
		const cases: [unknown, string][] = [
			[{ commit: 'c001', agentVersion: 5 }, '`agentVersion` must be a string'],
			[
				{ commit: 'c001', findings: [{ severity: 'high', title: 'x', ruleId: { id: 'r' } }] },
				'findings[0].ruleId must be a string'
			],
			[
				{ commit: 'c001', findings: [{ severity: 'high', title: 'x', locationKey: ['fn'] }] },
				'findings[0].locationKey must be a string'
			]
		];
		for (const [body, error] of cases) {
			const res = await submit(body);
			expect(res.status).toBe(400);
			expect(res.body.error).toBe(error);
		}
		expect(listReviews({ repoId })).toHaveLength(0);
	});

	it('enforces a 200-character limit after trimming', async () => {
		const atLimit = await submit({
			commit: 'c001',
			agentVersion: ` ${'v'.repeat(200)} `,
			findings: [{ severity: 'high', title: 'x', ruleId: 'r'.repeat(200) }]
		});
		expect(atLimit.status).toBe(201);

		const over = await submit({
			commit: 'c002',
			findings: [{ severity: 'high', title: 'x', locationKey: 'k'.repeat(201) }]
		});
		expect(over.status).toBe(400);
		expect(over.body.error).toBe('findings[0].locationKey must be at most 200 characters');
	});
});
