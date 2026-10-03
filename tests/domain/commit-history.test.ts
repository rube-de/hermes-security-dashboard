import { describe, it, expect, beforeEach } from 'vitest';
import { addRepo, getRepoDetail } from '$lib/server/repos';
import { insertReview, type FindingInput } from '$lib/server/ingest';
import { setTriage } from '$lib/server/triage';
import { fingerprint } from '$lib/server/fingerprint';
import { resetDb } from '../test-utils';

describe('commit history grouping and delta', () => {
	const repoId = 'history-test-repo';
	const T0 = 1_700_000_000_000;

	function addScan(
		commit: string,
		findings: FindingInput[],
		opts: { model?: string; createdAt?: number } = {}
	) {
		return insertReview(repoId, {
			commit,
			model: opts.model ?? 'model-a',
			createdAt: opts.createdAt ?? T0,
			findings
		});
	}

	beforeEach(() => {
		resetDb();
		addRepo({ id: repoId, lang: 'Solidity' });
	});

	it('returns deterministic empty commit history when repo has no scans', () => {
		const repo = getRepoDetail(repoId);
		expect(repo).not.toBeNull();
		expect(repo?.commits).toEqual([]);
	});

	it('handles single-scan group with scan review ID, correct counts, and earliest 0/0 delta', () => {
		const { id: r1 } = addScan('c001', [
			{ severity: 'high', file: 'contracts/Vault.sol', title: 'Reentrancy' },
			{ severity: 'low', file: 'contracts/Vault.sol', title: 'Doc typo' }
		]);

		const repo = getRepoDetail(repoId);
		expect(repo?.commits).toHaveLength(1);

		const group = repo!.commits[0];
		expect(group.commit).toBe('c001');
		expect(group.createdAt).toBe(T0);
		expect(group.counts).toEqual({ crit: 0, high: 1, med: 0, low: 1, total: 2 });
		expect(group.newCount).toBe(0);
		expect(group.fixedCount).toBe(0);

		expect(group.scans).toHaveLength(1);
		const scan = group.scans[0];
		expect(scan.reviewId).toBe(r1);
		expect(scan.model).toBe('model-a');
		expect(scan.createdAt).toBe(T0);
		expect(scan.counts).toEqual({ crit: 0, high: 1, med: 0, low: 1, total: 2 });
		expect(scan.uniqueCount).toBe(2);
	});

	it('groups two models on one commit: worst-severity union, multi-location deduplication, and model uniqueness', () => {
		addScan('c001', [
			{ severity: 'med', file: 'contracts/Vault.sol', line: 10, title: 'Reentrancy' },
			{ severity: 'med', file: 'contracts/Vault.sol', line: 20, title: 'Reentrancy' },
			{ severity: 'low', file: 'contracts/Vault.sol', line: 5, title: 'Doc typo' }
		]);

		addScan(
			'c001',
			[
				{ severity: 'crit', file: 'contracts/Vault.sol', line: 15, title: 'Reentrancy' },
				{ severity: 'high', file: 'contracts/Token.sol', line: 30, title: 'Overflow' }
			],
			{ model: 'model-b', createdAt: T0 + 1000 }
		);

		const repo = getRepoDetail(repoId);
		expect(repo?.commits).toHaveLength(1);

		const group = repo!.commits[0];
		expect(group.commit).toBe('c001');
		expect(group.createdAt).toBe(T0);
		expect(group.counts).toEqual({ crit: 1, high: 1, med: 0, low: 1, total: 3 });
		expect(group.newCount).toBe(0);
		expect(group.fixedCount).toBe(0);

		expect(group.scans).toHaveLength(2);
		expect(group.scans[0].model).toBe('model-b');
		expect(group.scans[0].counts).toEqual({ crit: 1, high: 1, med: 0, low: 0, total: 2 });
		expect(group.scans[0].uniqueCount).toBe(1);

		expect(group.scans[1].model).toBe('model-a');
		expect(group.scans[1].counts).toEqual({ crit: 0, high: 0, med: 1, low: 1, total: 2 });
		expect(group.scans[1].uniqueCount).toBe(1);
	});

	it('repeated scans of the same model remain unique-to-model and do not erase model uniqueness', () => {
		addScan('c001', [
			{ severity: 'high', file: 'contracts/Shared.sol', title: 'SharedIssue' },
			{ severity: 'med', file: 'contracts/A.sol', title: 'ModelAOnly' }
		]);

		addScan(
			'c001',
			[
				{ severity: 'high', file: 'contracts/Shared.sol', title: 'SharedIssue' },
				{ severity: 'low', file: 'contracts/B.sol', title: 'ModelBOnly' }
			],
			{ model: 'model-b', createdAt: T0 + 1000 }
		);

		addScan(
			'c001',
			[{ severity: 'med', file: 'contracts/A.sol', title: 'ModelAOnly' }],
			{ createdAt: T0 + 2000 }
		);

		const repo = getRepoDetail(repoId);
		const group = repo!.commits[0];
		expect(group.scans).toHaveLength(3);

		expect(group.scans[0].createdAt).toBe(T0 + 2000);
		expect(group.scans[0].model).toBe('model-a');
		expect(group.scans[0].uniqueCount).toBe(1);

		expect(group.scans[1].createdAt).toBe(T0 + 1000);
		expect(group.scans[1].model).toBe('model-b');
		expect(group.scans[1].uniqueCount).toBe(1);

		expect(group.scans[2].createdAt).toBe(T0);
		expect(group.scans[2].model).toBe('model-a');
		expect(group.scans[2].uniqueCount).toBe(1);
	});

	it('computes consecutive commit union deltas: finding discovered by a later model + removed finding', () => {
		addScan('c001', [
			{ severity: 'high', file: 'contracts/A.sol', title: 'FindingA' },
			{ severity: 'med', file: 'contracts/B.sol', title: 'FindingB' }
		]);

		addScan(
			'c002',
			[{ severity: 'high', file: 'contracts/A.sol', title: 'FindingA' }],
			{ createdAt: T0 + 10000 }
		);

		addScan(
			'c002',
			[{ severity: 'crit', file: 'contracts/C.sol', title: 'FindingC' }],
			{ model: 'model-b', createdAt: T0 + 20000 }
		);

		const repo = getRepoDetail(repoId);
		expect(repo?.commits).toHaveLength(2);

		const [c2Group, c1Group] = repo!.commits;
		expect(c1Group.commit).toBe('c001');
		expect(c1Group.newCount).toBe(0);
		expect(c1Group.fixedCount).toBe(0);

		expect(c2Group.commit).toBe('c002');
		expect(c2Group.newCount).toBe(1);
		expect(c2Group.fixedCount).toBe(1);
	});

	it('handles severity-only transition: counts update while new and fixed counts remain zero', () => {
		addScan('c001', [{ severity: 'med', file: 'contracts/A.sol', title: 'IssueA' }]);
		addScan(
			'c002',
			[{ severity: 'crit', file: 'contracts/A.sol', title: 'IssueA' }],
			{ createdAt: T0 + 10000 }
		);

		const repo = getRepoDetail(repoId);
		expect(repo?.commits).toHaveLength(2);

		const [c2, c1] = repo!.commits;
		expect(c1.counts.med).toBe(1);
		expect(c1.counts.crit).toBe(0);

		expect(c2.counts.crit).toBe(1);
		expect(c2.counts.med).toBe(0);
		expect(c2.newCount).toBe(0);
		expect(c2.fixedCount).toBe(0);
	});

	it('treats a resurrected finding as new even if previously seen in earlier commits', () => {
		const findingX: FindingInput = { severity: 'high', file: 'contracts/X.sol', title: 'BugX' };

		addScan('c001', [findingX]);
		addScan('c002', [], { createdAt: T0 + 10000 });
		addScan('c003', [findingX], { createdAt: T0 + 20000 });

		const repo = getRepoDetail(repoId);
		expect(repo?.commits).toHaveLength(3);

		const [c3, c2, c1] = repo!.commits;
		expect(c1.commit).toBe('c001');
		expect(c1.newCount).toBe(0);
		expect(c1.fixedCount).toBe(0);

		expect(c2.commit).toBe('c002');
		expect(c2.newCount).toBe(0);
		expect(c2.fixedCount).toBe(1);

		expect(c3.commit).toBe('c003');
		expect(c3.newCount).toBe(1);
		expect(c3.fixedCount).toBe(0);
	});

	it('orders groups newest introduced first and keeps order unchanged on late historic rescans while updating unions and deltas', () => {
		addScan('c001', [{ severity: 'high', file: 'contracts/A.sol', title: 'IssueA' }]);
		addScan('c002', [{ severity: 'high', file: 'contracts/A.sol', title: 'IssueA' }], {
			createdAt: T0 + 10000
		});
		addScan(
			'c001',
			[
				{ severity: 'high', file: 'contracts/A.sol', title: 'IssueA' },
				{ severity: 'med', file: 'contracts/B.sol', title: 'IssueB' }
			],
			{ model: 'model-b', createdAt: T0 + 50000 }
		);

		const repo = getRepoDetail(repoId);
		expect(repo?.commits).toHaveLength(2);

		const [c2, c1] = repo!.commits;
		expect(c2.commit).toBe('c002');
		expect(c1.commit).toBe('c001');

		expect(c1.counts.total).toBe(2);
		expect(c1.scans).toHaveLength(2);
		expect(c1.scans[0].model).toBe('model-b');
		expect(c1.scans[0].createdAt).toBe(T0 + 50000);
		expect(c1.scans[1].model).toBe('model-a');
		expect(c1.scans[1].createdAt).toBe(T0);

		expect(c2.newCount).toBe(0);
		expect(c2.fixedCount).toBe(1);
	});

	it('consistently quiets triage (false_positive, accepted_risk) across commit unions, scan counts, and deltas', () => {
		const fpReentrancy = fingerprint('contracts/Vault.sol', 'Reentrancy');
		const fpTypo = fingerprint('contracts/Vault.sol', 'Doc typo');

		addScan('c001', [
			{ severity: 'crit', file: 'contracts/Vault.sol', title: 'Reentrancy' },
			{ severity: 'low', file: 'contracts/Vault.sol', title: 'Doc typo' }
		]);

		addScan(
			'c002',
			[
				{ severity: 'low', file: 'contracts/Vault.sol', title: 'Doc typo' },
				{ severity: 'high', file: 'contracts/Leak.sol', title: 'NewLeak' }
			],
			{ createdAt: T0 + 10000 }
		);

		setTriage(repoId, fpReentrancy, 'false_positive', 'False alarm');
		setTriage(repoId, fpTypo, 'accepted_risk', 'Known non-issue');

		const repo = getRepoDetail(repoId);
		const [c2, c1] = repo!.commits;

		expect(c1.counts.total).toBe(0);
		expect(c1.counts.crit).toBe(0);
		expect(c1.counts.low).toBe(0);
		expect(c1.scans[0].counts.total).toBe(0);
		expect(c1.scans[0].uniqueCount).toBe(0);

		expect(c2.counts.total).toBe(1);
		expect(c2.counts.high).toBe(1);
		expect(c2.scans[0].counts.total).toBe(1);
		expect(c2.scans[0].counts.high).toBe(1);
		expect(c2.scans[0].uniqueCount).toBe(1);
		expect(c2.newCount).toBe(1);
		expect(c2.fixedCount).toBe(0);
	});

	it('breaks createdAt ties deterministically by first-inserted scan and resists historic rescans', () => {
		addScan('c001', [{ severity: 'low', file: 'contracts/A.sol', title: 'IssueA' }]);
		addScan('c002', [{ severity: 'high', file: 'contracts/B.sol', title: 'IssueB' }]);
		addScan(
			'c001',
			[{ severity: 'med', file: 'contracts/C.sol', title: 'IssueC' }],
			{ model: 'model-b', createdAt: T0 + 50000 }
		);

		const repo = getRepoDetail(repoId);
		expect(repo?.headCommit).toBe('c002');
		expect(repo?.commits).toHaveLength(2);
		expect(repo!.commits[0].commit).toBe('c002');
		expect(repo!.commits[1].commit).toBe('c001');
	});
});
