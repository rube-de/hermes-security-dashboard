import { describe, it, expect, beforeEach } from 'vitest';
import { addRepo, getRepoDetail } from '$lib/server/repos';
import { insertReview } from '$lib/server/ingest';
import { setTriage, clearTriage } from '$lib/server/triage';
import { getReviewDetail } from '$lib/server/reviews';
import { getOverview } from '$lib/server/overview';
import { fingerprint } from '$lib/server/fingerprint';
import { resetDb } from '../test-utils';

describe('commit union + triage quieting', () => {
	const repoId = 'triage-repo';

	beforeEach(() => {
		resetDb();
		addRepo({ id: repoId, lang: 'Solidity' });
	});

	it('unions findings for a commit and picks highest severity on conflict', () => {
		const t0 = 1700000000000;
		insertReview(repoId, {
			commit: 'c001',
			model: 'model-a',
			createdAt: t0,
			findings: [
				{ severity: 'med', file: 'contracts/Vault.sol', title: 'Reentrancy' },
				{ severity: 'low', file: 'contracts/Vault.sol', title: 'Doc typo' }
			]
		});

		insertReview(repoId, {
			commit: 'c001',
			model: 'model-b',
			createdAt: t0 + 1000,
			findings: [
				{ severity: 'crit', file: 'contracts/Vault.sol', title: 'Reentrancy' },
				{ severity: 'high', file: 'contracts/Token.sol', title: 'Overflow' }
			]
		});

		const repo = getRepoDetail(repoId);
		expect(repo).not.toBeNull();
		// Reentrancy should be upgraded to 'crit'
		expect(repo?.counts.crit).toBe(1);
		expect(repo?.counts.high).toBe(1);
		expect(repo?.counts.med).toBe(0);
		expect(repo?.counts.low).toBe(1);
		expect(repo?.counts.total).toBe(3);
		expect(repo?.status).toBe('flagged');
	});

	it('acknowledged status does NOT quiet a finding', () => {
		const fp = fingerprint('contracts/Vault.sol', 'Reentrancy');
		insertReview(repoId, {
			commit: 'c001',
			findings: [{ severity: 'crit', file: 'contracts/Vault.sol', title: 'Reentrancy' }]
		});

		const ok = setTriage(repoId, fp, 'acknowledged', 'Investigating');
		expect(ok).toBe(true);

		const repo = getRepoDetail(repoId);
		expect(repo?.counts.crit).toBe(1);
		expect(repo?.counts.total).toBe(1);
		expect(repo?.quietedCount).toBe(0);
		expect(repo?.status).toBe('flagged');
	});

	it('false_positive and accepted_risk quiet findings and can turn repo clean', () => {
		const fp1 = fingerprint('contracts/Vault.sol', 'Reentrancy');
		const fp2 = fingerprint('contracts/Token.sol', 'Overflow');
		insertReview(repoId, {
			commit: 'c001',
			findings: [
				{ severity: 'crit', file: 'contracts/Vault.sol', title: 'Reentrancy' },
				{ severity: 'high', file: 'contracts/Token.sol', title: 'Overflow' }
			]
		});

		// Quiet the first finding
		setTriage(repoId, fp1, 'false_positive', 'Guarded by nonReentrant');
		let repo = getRepoDetail(repoId);
		expect(repo?.counts.crit).toBe(0);
		expect(repo?.counts.high).toBe(1);
		expect(repo?.quietedCount).toBe(1);
		expect(repo?.status).toBe('flagged');

		// Quiet the second finding
		setTriage(repoId, fp2, 'accepted_risk', 'Bounded in compiler');
		repo = getRepoDetail(repoId);
		expect(repo?.counts.high).toBe(0);
		expect(repo?.counts.total).toBe(0);
		expect(repo?.quietedCount).toBe(2);
		expect(repo?.status).toBe('clean');

		// Check overview
		const overview = getOverview();
		expect(overview.totals.total).toBe(0);
		expect(overview.quietedTotal).toBe(2);
		expect(overview.clean).toBe(1);
		expect(overview.flagged).toBe(0);
	});

	it('quieted findings do not count as resolved fixes when omitted later', () => {
		const fp = fingerprint('contracts/Vault.sol', 'Reentrancy');
		const { id: r1 } = insertReview(repoId, {
			commit: 'c001',
			createdAt: 1000,
			findings: [{ severity: 'crit', file: 'contracts/Vault.sol', title: 'Reentrancy' }]
		});

		setTriage(repoId, fp, 'false_positive', 'Not a bug');

		// In c002, the scanner stops reporting Reentrancy
		const { id: r2 } = insertReview(repoId, {
			commit: 'c002',
			createdAt: 2000,
			findings: []
		});

		const detail = getReviewDetail(r2);
		// Because Reentrancy was quieted, it must NOT appear as a resolved fix
		expect(detail?.resolved).toHaveLength(0);
	});

	it('clearing triage restores findings to active counts', () => {
		const fp = fingerprint('contracts/Vault.sol', 'Reentrancy');
		insertReview(repoId, {
			commit: 'c001',
			findings: [{ severity: 'crit', file: 'contracts/Vault.sol', title: 'Reentrancy' }]
		});

		setTriage(repoId, fp, 'accepted_risk', 'Test');
		expect(getRepoDetail(repoId)?.status).toBe('clean');

		const cleared = clearTriage(repoId, fp);
		expect(cleared).toBe(true);

		const repo = getRepoDetail(repoId);
		expect(repo?.counts.crit).toBe(1);
		expect(repo?.quietedCount).toBe(0);
		expect(repo?.status).toBe('flagged');
	});
});
