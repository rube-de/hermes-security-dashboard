import { describe, it, expect, beforeEach } from 'vitest';
import { addRepo, getRepoDetail, listRepoSummaries } from '$lib/server/repos';
import { insertReview } from '$lib/server/ingest';
import { setTriage } from '$lib/server/triage';
import { getOverview } from '$lib/server/overview';
import { fingerprint } from '$lib/server/fingerprint';
import { compareRepos, type RepoSortColumn, type RepoSortDirection } from '$lib/repo-sort';
import type { RepoSummary, Severity } from '$lib/types';
import { resetDb } from '../test-utils';

describe('RepoSummary.oldestOpenAt and overview repository risk ordering', () => {
	beforeEach(() => {
		resetDb();
	});

	it('persists oldest head union time from previous commit firstSeen', () => {
		const repoId = 'repo-carry';
		addRepo({ id: repoId, lang: 'Solidity' });

		const t0 = 1700000000000;
		const t1 = 1700050000000;

		insertReview(repoId, {
			commit: 'c001',
			createdAt: t0,
			findings: [{ severity: 'high', file: 'contracts/Vault.sol', title: 'Reentrancy' }]
		});

		insertReview(repoId, {
			commit: 'c002',
			createdAt: t1,
			findings: [
				{ severity: 'high', file: 'contracts/Vault.sol', title: 'Reentrancy' },
				{ severity: 'low', file: 'contracts/Vault.sol', title: 'Typo' }
			]
		});

		const summary = getRepoDetail(repoId);
		expect(summary?.headCommit).toBe('c002');
		expect(summary?.oldestOpenAt).toBe(t0);
	});

	it('counts unresolved sibling model union even when latest model omits it', () => {
		const repoId = 'repo-models';
		addRepo({ id: repoId, lang: 'Rust' });

		const t0 = 1700000000000;
		const t1 = 1700010000000;

		insertReview(repoId, {
			commit: 'c001',
			model: 'model-a',
			createdAt: t0,
			findings: [{ severity: 'crit', file: 'src/lib.rs', title: 'Memory Corruption' }]
		});

		insertReview(repoId, {
			commit: 'c001',
			model: 'model-b',
			createdAt: t1,
			findings: [{ severity: 'med', file: 'src/config.rs', title: 'Insecure Perms' }]
		});

		const summary = getRepoDetail(repoId);
		expect(summary?.counts.crit).toBe(1);
		expect(summary?.counts.med).toBe(1);
		expect(summary?.oldestOpenAt).toBe(t0);
	});

	it('excludes quieted false_positive and accepted_risk but includes acknowledged', () => {
		const repoId = 'repo-triage';
		addRepo({ id: repoId, lang: 'TypeScript' });

		const t0 = 1700000000000;
		const t1 = 1700010000000;
		const t2 = 1700020000000;

		const fp1 = fingerprint('src/auth.ts', 'JWT Bypass');
		const fp2 = fingerprint('src/db.ts', 'SQL Injection');
		const fp3 = fingerprint('src/api.ts', 'RCE');

		insertReview(repoId, {
			commit: 'c001',
			model: 'm1',
			createdAt: t0,
			findings: [{ severity: 'crit', file: 'src/auth.ts', title: 'JWT Bypass' }]
		});
		insertReview(repoId, {
			commit: 'c001',
			model: 'm2',
			createdAt: t1,
			findings: [{ severity: 'high', file: 'src/db.ts', title: 'SQL Injection' }]
		});
		insertReview(repoId, {
			commit: 'c001',
			model: 'm3',
			createdAt: t2,
			findings: [{ severity: 'crit', file: 'src/api.ts', title: 'RCE' }]
		});

		expect(getRepoDetail(repoId)?.oldestOpenAt).toBe(t0);

		setTriage(repoId, fp1, 'false_positive', 'FP confirmed');
		expect(getRepoDetail(repoId)?.oldestOpenAt).toBe(t1);

		setTriage(repoId, fp2, 'acknowledged', 'Acknowledged team looking');
		expect(getRepoDetail(repoId)?.oldestOpenAt).toBe(t1);

		setTriage(repoId, fp2, 'accepted_risk', 'Risk accepted');
		expect(getRepoDetail(repoId)?.oldestOpenAt).toBe(t2);

		setTriage(repoId, fp3, 'false_positive', 'Clean now');
		expect(getRepoDetail(repoId)?.oldestOpenAt).toBeNull();
	});

	it('returns null when repo has only medium/low findings or no reviews', () => {
		addRepo({ id: 'repo-empty', lang: 'Go' });
		expect(getRepoDetail('repo-empty')?.oldestOpenAt).toBeNull();

		addRepo({ id: 'repo-med-low', lang: 'Go' });
		insertReview('repo-med-low', {
			commit: 'c100',
			createdAt: 1700000000000,
			findings: [
				{ severity: 'med', file: 'main.go', title: 'Weak hash' },
				{ severity: 'low', file: 'main.go', title: 'Unused var' }
			]
		});

		const summary = getRepoDetail('repo-med-low');
		expect(summary?.counts.med).toBe(1);
		expect(summary?.counts.low).toBe(1);
		expect(summary?.oldestOpenAt).toBeNull();
	});

	it('re-scanning an older commit never hijacks the oldest head status', () => {
		const repoId = 'repo-stale-scan';
		addRepo({ id: repoId, lang: 'Solidity' });

		const t0 = 1700000000000;
		const t1 = 1700050000000;
		const t2 = 1700090000000;

		insertReview(repoId, {
			commit: 'c001',
			createdAt: t0,
			findings: [{ severity: 'high', file: 'Vault.sol', title: 'Old Issue' }]
		});

		insertReview(repoId, {
			commit: 'c002',
			createdAt: t1,
			findings: [{ severity: 'high', file: 'NewVault.sol', title: 'New Issue' }]
		});

		expect(getRepoDetail(repoId)?.headCommit).toBe('c002');
		expect(getRepoDetail(repoId)?.oldestOpenAt).toBe(t1);

		insertReview(repoId, {
			commit: 'c001',
			model: 'model-secondary',
			createdAt: t2,
			findings: [
				{ severity: 'crit', file: 'Vault.sol', title: 'Ancient Bug' },
				{ severity: 'high', file: 'Vault.sol', title: 'Old Issue' }
			]
		});

		const summary = getRepoDetail(repoId);
		expect(summary?.headCommit).toBe('c002');
		expect(summary?.oldestOpenAt).toBe(t1);
	});

	it('resolves severity conflict and backdated scan to earliest firstSeen', () => {
		const repoId = 'repo-backdated';
		addRepo({ id: repoId, lang: 'Python' });

		const t0 = 1700010000000;
		const t1 = 1700050000000;

		insertReview(repoId, {
			commit: 'c001',
			model: 'model-fast',
			createdAt: t1,
			findings: [
				{ severity: 'high', file: 'app.py', title: 'Command Injection' },
				{ severity: 'crit', file: 'db.py', title: 'SQL Injection' }
			]
		});

		insertReview(repoId, {
			commit: 'c001',
			model: 'model-deep',
			createdAt: t0,
			findings: [
				{ severity: 'crit', file: 'app.py', title: 'Command Injection' },
				{ severity: 'high', file: 'db.py', title: 'SQL Injection' }
			]
		});

		const summary = getRepoDetail(repoId);
		expect(summary?.counts.crit).toBe(2);
		expect(summary?.counts.high).toBe(0);
		expect(summary?.oldestOpenAt).toBe(t0);
	});

	it('ranks repos in listRepoSummaries and getOverview by risk', () => {
		const repos: { id: string; findings: { severity: Severity; file: string; title: string }[]; createdAt: number }[] = [
			{ id: 'repo-clean', findings: [], createdAt: 0 },
			{ id: 'repo-med-only', findings: [{ severity: 'med', file: 'a.rs', title: 'M' }], createdAt: 1700010000000 },
			{ id: 'repo-high-newer', findings: [{ severity: 'high', file: 'a.rs', title: 'H' }], createdAt: 1700030000000 },
			{ id: 'repo-high-older', findings: [{ severity: 'high', file: 'a.rs', title: 'H' }], createdAt: 1700010000000 },
			{
				id: 'repo-high-two',
				findings: [
					{ severity: 'high', file: 'a.rs', title: 'H1' },
					{ severity: 'high', file: 'b.rs', title: 'H2' }
				],
				createdAt: 1700040000000
			},
			{ id: 'repo-crit', findings: [{ severity: 'crit', file: 'a.rs', title: 'C' }], createdAt: 1700050000000 }
		];

		for (const r of repos) {
			addRepo({ id: r.id, lang: 'Rust' });
			if (r.findings.length > 0) {
				insertReview(r.id, { commit: 'c1', createdAt: r.createdAt, findings: r.findings });
			}
		}

		const expected = [
			'repo-crit',
			'repo-high-two',
			'repo-high-older',
			'repo-high-newer',
			'repo-med-only',
			'repo-clean'
		];
		expect(listRepoSummaries().map((r) => r.id)).toEqual(expected);
		expect(getOverview().repos.map((r) => r.id)).toEqual(expected);
	});

	it('compares repos across all columns and directions', () => {
		function makeSummary(partial: Partial<RepoSummary> & { id: string }): RepoSummary {
			return {
				id: partial.id,
				lang: 'TypeScript',
				description: '',
				path: '',
				branch: 'main',
				lines: 100,
				counts: partial.counts ?? { crit: 0, high: 0, med: 0, low: 0, total: 0 },
				quietedCount: partial.quietedCount ?? 0,
				status: partial.status ?? ((partial.counts?.total ?? 0) > 0 ? 'flagged' : 'clean'),
				clean: partial.clean ?? (partial.counts?.total ?? 0) === 0,
				scanning: false,
				lastRunAt: 1700000000000,
				lastDurationSecs: 5,
				filesScanned: 10,
				headCommit: 'c001',
				headScanCount: 1,
				oldestOpenAt: partial.oldestOpenAt ?? null
			};
		}

		const rAlpha = makeSummary({
			id: 'alpha',
			counts: { crit: 1, high: 0, med: 0, low: 0, total: 1 },
			oldestOpenAt: 1700020000000
		});
		const rBeta = makeSummary({
			id: 'beta',
			counts: { crit: 0, high: 2, med: 0, low: 0, total: 2 },
			oldestOpenAt: 1700010000000
		});
		const rGamma = makeSummary({
			id: 'gamma',
			counts: { crit: 0, high: 1, med: 5, low: 0, total: 6 },
			oldestOpenAt: 1700015000000
		});
		const rDelta = makeSummary({
			id: 'delta',
			counts: { crit: 0, high: 0, med: 3, low: 0, total: 3 },
			oldestOpenAt: null
		});
		const rEpsilon = makeSummary({
			id: 'epsilon',
			counts: { crit: 0, high: 0, med: 0, low: 0, total: 0 },
			oldestOpenAt: null
		});

		const repos = [rDelta, rAlpha, rEpsilon, rGamma, rBeta];
		function sortIds(col: RepoSortColumn, dir: RepoSortDirection): string[] {
			const sorted = [...repos].sort((a, b) => compareRepos(a, b, col, dir));
			return sorted.map((r) => r.id);
		}

		expect(sortIds('risk', 'descending')).toEqual(['alpha', 'beta', 'gamma', 'delta', 'epsilon']);
		expect(sortIds('risk', 'ascending')).toEqual(['epsilon', 'delta', 'gamma', 'beta', 'alpha']);

		expect(sortIds('repository', 'ascending')).toEqual(['alpha', 'beta', 'delta', 'epsilon', 'gamma']);
		expect(sortIds('repository', 'descending')).toEqual(['gamma', 'epsilon', 'delta', 'beta', 'alpha']);

		expect(sortIds('findings', 'descending')).toEqual(['gamma', 'delta', 'beta', 'alpha', 'epsilon']);
		expect(sortIds('findings', 'ascending')).toEqual(['epsilon', 'alpha', 'beta', 'delta', 'gamma']);

		expect(sortIds('oldest', 'descending')).toEqual(['beta', 'gamma', 'alpha', 'delta', 'epsilon']);
		expect(sortIds('oldest', 'ascending')).toEqual(['alpha', 'gamma', 'beta', 'delta', 'epsilon']);
	});
});
