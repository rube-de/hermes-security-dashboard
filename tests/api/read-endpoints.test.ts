import { describe, it, expect, beforeEach } from 'vitest';
import { GET as getOverview } from '../../src/routes/api/overview/+server';
import { GET as getRepos } from '../../src/routes/api/repos/+server';
import { GET as getRepoDetail } from '../../src/routes/api/repos/[id]/+server';
import { GET as getRepoReviews } from '../../src/routes/api/repos/[id]/reviews/+server';
import { GET as getRepoRerun } from '../../src/routes/api/repos/[id]/rerun/+server';
import { GET as getReviews } from '../../src/routes/api/reviews/+server';
import { GET as getReviewDetail } from '../../src/routes/api/reviews/[id]/+server';
import { GET as getScan } from '../../src/routes/api/scan/+server';
import { GET as getTrends } from '../../src/routes/api/trends/+server';
import { GET as getHealth } from '../../src/routes/api/health/+server';
import { GET as getOpenApi } from '../../src/routes/api/openapi.json/+server';

import { addRepo } from '$lib/server/repos';
import { insertReview } from '$lib/server/ingest';
import { requestRerun } from '$lib/server/meta';
import { resetDb, callApi } from '../test-utils';
import type { Overview, RepoDetail, RepoSummary, ReviewDetail, ReviewSummary, ScanState, TrendBucket } from '$lib/types';

interface ErrorResponse {
	error: string;
}

interface RerunGetResponse {
	repoId: string;
	requestedAt: number | null;
	pending: boolean;
}

interface ReviewsListResponse {
	count: number;
	reviews: ReviewSummary[];
}

interface TrendsResponse {
	days: number;
	repo: string | null;
	buckets: TrendBucket[];
}

interface HealthResponse {
	ok: boolean;
	service: string;
}

interface OpenApiResponse {
	openapi: string;
	info: { title: string; version: string };
	paths: Record<string, unknown>;
}

describe('API Read Endpoints', () => {
	const repoId = 'oasis-core';
	let reviewId = '';

	beforeEach(() => {
		resetDb();
		addRepo({ id: repoId, lang: 'Rust', description: 'Core consensus' });
		const res = insertReview(repoId, {
			commit: 'c001',
			findings: [{ severity: 'high', file: 'src/main.rs', title: 'Buffer overflow' }]
		});
		reviewId = res.id;
	});

	describe('GET /api/overview', () => {
		it('returns 200 and matches overview response shape', async () => {
			const res = await callApi<Overview>(getOverview);
			expect(res.status).toBe(200);
			expect(res.body.totals).toBeDefined();
			expect(res.body.totals.high).toBe(1);
			expect(res.body.reposCount).toBe(1);
			expect(res.body.clean).toBe(0);
			expect(res.body.flagged).toBe(1);
			expect(Array.isArray(res.body.trend)).toBe(true);
			expect(Array.isArray(res.body.repos)).toBe(true);
		});
	});

	describe('GET /api/repos', () => {
		it('returns 200 with array of repo summaries', async () => {
			const res = await callApi<RepoSummary[]>(getRepos);
			expect(res.status).toBe(200);
			expect(Array.isArray(res.body)).toBe(true);
			expect(res.body).toHaveLength(1);
			expect(res.body[0].id).toBe(repoId);
			expect(res.body[0].lang).toBe('Rust');
			expect(res.body[0].counts.high).toBe(1);
		});
	});

	describe('GET /api/repos/[id]', () => {
		it('returns 404 when repository does not exist', async () => {
			const res = await callApi<ErrorResponse>(getRepoDetail, {
				params: { id: 'missing-repo' }
			});
			expect(res.status).toBe(404);
			expect(res.body.error).toBe('repository not found');
		});

		it('returns 200 with repo detail including reviews', async () => {
			const res = await callApi<RepoDetail>(getRepoDetail, {
				params: { id: repoId }
			});
			expect(res.status).toBe(200);
			expect(res.body.id).toBe(repoId);
			expect(Array.isArray(res.body.reviews)).toBe(true);
			expect(res.body.reviews).toHaveLength(1);
		});
	});

	describe('GET /api/repos/[id]/reviews', () => {
		it('returns 404 when repository does not exist', async () => {
			const res = await callApi<ErrorResponse>(getRepoReviews, {
				params: { id: 'missing-repo' }
			});
			expect(res.status).toBe(404);
			expect(res.body.error).toBe('repository not found');
		});

		it('returns 200 with array of review summaries', async () => {
			const res = await callApi<ReviewSummary[]>(getRepoReviews, {
				params: { id: repoId }
			});
			expect(res.status).toBe(200);
			expect(Array.isArray(res.body)).toBe(true);
			expect(res.body).toHaveLength(1);
			expect(res.body[0].commit).toBe('c001');
		});
	});

	describe('GET /api/repos/[id]/rerun', () => {
		it('returns 404 when repository does not exist', async () => {
			const res = await callApi<ErrorResponse>(getRepoRerun, {
				params: { id: 'missing-repo' }
			});
			expect(res.status).toBe(404);
			expect(res.body.error).toContain('not found');
		});

		it('returns 200 with pending: false when no rerun requested', async () => {
			const res = await callApi<RerunGetResponse>(getRepoRerun, {
				params: { id: repoId }
			});
			expect(res.status).toBe(200);
			expect(res.body.repoId).toBe(repoId);
			expect(res.body.pending).toBe(false);
			expect(res.body.requestedAt).toBeNull();
		});

		it('returns 200 with pending: true when rerun requested', async () => {
			requestRerun(repoId, 1700000000000);
			const res = await callApi<RerunGetResponse>(getRepoRerun, {
				params: { id: repoId }
			});
			expect(res.status).toBe(200);
			expect(res.body.pending).toBe(true);
			expect(res.body.requestedAt).toBe(1700000000000);
		});
	});

	describe('GET /api/reviews', () => {
		it('returns 200 with count and reviews list', async () => {
			const res = await callApi<ReviewsListResponse>(getReviews);
			expect(res.status).toBe(200);
			expect(res.body.count).toBe(1);
			expect(res.body.reviews).toHaveLength(1);
		});

		it('returns 400 when query params are invalid', async () => {
			const badSince = await callApi<ErrorResponse>(getReviews, {
				url: 'http://localhost/api/reviews?since=invalid-date'
			});
			expect(badSince.status).toBe(400);

			const badUntil = await callApi<ErrorResponse>(getReviews, {
				url: 'http://localhost/api/reviews?until=invalid-date'
			});
			expect(badUntil.status).toBe(400);

			const badLimit = await callApi<ErrorResponse>(getReviews, {
				url: 'http://localhost/api/reviews?limit=not-an-int'
			});
			expect(badLimit.status).toBe(400);
		});

		it('reads ?since=2024 as Jan 1 2024 UTC (R3)', async () => {
			insertReview(repoId, {
				commit: 'c-2023',
				createdAt: Date.UTC(2023, 11, 31, 23, 59),
				findings: []
			});
			insertReview(repoId, {
				commit: 'c-2024',
				createdAt: Date.UTC(2024, 0, 1, 0, 1),
				findings: []
			});
			const res = await callApi<ReviewsListResponse>(getReviews, {
				url: 'http://localhost/api/reviews?since=2024&until=2025'
			});
			expect(res.status).toBe(200);
			expect(res.body.reviews.map((r) => r.commit)).toEqual(['c-2024']);
		});

		it('returns 400 with an explicit error for epoch seconds', async () => {
			const res = await callApi<ErrorResponse>(getReviews, {
				url: 'http://localhost/api/reviews?since=1700000000'
			});
			expect(res.status).toBe(400);
			expect(res.body.error).toBe(
				'`since` looks like epoch seconds (10 digits); send epoch-ms or an ISO-8601 date'
			);
		});
	});

	describe('GET /api/reviews/[id]', () => {
		it('returns 404 when review is not found', async () => {
			const res = await callApi<ErrorResponse>(getReviewDetail, {
				params: { id: 'missing-review' }
			});
			expect(res.status).toBe(404);
			expect(res.body.error).toBe('review not found');
		});

		it('returns 200 with review detail shape', async () => {
			const res = await callApi<ReviewDetail>(getReviewDetail, {
				params: { id: reviewId }
			});
			expect(res.status).toBe(200);
			expect(res.body.id).toBe(reviewId);
			expect(res.body.commit).toBe('c001');
			expect(res.body.counts.high).toBe(1);
			expect(Array.isArray(res.body.findings)).toBe(true);
			expect(res.body.findings).toHaveLength(1);
			expect(res.body.diff).toBeDefined();
		});
	});

	describe('GET /api/scan', () => {
		it('returns 200 with scan state shape', async () => {
			const res = await callApi<ScanState>(getScan);
			expect(res.status).toBe(200);
			expect(typeof res.body.active).toBe('boolean');
			expect(typeof res.body.progress).toBe('number');
		});
	});

	describe('GET /api/trends', () => {
		it('returns 200 with trend buckets shape', async () => {
			const res = await callApi<TrendsResponse>(getTrends, {
				url: 'http://localhost/api/trends?days=7'
			});
			expect(res.status).toBe(200);
			expect(res.body.days).toBe(7);
			expect(Array.isArray(res.body.buckets)).toBe(true);
			expect(res.body.buckets).toHaveLength(7);
		});

		it('returns 400 when days param is not an integer', async () => {
			const res = await callApi<ErrorResponse>(getTrends, {
				url: 'http://localhost/api/trends?days=abc'
			});
			expect(res.status).toBe(400);
			expect(res.body.error).toContain('must be an integer');
		});
	});

	describe('GET /api/health', () => {
		// KNOWN-WRONG (H1, fixed by T07): /api/health returns static 200 without checking DB
		it('returns 200 static response (KNOWN-WRONG: H1)', async () => {
			const res = await callApi<HealthResponse>(getHealth);
			expect(res.status).toBe(200);
			expect(res.body.ok).toBe(true);
			expect(res.body.service).toBe('hermes-security-dashboard');
		});
	});

	describe('GET /api/openapi.json', () => {
		it('returns 200 with valid OpenAPI document', async () => {
			const res = await callApi<OpenApiResponse>(getOpenApi);
			expect(res.status).toBe(200);
			expect(res.body.openapi).toBe('3.1.0');
			expect(res.body.info).toBeDefined();
			expect(res.body.paths).toBeDefined();
			expect(res.body.paths['/api/overview']).toBeDefined();
		});
	});
});
