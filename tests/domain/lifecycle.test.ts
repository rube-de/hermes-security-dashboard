import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '$lib/server/db';
import { addRepo } from '$lib/server/repos';
import { insertReview, type ReviewInput } from '$lib/server/ingest';
import { getReviewDetail } from '$lib/server/reviews';
import { resetDb } from '../test-utils';

describe('insertReview lifecycle', () => {
	const repoId = 'repo-test';

	beforeEach(() => {
		resetDb();
		addRepo({ id: repoId, lang: 'TypeScript' });
	});

	it('handles first scan of a repository correctly', () => {
		const t0 = 1700000000000;
		const { id, duplicate } = insertReview(repoId, {
			commit: 'c001',
			model: 'gpt-4o',
			createdAt: t0,
			findings: [
				{ severity: 'high', file: 'src/a.ts', title: 'Injection' },
				{ severity: 'med', file: 'src/b.ts', title: 'XSS' }
			]
		});

		expect(duplicate).toBe(false);
		expect(id).toBeDefined();

		const detail = getReviewDetail(id, t0);
		expect(detail).not.toBeNull();
		expect(detail?.diff.newCount).toBe(2);
		expect(detail?.diff.resolvedCount).toBe(0);
		expect(detail?.hasPrev).toBe(false);
		expect(detail?.prevCommit).toBeNull();

		const rows = db
			.prepare('SELECT severity, is_new, first_seen_at FROM findings WHERE review_id = ?')
			.all(id) as { severity: string; is_new: number; first_seen_at: number }[];
		expect(rows).toHaveLength(2);
		for (const r of rows) {
			expect(r.is_new).toBe(1);
			expect(r.first_seen_at).toBe(t0);
		}
	});

	it('returns duplicate: true on idempotent resubmit of identical scan', () => {
		const t0 = 1700000000000;
		const payload: ReviewInput = {
			commit: 'c001',
			model: 'gpt-4o',
			engine: 'slither+semgrep+llm',
			createdAt: t0,
			findings: [{ severity: 'high', file: 'src/a.ts', title: 'Injection' }]
		};

		const res1 = insertReview(repoId, payload);
		expect(res1.duplicate).toBe(false);

		const res2 = insertReview(repoId, {
			...payload,
			durationSecs: 999, // volatile fields do not change content hash
			summary: 'Different summary'
		});
		expect(res2.duplicate).toBe(true);
		expect(res2.id).toBe(res1.id);

		// Reviews table only contains one review row
		const count = db
			.prepare('SELECT COUNT(*) as n FROM reviews WHERE repo_id = ?')
			.get(repoId) as { n: number };
		expect(count.n).toBe(1);
	});

	it('handles re-scan of the same commit with newly surfaced finding', () => {
		const t0 = 1700000000000;
		const res1 = insertReview(repoId, {
			commit: 'c001',
			model: 'gpt-4o',
			createdAt: t0,
			findings: [{ severity: 'high', file: 'src/a.ts', title: 'Injection' }]
		});
		expect(res1.duplicate).toBe(false);

		const t1 = t0 + 1000;
		const res2 = insertReview(repoId, {
			commit: 'c001',
			model: 'gpt-4o',
			createdAt: t1,
			findings: [
				{ severity: 'high', file: 'src/a.ts', title: 'Injection' },
				{ severity: 'low', file: 'src/c.ts', title: 'New finding on rescan' }
			]
		});
		expect(res2.duplicate).toBe(false);

		const detail2 = getReviewDetail(res2.id, t1);
		// In a re-scan of the same commit, resolved is not computed (prevCommit is null)
		expect(detail2?.prevCommit).toBeNull();
		expect(detail2?.diff.resolvedCount).toBe(0);
		// Only the newly discovered finding is counted as new
		expect(detail2?.diff.newCount).toBe(1);
		expect(detail2?.diff.carriedCount).toBe(1);

		const findings2 = db
			.prepare('SELECT title, is_new FROM findings WHERE review_id = ? ORDER BY id')
			.all(res2.id) as { title: string; is_new: number }[];
		expect(findings2).toEqual([
			{ title: 'Injection', is_new: 0 },
			{ title: 'New finding on rescan', is_new: 1 }
		]);
	});

	it('handles multi-model scans on the same commit', () => {
		const t0 = 1700000000000;
		const resM1 = insertReview(repoId, {
			commit: 'c001',
			model: 'gpt-4o',
			createdAt: t0,
			findings: [{ severity: 'med', file: 'src/shared.ts', title: 'Bug' }]
		});

		const resM2 = insertReview(repoId, {
			commit: 'c001',
			model: 'claude-3-5-sonnet',
			createdAt: t0 + 500,
			findings: [
				{ severity: 'crit', file: 'src/shared.ts', title: 'Bug' },
				{ severity: 'low', file: 'src/unique.ts', title: 'Claude only' }
			]
		});

		expect(resM1.id).not.toBe(resM2.id);

		// Both reviews exist
		const reviews = db
			.prepare('SELECT id, model, new_count FROM reviews WHERE repo_id = ?')
			.all(repoId) as { id: string; model: string; new_count: number }[];
		expect(reviews).toHaveLength(2);

		// Second model flagged an existing fingerprint (so is_new=0 for Bug) and one new finding
		const d2 = getReviewDetail(resM2.id);
		expect(d2?.diff.newCount).toBe(1);
	});

	it('computes resolved findings on first scan of a subsequent commit', () => {
		const t0 = 1700000000000;
		insertReview(repoId, {
			commit: 'c001',
			createdAt: t0,
			findings: [
				{ severity: 'high', file: 'src/fixme.ts', title: 'Bug 1' },
				{ severity: 'low', file: 'src/keep.ts', title: 'Bug 2' }
			]
		});

		const t1 = t0 + 10000;
		const { id: id2 } = insertReview(repoId, {
			commit: 'c002',
			createdAt: t1,
			findings: [{ severity: 'low', file: 'src/keep.ts', title: 'Bug 2' }]
		});

		const d2 = getReviewDetail(id2, t1);
		expect(d2?.prevCommit).toBe('c001');
		expect(d2?.diff.newCount).toBe(0);
		expect(d2?.diff.resolvedCount).toBe(1);
		expect(d2?.resolved).toHaveLength(1);
		expect(d2?.resolved[0].title).toBe('Bug 1');
	});

	it('preserves first_seen_at and sets is_new = 0 when a resolved finding returns (regression)', () => {
		const t0 = 1700000000000;
		insertReview(repoId, {
			commit: 'c001',
			createdAt: t0,
			findings: [{ severity: 'high', file: 'src/regress.ts', title: 'Old Bug' }]
		});

		const t1 = t0 + 10000;
		insertReview(repoId, {
			commit: 'c002',
			createdAt: t1,
			findings: []
		});

		const t2 = t1 + 10000;
		const { id: id3 } = insertReview(repoId, {
			commit: 'c003',
			createdAt: t2,
			findings: [{ severity: 'high', file: 'src/regress.ts', title: 'Old Bug' }]
		});

		const d3 = getReviewDetail(id3, t2);
		expect(d3?.prevCommit).toBe('c002');
		// Because Old Bug was seen in c001, it is NOT considered new in the repo
		expect(d3?.diff.newCount).toBe(0);

		const row = db
			.prepare('SELECT is_new, first_seen_at FROM findings WHERE review_id = ?')
			.get(id3) as { is_new: number; first_seen_at: number };
		expect(row.is_new).toBe(0);
		expect(row.first_seen_at).toBe(t0);
	});
});
