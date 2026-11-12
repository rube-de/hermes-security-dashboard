import { beforeEach, expect, it } from 'vitest';
import { db } from '$lib/server/db';
import { addRepo, getRepoDetail } from '$lib/server/repos';
import { insertReview } from '$lib/server/ingest';
import { getReviewDetail } from '$lib/server/reviews';
import { issueIdentity } from '$lib/server/fingerprint';
import { associateIssue } from '$lib/server/issue-continuity';
import { setTriage } from '$lib/server/triage';
import { resetDb, callApi } from '../test-utils';
import { PUT as triagePut } from '../../src/routes/api/repos/[id]/findings/[fingerprint]/triage/+server';

const original = { severity: 'high' as const, title: 'Unsafe callback', file: 'a.ts', line: 4 };
const root = issueIdentity(original);
// Historical associations use the separately reviewed alias operation, not ingest.
function reviewedAlias(fp: string, target = root): void {
	const sourceReviewIds = (
		db
			.prepare(
				'SELECT DISTINCT review_id FROM findings WHERE repo_id = ? AND fingerprint IN (?, ?)'
			)
			.all('r', fp, target) as { review_id: string }[]
	).map((r) => r.review_id);
	associateIssue(
		'r',
		fp,
		target,
		'Explicitly reviewed synthetic association',
		{ actor: 'api-token', sourceReviewIds },
		'exact-edge'
	);
}
beforeEach(() => {
	resetDb();
	addRepo({ id: 'r', lang: 'TS' });
});
it('carries location-key changes and keeps all co-occurring raw aliases while classifying genuinely new issues separately', () => {
	const scanner = { ...original, ruleId: 'Exact.Scanner/Rule', locationKey: 'Handler.before' };
	const canonicalId = issueIdentity(scanner);
	insertReview('r', { commit: 'a', findings: [scanner], createdAt: 1000 });
	const variants = [
		{
			...scanner,
			line: 20,
			locationKey: 'Handler.after',
			issueId: canonicalId,
			continuityEvidence: 'Same renamed handler'
		},
		{
			...original,
			line: 30,
			title: 'Second wording',
			issueId: canonicalId,
			continuityEvidence: 'Same sink reported without scanner rule'
		}
	];
	const genuine = {
		...original,
		title: 'Independent request boundary',
		line: 50,
		noveltyReason: 'Different sink and guard failure'
	};
	const second = insertReview('r', {
		commit: 'b',
		findings: [...variants, genuine],
		createdAt: 2000
	});
	const review = getReviewDetail(second.id)!;
	expect(review.newCount).toBe(1);
	expect(review.findings).toHaveLength(3);
	expect(review.counts.total).toBe(3);
	expect(review.findings.map((f) => f.fingerprint)).toEqual([
		...variants.map(issueIdentity),
		issueIdentity(genuine)
	]);
	expect(review.findings.map((f) => f.issueId)).toEqual([
		canonicalId,
		canonicalId,
		issueIdentity(genuine)
	]);
	expect(review.findings.map((f) => f.isNew)).toEqual([false, false, true]);
	expect(review.findings.flatMap((f) => f.locations).map((l) => l.line)).toEqual([20, 30, 50]);
	expect(review.findings[2].noveltyReason).toBe(genuine.noveltyReason);
	expect(getRepoDetail('r')?.counts.total).toBe(2);
	expect(getRepoDetail('r')?.commits[0]).toMatchObject({ newCount: 1, fixedCount: 0 });
	const replay = insertReview('r', { commit: 'c', findings: variants, createdAt: 3000 });
	expect(getReviewDetail(replay.id)?.newCount).toBe(0);
});

it('derives canonical oldest-open time from unchanged historical raw discovery rows', () => {
	insertReview('r', { commit: 'a', findings: [original], createdAt: 1000 });
	const alternate = { ...original, title: 'Alternate recent report' };
	const recent = insertReview('r', { commit: 'b', findings: [alternate], createdAt: 3000 });
	const before = db
		.prepare('SELECT first_seen_at FROM findings WHERE review_id = ?')
		.get(recent.id);
	reviewedAlias(issueIdentity(alternate));
	insertReview('r', {
		commit: 'older-rescan',
		findings: [{ ...alternate, issueId: root, continuityEvidence: 'Same issue reviewed later' }],
		createdAt: 2000
	});
	expect(getRepoDetail('r')?.oldestOpenAt).toBe(1000);
	expect(
		db.prepare('SELECT first_seen_at FROM findings WHERE review_id = ?').get(recent.id)
	).toEqual(before);
});

it('applies canonical human quieting to a raw historical resolved snapshot', () => {
	const alias = { ...original, title: 'Alternate description' };
	insertReview('r', { commit: 'a', findings: [original, alias], createdAt: 1000 });
	const empty = insertReview('r', { commit: 'b', findings: [], createdAt: 2000 });
	const snapshot = db
		.prepare('SELECT resolved_json, resolved_count FROM reviews WHERE id = ?')
		.get(empty.id);
	reviewedAlias(issueIdentity(alias));
	insertReview('r', {
		commit: 'c',
		findings: [{ ...alias, issueId: root, continuityEvidence: 'Reviewed same underlying issue' }],
		createdAt: 3000
	});
	setTriage('r', root, 'accepted_risk', 'Explicit risk acceptance');
	expect(getReviewDetail(empty.id)?.resolved).toEqual([]);
	expect(
		db.prepare('SELECT resolved_json, resolved_count FROM reviews WHERE id = ?').get(empty.id)
	).toEqual(snapshot);
});

it('rejects order-dependent aliases that make another submitted issueId noncanonical', () => {
	const b = { ...original, title: 'Other known root' };
	insertReview('r', { commit: 'a', findings: [original, b] });
	expect(() =>
		insertReview('r', {
			commit: 'b',
			findings: [
				{ ...original, title: 'Reworded', issueId: root, continuityEvidence: 'Match first root' },
				{
					...original,
					issueId: issueIdentity(b),
					continuityEvidence: 'Move first root to second root'
				}
			]
		})
	).toThrow(/canonical|conflict/);
	expect(db.prepare('SELECT * FROM issue_aliases').all()).toEqual([]);
});

it('never resolves an issueId through another repository and keeps legacy discoveries repo scoped', () => {
	insertReview('r', { commit: 'a', findings: [original] });
	addRepo({ id: 'other', lang: 'TS' });
	expect(() =>
		insertReview('other', {
			commit: 'a',
			findings: [{ ...original, title: 'Renamed', issueId: root, continuityEvidence: 'Not local' }]
		})
	).toThrow(/unknown issueId/);
	expect(db.prepare('SELECT * FROM issue_aliases WHERE repo_id = ?').all('other')).toEqual([]);
	const legacy = insertReview('other', { commit: 'b', findings: [original] });
	expect(getReviewDetail(legacy.id)?.newCount).toBe(1);
});

it('inherits an alias-only oldest tag and permits later explicit human updates through root or alias', async () => {
	const b = { ...original, title: 'Alternate report' };
	const bId = issueIdentity(b);
	insertReview('r', { commit: 'a', findings: [original, b] });
	setTriage('r', bId, 'acknowledged', 'Original review', 'human-a', 100);
	const tags = db.prepare('SELECT * FROM finding_triage').all();
	reviewedAlias(bId);
	const latest = insertReview('r', {
		commit: 'b',
		findings: [{ ...b, issueId: root, continuityEvidence: 'Same underlying request path' }]
	});
	expect(db.prepare('SELECT * FROM finding_triage').all()).toEqual(tags);
	expect(getReviewDetail(latest.id)?.findings[0].triage).toMatchObject({
		status: 'acknowledged',
		createdAt: 100,
		triagedBy: 'human-a'
	});
	for (const fp of [root, bId]) {
		const status = fp === root ? 'accepted_risk' : 'false_positive';
		const result = await callApi(triagePut, {
			method: 'PUT',
			params: { id: 'r', fingerprint: fp },
			headers: { 'x-hermes-user': 'human-b' },
			body: { status, note: 'Explicit later review' }
		});
		expect(result.status).toBe(200);
		expect(getReviewDetail(latest.id)?.findings[0].triage).toMatchObject({
			status,
			createdAt: 100,
			triagedBy: 'human-b'
		});
		expect(db.prepare('SELECT * FROM finding_triage').all()).toHaveLength(1);
	}
	expect(
		(
			await callApi(triagePut, {
				method: 'PUT',
				params: { id: 'r', fingerprint: root },
				body: { status: 'open' }
			})
		).status
	).toBe(200);
	expect(getReviewDetail(latest.id)?.findings[0].triage).toBeNull();
	expect(db.prepare('SELECT * FROM finding_triage').all()).toEqual([]);
});

it('fails closed on unexpected post-merge conflicting tags but allows an explicit human reconciliation', async () => {
	const alias = { ...original, title: 'Alternate tag-bearing report' };
	insertReview('r', { commit: 'a', findings: [original, alias] });
	reviewedAlias(issueIdentity(alias));
	const linked = insertReview('r', {
		commit: 'b',
		findings: [{ ...alias, issueId: root, continuityEvidence: 'Same request sink' }]
	});
	setTriage('r', root, 'acknowledged', 'Initial review', 'human-a', 100);
	// Model an older writer operating on an alias key after the component was linked.
	db.prepare(
		"INSERT INTO finding_triage (repo_id, fingerprint, status, note, created_at, updated_at, triaged_by) VALUES ('r', ?, 'false_positive', 'Conflicting older writer', 200, 200, 'human-b')"
	).run(issueIdentity(alias));
	expect(() => getReviewDetail(linked.id)).toThrow(/conflicting.*triage|triage.*conflict/);
	const response = await callApi(triagePut, {
		method: 'PUT',
		params: { id: 'r', fingerprint: root },
		body: { status: 'accepted_risk', note: 'Explicit reconciliation' }
	});
	expect(response.status).toBe(200);
	expect(getReviewDetail(linked.id)?.findings[0].triage?.status).toBe('accepted_risk');
	expect(db.prepare('SELECT status, note FROM finding_triage').all()).toEqual([
		{ status: 'accepted_risk', note: 'Explicit reconciliation' },
		{ status: 'accepted_risk', note: 'Explicit reconciliation' }
	]);
});

it('rejects associations with conflicting human verdicts without mutating any triage row', () => {
	const b = { ...original, title: 'Another report' };
	insertReview('r', { commit: 'a', findings: [original, b] });
	setTriage('r', root, 'acknowledged', 'Investigating', 'human-a', 100);
	setTriage('r', issueIdentity(b), 'false_positive', 'Guarded', 'human-b', 200);
	const tags = db.prepare('SELECT * FROM finding_triage').all();
	expect(() => reviewedAlias(issueIdentity(b))).toThrow(/triage.*conflict|conflicting.*triage/);
	expect(db.prepare('SELECT * FROM finding_triage').all()).toEqual(tags);
	expect(db.prepare('SELECT * FROM issue_aliases').all()).toEqual([]);
});

it('rejects reverse or noncanonical associations before duplicate short circuit', () => {
	const b = { ...original, title: 'Second issue' };
	const bId = issueIdentity(b);
	insertReview('r', { commit: 'a', findings: [original, b] });
	reviewedAlias(bId);
	insertReview('r', {
		commit: 'b',
		findings: [{ ...b, issueId: root, continuityEvidence: 'Reviewed same sink' }]
	});
	const before = db.prepare('SELECT * FROM issue_aliases').all();
	expect(() =>
		insertReview('r', {
			commit: 'a',
			findings: [{ ...original, issueId: bId, continuityEvidence: 'Reverse edge' }, b]
		})
	).toThrow(/canonical|cyclic|conflict/);
	expect(db.prepare('SELECT * FROM issue_aliases').all()).toEqual(before);
});

it('rolls back every proposed association if a later finding references an unknown issue', () => {
	insertReview('r', { commit: 'a', findings: [original] });
	const changed = {
		...original,
		title: 'Changed report',
		issueId: root,
		continuityEvidence: 'Same sink'
	};
	const before = db.prepare('SELECT * FROM findings').all();
	expect(() =>
		insertReview('r', {
			commit: 'b',
			findings: [
				changed,
				{ ...original, title: 'Other', issueId: '0'.repeat(16), continuityEvidence: 'Unknown' }
			]
		})
	).toThrow(/unknown issueId/);
	expect(db.prepare('SELECT * FROM issue_aliases').all()).toEqual([]);
	expect(db.prepare('SELECT * FROM findings').all()).toEqual(before);
});

it('carries a rephrased finding by explicit known issueId without rewriting historical evidence', () => {
	const first = insertReview('r', { commit: 'a', createdAt: 1000, findings: [original] });
	setTriage('r', root, 'acknowledged', 'reviewed', 'human', 1001);
	const before = db.prepare('SELECT * FROM findings WHERE review_id = ?').all(first.id);
	const tag = db.prepare('SELECT * FROM finding_triage').all();
	const next = {
		...original,
		title: 'Callback permits reentry',
		line: 9,
		issueId: root,
		continuityEvidence: 'Same unchecked callback and entrypoint'
	};
	const second = insertReview('r', { commit: 'b', createdAt: 2000, findings: [next] });
	const review = getReviewDetail(second.id)!;
	expect(review.newCount).toBe(0);
	const audit = db
		.prepare('SELECT actor, source_review_ids FROM issue_aliases WHERE fingerprint = ?')
		.get(issueIdentity(next))!;
	expect(audit.actor).toBe('review-submission');
	expect(JSON.parse(audit.source_review_ids as string)).toEqual([first.id, second.id]);
	expect(review.findings[0]).toMatchObject({
		submittedIssueId: root,
		continuityEvidence: next.continuityEvidence,
		noveltyReason: ''
	});
	expect(review.resolvedCount).toBe(0);
	expect(review.findings[0]).toMatchObject({
		fingerprint: issueIdentity(next),
		issueId: root,
		triage: { status: 'acknowledged', triagedBy: 'human' }
	});
	expect(db.prepare('SELECT * FROM findings WHERE review_id = ?').all(first.id)).toEqual(before);
	expect(db.prepare('SELECT * FROM finding_triage').all()).toEqual(tag);
	expect(
		db.prepare('SELECT first_seen_at FROM findings WHERE review_id = ?').get(second.id)
			?.first_seen_at
	).toBe(1000);
	expect(getRepoDetail('r')?.commits[0]).toMatchObject({ newCount: 0, fixedCount: 0 });
});
