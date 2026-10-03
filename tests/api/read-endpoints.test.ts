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
import { requestRerun, setNextRun } from '$lib/server/meta';
import { db } from '$lib/server/db';
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

const T0 = Date.UTC(2026, 5, 16, 9, 46, 12);
const HOUR = 3_600_000;

// Display strings the API no longer returns (decision #13): it sends raw epoch-ms
// timestamps and second counts, and the client formats them.
const REMOVED_OVERVIEW_FIELDS = ['avgScanLabel', 'orgLabel', 'lastRunLabel', 'nextRunLabel'];
const REMOVED_REPO_FIELDS = ['langColor', 'statusLabel', 'glyph', 'lastRunLabel', 'lastDurationLabel'];
const REMOVED_REVIEW_FIELDS = ['dateLabel', 'agoLabel', 'durationLabel'];

function expectNoFields(body: object, fields: string[]) {
	for (const f of fields) expect(body, `removed field "${f}" is back`).not.toHaveProperty(f);
}

describe('API Read Endpoints', () => {
	const repoId = 'oasis-core';
	let reviewId = '';

	beforeEach(() => {
		resetDb();
		addRepo({ id: repoId, lang: 'Rust', description: 'Core consensus' });
		const res = insertReview(repoId, {
			commit: 'c001',
			createdAt: T0,
			durationSecs: 231,
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

		it('returns raw run times and durations instead of display labels', async () => {
			setNextRun(T0 + 6 * HOUR);
			const res = await callApi<Overview>(getOverview);
			expect(res.body.lastRunAt).toBe(T0);
			expect(res.body.avgScanSecs).toBe(231);
			expect(res.body.nextRunAt).toBe(T0 + 6 * HOUR);
			expectNoFields(res.body, REMOVED_OVERVIEW_FIELDS);
			expectNoFields(res.body.repos[0], REMOVED_REPO_FIELDS);
		});

		it('returns null run fields before any review, and the mean duration in whole seconds', async () => {
			resetDb();
			addRepo({ id: repoId, lang: 'Rust' });
			const empty = await callApi<Overview>(getOverview);
			expect(empty.body.lastRunAt).toBeNull();
			expect(empty.body.avgScanSecs).toBeNull();
			expect(empty.body.nextRunAt).toBeNull();
			expect(empty.body.repos[0].lastRunAt).toBeNull();
			expect(empty.body.repos[0].lastDurationSecs).toBeNull();

			insertReview(repoId, { commit: 'c001', createdAt: T0, durationSecs: 100 });
			insertReview(repoId, { commit: 'c002', createdAt: T0 + HOUR, durationSecs: 101 });
			const res = await callApi<Overview>(getOverview);
			expect(res.body.avgScanSecs).toBe(101); // mean 100.5 rounds to whole seconds
			expect(res.body.lastRunAt).toBe(T0 + HOUR);
		});

		it("times a repo's last run by its head commit, the overview by its newest review", async () => {
			insertReview(repoId, { commit: 'c002', createdAt: T0 + HOUR, durationSecs: 90 });
			// A later re-scan of the older commit (another model) is newer activity, but not
			// the repo's current code state.
			insertReview(repoId, { commit: 'c001', model: 'gpt-5', createdAt: T0 + 2 * HOUR, durationSecs: 60 });
			const res = await callApi<Overview>(getOverview);
			expect(res.body.lastRunAt).toBe(T0 + 2 * HOUR);
			expect(res.body.repos[0].headCommit).toBe('c002');
			expect(res.body.repos[0].lastRunAt).toBe(T0 + HOUR);
			expect(res.body.repos[0].lastDurationSecs).toBe(90);
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
			expect(res.body[0].lastRunAt).toBe(T0);
			expect(res.body[0].lastDurationSecs).toBe(231);
			expectNoFields(res.body[0], REMOVED_REPO_FIELDS);
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
			expect(res.body.lastRunAt).toBe(T0);
			expect(res.body.lastDurationSecs).toBe(231);
			expectNoFields(res.body, REMOVED_REPO_FIELDS);
			expect(res.body.reviews[0].createdAt).toBe(T0);
			expect(res.body.reviews[0].durationSecs).toBe(231);
			expectNoFields(res.body.reviews[0], REMOVED_REVIEW_FIELDS);
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
			expect(res.body[0].createdAt).toBe(T0);
			expect(res.body[0].durationSecs).toBe(231);
			expectNoFields(res.body[0], REMOVED_REVIEW_FIELDS);
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
			expect(res.body.reviews[0].createdAt).toBe(T0);
			expect(res.body.reviews[0].durationSecs).toBe(231);
			expectNoFields(res.body.reviews[0], REMOVED_REVIEW_FIELDS);
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
			expect(res.body.createdAt).toBe(T0);
			expect(res.body.durationSecs).toBe(231);
			expectNoFields(res.body, REMOVED_REVIEW_FIELDS);
		});
	});

	describe('GET /api/scan', () => {
		it('returns 200 with scan state shape including dataVersion', async () => {
			const res = await callApi<ScanState>(getScan);
			expect(res.status).toBe(200);
			expect(typeof res.body.active).toBe('boolean');
			expect(typeof res.body.progress).toBe('number');
			expect(typeof res.body.dataVersion).toBe('number');
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
		it('returns 200 when database is healthy', async () => {
			const res = await callApi<HealthResponse>(getHealth);
			expect(res.status).toBe(200);
			expect(res.body.ok).toBe(true);
			expect(res.body.service).toBe('hermes-security-dashboard');
		});

		it('returns 503 when database throws on query', async () => {
			const originalPrepare = db.prepare;
			db.prepare = ((sql: string) => {
				if (sql.includes('SELECT 1')) {
					throw new Error('database disk I/O error');
				}
				return originalPrepare.call(db, sql);
			}) as typeof db.prepare;

			try {
				const res = await callApi<{ ok: boolean; service: string; error?: string }>(getHealth);
				expect(res.status).toBe(503);
				expect(res.body.ok).toBe(false);
				expect(res.body.service).toBe('hermes-security-dashboard');
				expect(res.body.error).toContain('database disk I/O error');
			} finally {
				db.prepare = originalPrepare;
			}
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
