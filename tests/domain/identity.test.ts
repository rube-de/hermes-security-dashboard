import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '$lib/server/db';
import { addRepo, getRepoDetail } from '$lib/server/repos';
import { insertReview, type FindingInput } from '$lib/server/ingest';
import { getReviewDetail } from '$lib/server/reviews';
import { setTriage } from '$lib/server/triage';
import { fingerprint, issueIdentity } from '$lib/server/fingerprint';
import { resetDb } from '../test-utils';

const repoId = 'identity-repo';

function rowsOf(reviewId: string) {
	return db
		.prepare('SELECT fingerprint, line, is_new, first_seen_at FROM findings WHERE review_id = ? ORDER BY id')
		.all(reviewId) as { fingerprint: string; line: number; is_new: number; first_seen_at: number }[];
}

describe('finding identity at ingest', () => {
	beforeEach(() => {
		resetDb();
		addRepo({ id: repoId, lang: 'Solidity' });
	});

	const unchecked = (line: number, locationKey?: string): FindingInput => ({
		severity: 'high',
		title: 'Unchecked external call',
		file: 'contracts/Vault.sol',
		line,
		ruleId: 'unchecked-lowlevel',
		locationKey
	});

	it('stores same file + title in different functions as 2 issues', () => {
		const { id } = insertReview(repoId, {
			commit: 'c001',
			findings: [unchecked(88, 'Vault.withdraw'), unchecked(140, 'Vault.claim')]
		});
		const review = getReviewDetail(id);
		expect(review?.findings).toHaveLength(2);
		expect(review?.findings.map((f) => f.locations.length)).toEqual([1, 1]);
		expect(review?.counts.high).toBe(2);
		expect(review?.diff.newCount).toBe(2);
		expect(getRepoDetail(repoId)?.counts.total).toBe(2);
	});

	it('stores the same case without locationKey as 1 issue with 2 locations', () => {
		const { id } = insertReview(repoId, {
			commit: 'c001',
			findings: [unchecked(140), unchecked(88)]
		});
		expect(rowsOf(id)).toHaveLength(2);
		const review = getReviewDetail(id);
		expect(review?.findings).toHaveLength(1);
		expect(review?.findings[0].locations.map((l) => l.line)).toEqual([88, 140]);
		expect(review?.counts.total).toBe(1);
		expect(review?.diff).toEqual({ newCount: 1, carriedCount: 0, resolvedCount: 0 });
		// Headline (commit union) and the history row both count the issue once.
		const repo = getRepoDetail(repoId);
		expect(repo?.counts.total).toBe(1);
		expect(repo?.reviews[0].counts.total).toBe(1);
	});

	it('keeps every location of a legacy finding (E1) under its unchanged file + title key', () => {
		const legacy = { severity: 'high' as const, file: 'contracts/Vault.sol', title: 'Reentrancy' };
		const { id } = insertReview(repoId, {
			commit: 'c001',
			findings: [
				{ ...legacy, line: 15 },
				{ ...legacy, line: 85, severity: 'crit' }
			]
		});
		const rows = rowsOf(id);
		expect(rows.map((r) => r.fingerprint)).toEqual([
			fingerprint('contracts/Vault.sol', 'Reentrancy'),
			fingerprint('contracts/Vault.sol', 'Reentrancy')
		]);
		// The identity is new on exactly one row, so new_count (and trends) count it once.
		expect(rows.map((r) => r.is_new)).toEqual([1, 0]);

		const issue = getReviewDetail(id)?.findings[0];
		expect(issue?.severity).toBe('crit');
		expect(issue?.line).toBe(85);
		expect(issue?.isNew).toBe(true);
		expect(issue?.locations.map((l) => l.line)).toEqual([15, 85]);
	});

	it('collapses exact duplicates (same identity and line) to one stored row', () => {
		const { id } = insertReview(repoId, {
			commit: 'c001',
			findings: [unchecked(88, 'Vault.withdraw'), { ...unchecked(88, 'Vault.withdraw'), severity: 'crit' }]
		});
		const rows = rowsOf(id);
		expect(rows).toHaveLength(1);
		expect(getReviewDetail(id)?.findings[0].severity).toBe('crit');
	});

	it('carries an agent-identified issue across a rephrased title and moved lines', () => {
		const t0 = 1700000000000;
		insertReview(repoId, {
			commit: 'c001',
			createdAt: t0,
			findings: [unchecked(88, 'Vault.withdraw')]
		});
		const { id } = insertReview(repoId, {
			commit: 'c002',
			createdAt: t0 + 1000,
			findings: [{ ...unchecked(97, 'Vault.withdraw'), title: 'Return value of call() ignored' }]
		});
		const review = getReviewDetail(id);
		expect(review?.prevCommit).toBe('c001');
		expect(review?.diff).toEqual({ newCount: 0, carriedCount: 1, resolvedCount: 0 });
		expect(rowsOf(id)[0]).toMatchObject({ is_new: 0, first_seen_at: t0 });
	});

	it('records a resolved issue with its identity, so triage keeps quieting it', () => {
		const t0 = 1700000000000;
		const x = issueIdentity(unchecked(88, 'Vault.withdraw'));
		insertReview(repoId, {
			commit: 'c001',
			createdAt: t0,
			findings: [unchecked(88, 'Vault.withdraw'), unchecked(140, 'Vault.claim')]
		});
		const { id } = insertReview(repoId, {
			commit: 'c002',
			createdAt: t0 + 1000,
			findings: [unchecked(140, 'Vault.claim')]
		});
		expect(getReviewDetail(id)?.resolved).toEqual([
			{
				severity: 'high',
				title: 'Unchecked external call',
				file: 'contracts/Vault.sol',
				fingerprint: x
			}
		]);

		// A dismissed issue that stops being reported is not a fix.
		setTriage(repoId, x, 'false_positive', 'guarded upstream');
		expect(getReviewDetail(id)?.resolved).toEqual([]);
	});

	it('applies a triage tag to every location of the issue', () => {
		const { id } = insertReview(repoId, {
			commit: 'c001',
			findings: [unchecked(88), unchecked(140)]
		});
		const x = issueIdentity(unchecked(88));
		expect(setTriage(repoId, x, 'accepted_risk', 'bounded')).toBe(true);

		const review = getReviewDetail(id);
		expect(review?.findings[0].triage?.status).toBe('accepted_risk');
		expect(review?.counts.total).toBe(0);
		expect(review?.quietedCount).toBe(1);
		expect(getRepoDetail(repoId)?.status).toBe('clean');
	});

	it('keeps applying triage tags set on legacy keys', () => {
		const t0 = 1700000000000;
		const legacy = { severity: 'crit' as const, file: 'contracts/Vault.sol', title: 'Reentrancy' };
		insertReview(repoId, { commit: 'c001', createdAt: t0, findings: [{ ...legacy, line: 15 }] });
		// Tag set before the identity rework: keyed on the legacy file + title fingerprint.
		setTriage(repoId, fingerprint('contracts/Vault.sol', 'Reentrancy'), 'false_positive', 'guarded');

		const { id } = insertReview(repoId, {
			commit: 'c002',
			createdAt: t0 + 1000,
			findings: [
				{ ...legacy, line: 15 },
				{ ...legacy, line: 85 }
			]
		});
		const review = getReviewDetail(id);
		expect(review?.findings).toHaveLength(1);
		expect(review?.findings[0].triage?.status).toBe('false_positive');
		expect(review?.counts.total).toBe(0);
		expect(getRepoDetail(repoId)?.status).toBe('clean');
	});

	it('stores the same content hash as the pre-identity release for a legacy payload', () => {
		const { id } = insertReview(repoId, {
			commit: 'a3f9c21',
			model: 'claude-opus-4-8',
			engine: 'slither+semgrep+llm',
			findings: [
				{ severity: 'high', file: 'contracts/Vault.sol', title: 'Reentrancy', line: 88 },
				{ severity: 'crit', file: 'contracts/Vault.sol', title: 'Reentrancy', line: 140 },
				{ severity: 'low', title: 'No file finding' },
				{ severity: 'med', file: 'contracts/Token.sol', title: 'Overflow' }
			]
		});
		const row = db.prepare('SELECT content_hash FROM reviews WHERE id = ?').get(id);
		expect(row?.content_hash).toBe('33e32a82c6eb97338338f4215427fd2a561bd38b069449581b42bc68075ddfb4');
	});
});
