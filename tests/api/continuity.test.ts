import { beforeEach, expect, it, vi } from 'vitest';
import { db } from '$lib/server/db';
import { addRepo } from '$lib/server/repos';
import { issueIdentity } from '$lib/server/fingerprint';
import { POST as submit } from '../../src/routes/api/repos/[id]/reviews/+server';
import { GET as health } from '../../src/routes/api/health/+server';
import { GET as detail } from '../../src/routes/api/reviews/[id]/+server';
import { resetDb, callApi } from '../test-utils';
import type { ReviewDetail } from '$lib/types';

const base = { severity: 'high', title: 'Unchecked request', file: 'src/handler.ts', line: 8 };
const root = issueIdentity(base);
beforeEach(() => {
	resetDb();
	vi.stubEnv('HERMES_API_TOKEN', '');
	addRepo({ id: 'r', lang: 'TS' });
});
const post = (commit: string, findings: unknown[]) =>
	callApi<{ reviewId: string; error?: string }>(submit, {
		method: 'POST',
		params: { id: 'r' },
		body: { commit, findings }
	});
it('rejects a duplicate-place claim that occurrence dedup would discard, including on legacy retries', async () => {
	await post('root', [base]);
	const other = { ...base, title: 'Different source wording' };
	await post('existing', [other]);
	const before = db.prepare('SELECT * FROM findings').all();
	const reviews = db.prepare('SELECT * FROM reviews').all();
	const explicit = { ...other, issueId: root, continuityEvidence: 'Same reviewed request sink' };
	for (const commit of ['new', 'existing']) {
		for (const findings of [
			[other, explicit],
			[explicit, other]
		]) {
			const response = await post(commit, findings);
			expect(response.status).toBe(400);
			expect(response.body.error).toMatch(/duplicate.*continuity|conflicting.*occurrence/);
			expect(db.prepare('SELECT * FROM issue_aliases').all()).toEqual([]);
			expect(db.prepare('SELECT * FROM findings').all()).toEqual(before);
			expect(db.prepare('SELECT * FROM reviews').all()).toEqual(reviews);
		}
	}
});

it('keeps same-commit continuity reports distinct when raw title or occurrence evidence changes', async () => {
	const scanner = { ...base, ruleId: 'Exact.Rule', locationKey: 'Handler.process' };
	const fp = issueIdentity(scanner);
	await post('a', [scanner]);
	const known = { ...scanner, issueId: fp }; // Same raw identity needs no continuity reason.
	const first = await post('a', [known]);
	const changed = {
		...known,
		title: 'Different wording',
		line: 19,
		description: 'Original source text'
	};
	const second = await post('a', [changed]);
	expect(second.status).toBe(201);
	expect(second.body.reviewId).not.toBe(first.body.reviewId);
	const read = await callApi<ReviewDetail>(detail, { params: { id: second.body.reviewId } });
	expect(read.body.findings[0]).toMatchObject({
		title: changed.title,
		line: 19,
		description: changed.description,
		ruleId: 'Exact.Rule',
		issueId: fp,
		isNew: false
	});
	const retry = await post('a', [changed]);
	expect(retry.status).toBe(200);
	expect(retry.body.reviewId).toBe(second.body.reviewId);
});

it('advertises implemented continuity capability on healthy database only', async () => {
	const result = await callApi<{ capabilities: { issueContinuity: number } }>(health);
	expect(result.status).toBe(200);
	expect(result.body.capabilities).toEqual({ issueContinuity: 1 });
});

it('rejects malformed continuity contracts before any write or duplicate return', async () => {
	await post('a', [base]);
	const reviews = db.prepare('SELECT * FROM reviews').all();
	const invalid = [
		{ issueId: null },
		{ issueId: '' },
		{ issueId: 'A'.repeat(16) },
		{ issueId: ' ' + root },
		{ issueId: 1 },
		{ issueId: root, title: 'Changed title' },
		{ continuityEvidence: 'orphan evidence' },
		{ continuityEvidence: null },
		{ issueId: root, continuityEvidence: '' },
		{ issueId: root, continuityEvidence: ' '.repeat(5) },
		{ issueId: root, continuityEvidence: 'x'.repeat(4001) },
		{ noveltyReason: null },
		{ noveltyReason: '' },
		{ noveltyReason: 12 },
		{ noveltyReason: 'x'.repeat(4001) },
		{ issueId: '0'.repeat(16) }
	];
	for (const fields of invalid) {
		const result = await post('a', [{ ...base, ...fields }]);
		expect(result.status, JSON.stringify(fields)).toBe(400);
		expect(db.prepare('SELECT * FROM reviews').all()).toEqual(reviews);
		expect(db.prepare('SELECT * FROM issue_aliases').all()).toEqual([]);
	}
});

it('round trips explicit continuity while preserving exact scanner rule and location evidence', async () => {
	expect((await post('a', [base])).status).toBe(201);
	const next = {
		...base,
		title: 'Unvalidated request',
		ruleId: 'Exact.Scanner/Rule-ID',
		locationKey: 'Handler.process',
		issueId: root,
		continuityEvidence: 'Same request sink and missing guard'
	};
	const result = await post('b', [next]);
	expect(result.status).toBe(201);
	const read = await callApi<ReviewDetail>(detail, { params: { id: result.body.reviewId } });
	expect(read.body.newCount).toBe(0);
	expect(read.body.findings[0]).toMatchObject({
		issueId: root,
		fingerprint: issueIdentity(next),
		ruleId: next.ruleId,
		locationKey: next.locationKey,
		continuityEvidence: next.continuityEvidence
	});
	expect(read.body.findings[0].locations).toEqual([
		{ file: base.file, line: 8, locationKey: next.locationKey }
	]);
	expect(
		db.prepare('SELECT rule_id FROM findings WHERE review_id = ?').get(result.body.reviewId)
			?.rule_id
	).toBe(next.ruleId);
});
