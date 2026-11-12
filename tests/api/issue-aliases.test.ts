import { beforeEach, expect, it, vi } from 'vitest';
import { db } from '$lib/server/db';
import { addRepo, getRepoDetail } from '$lib/server/repos';
import { insertReview } from '$lib/server/ingest';
import { issueIdentity } from '$lib/server/fingerprint';
import { getReviewDetail } from '$lib/server/reviews';
import { resetDb, callApi } from '../test-utils';

const modules = import.meta.glob('../../src/routes/api/repos/[[]id]/issue-aliases/+server.ts', {
	eager: true
}) as Record<string, { GET: Parameters<typeof callApi>[0]; POST: Parameters<typeof callApi>[0] }>;
function handlers() {
	const route = Object.values(modules)[0];
	expect(route, 'repo-scoped alias API must exist').toBeDefined();
	return route;
}
const a = { severity: 'high' as const, title: 'Unchecked input', file: 'src/handler.ts', line: 8 };
const b = { ...a, title: 'Missing input guard', line: 12 };
const root = issueIdentity(a),
	alias = issueIdentity(b);
beforeEach(() => {
	resetDb();
	vi.stubEnv('HERMES_API_TOKEN', 'test-only');
	addRepo({ id: 'r', lang: 'TS' });
});
function historical() {
	return insertReview('r', { commit: 'a', findings: [a, b] }).id;
}
const send = (body: unknown, headers = { authorization: 'Bearer test-only' }, id = 'r') =>
	callApi<{ ok: boolean; duplicate: boolean; alias: Record<string, unknown>; error: string }>(
		handlers().POST,
		{ method: 'POST', params: { id }, headers, body }
	);
it('requires configured authentication even when other mutation endpoints are open', async () => {
	const reviewId = historical();
	const payload = {
		fingerprint: alias,
		issueId: root,
		reason: 'Same sink',
		sourceReviewIds: [reviewId]
	};
	expect((await send(payload, { authorization: '' })).status).toBe(401);
	expect((await send(payload, { authorization: 'Bearer wrong-token' })).status).toBe(401);
	vi.stubEnv('HERMES_API_TOKEN', '');
	expect((await send(payload)).status).toBe(503);
	expect(db.prepare('SELECT * FROM issue_aliases').all()).toEqual([]);
	expect((await callApi(handlers().GET, { params: { id: 'missing' } })).status).toBe(404);
	vi.stubEnv('HERMES_API_TOKEN', 'test-only');
	expect((await send(payload, { authorization: 'Bearer test-only' }, 'missing')).status).toBe(404);
});

it('rejects alias reparenting and reverse cycles without modifying its original audit record', async () => {
	const reviewId = historical();
	const payload = {
		fingerprint: alias,
		issueId: root,
		reason: 'Same sink',
		sourceReviewIds: [reviewId]
	};
	expect((await send(payload)).status).toBe(201);
	const before = db.prepare('SELECT * FROM issue_aliases').all();
	expect((await send({ ...payload, fingerprint: root, issueId: alias })).status).toBe(400);
	const c = { ...a, title: 'Independent sink' };
	const other = insertReview('r', { commit: 'b', findings: [c] }).id;
	expect(
		(await send({ ...payload, issueId: issueIdentity(c), sourceReviewIds: [reviewId, other] }))
			.status
	).toBe(400);
	expect(db.prepare('SELECT * FROM issue_aliases').all()).toEqual(before);
});

it('does not claim an exact-edge retry when a different direct target only matches transitively', async () => {
	const reviewId = historical();
	const c = { ...a, title: 'Third historical report' };
	const cId = issueIdentity(c);
	const cReview = insertReview('r', { commit: 'b', findings: [c] }).id;
	expect(
		(
			await send({
				fingerprint: alias,
				issueId: root,
				reason: 'Same sink',
				sourceReviewIds: [reviewId]
			})
		).status
	).toBe(201);
	expect(
		(
			await send({
				fingerprint: root,
				issueId: cId,
				reason: 'Reviewed root continuity',
				sourceReviewIds: [reviewId, cReview]
			})
		).status
	).toBe(201);
	const before = db.prepare('SELECT * FROM issue_aliases').all();
	expect(
		(
			await send({
				fingerprint: alias,
				issueId: cId,
				reason: 'Different direct edge',
				sourceReviewIds: [reviewId, cReview]
			})
		).status
	).toBe(400);
	expect(db.prepare('SELECT * FROM issue_aliases').all()).toEqual(before);
	// An ingest membership claim is not a request to repoint an explicit edge.
	const carried = insertReview('r', {
		commit: 'c',
		findings: [{ ...b, issueId: cId, continuityEvidence: 'Same already-reviewed component' }]
	});
	expect(getReviewDetail(carried.id)?.findings[0].issueId).toBe(cId);
	expect(getReviewDetail(carried.id)?.newCount).toBe(0);
	expect(db.prepare('SELECT * FROM issue_aliases').all()).toEqual(before);
});

it('rejects aliases without bounded repo-local evidence for both identities', async () => {
	const reviewId = historical();
	const payload = {
		fingerprint: alias,
		issueId: root,
		reason: 'Same sink',
		sourceReviewIds: [reviewId]
	};
	const invalid = [
		{ sourceReviewIds: [] },
		{ sourceReviewIds: [null] },
		{ sourceReviewIds: [''] },
		{ sourceReviewIds: ['x'.repeat(201)] },
		{ sourceReviewIds: Array(101).fill(reviewId) },
		{ sourceReviewIds: ['missing-review'] },
		{ fingerprint: '0'.repeat(16) },
		{ fingerprint: root },
		{ reason: '' },
		{ reason: ' '.repeat(3) },
		{ reason: 'x'.repeat(4001) },
		{ fingerprint: 'A'.repeat(16) },
		{ issueId: '0'.repeat(16) }
	];
	for (const change of invalid) {
		expect((await send({ ...payload, ...change })).status, JSON.stringify(change)).toBe(400);
		expect(db.prepare('SELECT * FROM issue_aliases').all()).toEqual([]);
	}
	addRepo({ id: 'other', lang: 'TS' });
	const elsewhere = insertReview('other', { commit: 'a', findings: [a, b] }).id;
	expect((await send({ ...payload, sourceReviewIds: [elsewhere] })).status).toBe(400);
	const unrelated = insertReview('r', {
		commit: 'c',
		findings: [{ ...a, title: 'Unrelated issue' }]
	}).id;
	expect((await send({ ...payload, sourceReviewIds: [unrelated] })).status).toBe(400);
});

it('audits an explicit historical alias idempotently without rewriting discovery snapshots or occurrences', async () => {
	const reviewId = historical();
	const findings = db.prepare('SELECT * FROM findings').all();
	const reviews = db.prepare('SELECT * FROM reviews').all();
	const payload = {
		fingerprint: alias,
		issueId: root,
		reason: 'Reviewed identical request sink',
		sourceReviewIds: [reviewId]
	};
	const version = Number(
		db.prepare("SELECT value FROM meta WHERE key = 'data_version'").get()?.value
	);
	const result = await send(payload);
	expect(result.status).toBe(201);
	expect(
		Number(db.prepare("SELECT value FROM meta WHERE key = 'data_version'").get()?.value)
	).toBeGreaterThan(version);
	expect(result.body.alias).toMatchObject({
		...payload,
		actor: 'api-token',
		createdAt: expect.any(Number)
	});
	const duplicate = await send(payload);
	expect(duplicate.status).toBe(200);
	expect(duplicate.body.duplicate).toBe(true);
	expect(duplicate.body.alias).toEqual(result.body.alias);
	const index = await callApi<{ aliases: unknown[] }>(handlers().GET, { params: { id: 'r' } });
	expect(index.status).toBe(200);
	expect(index.body.aliases).toEqual([result.body.alias]);
	expect(db.prepare('SELECT * FROM findings').all()).toEqual(findings);
	expect(db.prepare('SELECT * FROM reviews').all()).toEqual(reviews);
	const detail = getReviewDetail(reviewId)!;
	expect(detail.newCount).toBe(2);
	expect(detail.findings.map((f) => f.isNew)).toEqual([true, true]);
	expect(detail.findings.map((f) => f.issueId)).toEqual([root, root]);
	expect(detail.findings.flatMap((f) => f.locations)).toEqual([
		{ file: a.file, line: 8, locationKey: '' },
		{ file: b.file, line: 12, locationKey: '' }
	]);
	expect(detail.counts.total).toBe(2); // Historical/raw review groups, not corrected unions.
	expect(getRepoDetail('r')?.counts.total).toBe(1); // Current canonical commit union.
});
