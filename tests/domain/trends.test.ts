import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { addRepo } from '$lib/server/repos';
import { insertReview, type FindingInput } from '$lib/server/ingest';
import { getTrends } from '$lib/server/trends';
import { getOverview } from '$lib/server/overview';
import { resetDb } from '../test-utils';

// A non-UTC host timezone exposes UTC-midnight and DST regressions.
const originalTZ = process.env.TZ;
process.env.TZ = 'America/New_York';

afterAll(() => {
	if (originalTZ !== undefined) {
		process.env.TZ = originalTZ;
	} else {
		delete process.env.TZ;
	}
});

describe('getTrends', () => {
	const repoId = 'trends-repo';
	let commitSeq = 0;

	function insertScan(createdAt: number, findings: FindingInput[] = [], targetRepo = repoId): void {
		commitSeq += 1;
		insertReview(targetRepo, {
			commit: `c${commitSeq.toString().padStart(3, '0')}`,
			createdAt,
			findings: findings.map((f) => ({ file: 'a.rs', ...f }))
		});
	}

	beforeEach(() => {
		resetDb();
		addRepo({ id: repoId, lang: 'Rust' });
		commitSeq = 0;
	});

	it('returns continuous zero-filled buckets for the requested number of days', () => {
		const now = Date.UTC(2024, 5, 15, 12);
		const buckets = getTrends(7, {}, now);
		expect(buckets).toHaveLength(7);

		const expectedDays = ['6/9', '6/10', '6/11', '6/12', '6/13', '6/14', '6/15'];
		for (let i = 0; i < buckets.length; i++) {
			expect(buckets[i]).toEqual({
				day: expectedDays[i],
				date: Date.UTC(2024, 5, 9 + i),
				newFindings: 0,
				resolvedFindings: 0,
				reviews: 0
			});
			if (i > 0) {
				expect(buckets[i].date - buckets[i - 1].date).toBe(86400000);
			}
		}
	});

	it('aggregates new findings, resolved findings, and review counts correctly', () => {
		const day1 = Date.UTC(2024, 5, 14, 10);
		const day2 = Date.UTC(2024, 5, 15, 10);

		insertScan(day1, [
			{ severity: 'high', file: 'a.rs', title: 'Bug 1' },
			{ severity: 'med', file: 'b.rs', title: 'Bug 2' }
		]);
		insertScan(day2, [{ severity: 'med', file: 'b.rs', title: 'Bug 2' }]);

		const buckets = getTrends(2, { repoId }, day2);
		expect(buckets).toEqual([
			{ day: '6/14', date: Date.UTC(2024, 5, 14), newFindings: 2, resolvedFindings: 0, reviews: 1 },
			{ day: '6/15', date: Date.UTC(2024, 5, 15), newFindings: 0, resolvedFindings: 1, reviews: 1 }
		]);
	});

	it('scopes to repoId when provided', () => {
		addRepo({ id: 'other-repo', lang: 'Go' });
		const now = Date.UTC(2024, 5, 15, 12);

		insertScan(now, [{ severity: 'high', file: 'a.rs', title: 'Bug 1' }]);
		insertScan(now, [{ severity: 'high', file: 'a.go', title: 'Other Bug' }], 'other-repo');

		expect(getTrends(1, { repoId }, now)[0].newFindings).toBe(1);
		expect(getTrends(1, {}, now)[0].newFindings).toBe(2);
	});

	it('buckets by UTC days across a DST transition with carried findings and real fixes', () => {
		const march9_20Z = Date.UTC(2024, 2, 9, 20);
		const march10_0430Z = Date.UTC(2024, 2, 10, 4, 30);
		const march10_18Z = Date.UTC(2024, 2, 10, 18);
		const march11_12Z = Date.UTC(2024, 2, 11, 12);

		insertScan(march9_20Z, [
			{ severity: 'high', file: 'a.rs', title: 'Bug 1' },
			{ severity: 'med', file: 'b.rs', title: 'Bug 2' }
		]);
		// 04:30Z is local March 9 23:30 in America/New_York, but buckets into UTC 3/10
		insertScan(march10_0430Z, [
			{ severity: 'high', file: 'a.rs', title: 'Bug 1' },
			{ severity: 'low', file: 'c.rs', title: 'Bug 3' }
		]);
		insertScan(march10_18Z, [
			{ severity: 'low', file: 'c.rs', title: 'Bug 3' },
			{ severity: 'crit', file: 'd.rs', title: 'Bug 4' }
		]);
		insertScan(march11_12Z, []);

		const buckets = getTrends(3, { repoId }, march11_12Z);
		expect(buckets).toEqual([
			{ day: '3/9', date: Date.UTC(2024, 2, 9), newFindings: 2, resolvedFindings: 0, reviews: 1 },
			{ day: '3/10', date: Date.UTC(2024, 2, 10), newFindings: 2, resolvedFindings: 2, reviews: 2 },
			{ day: '3/11', date: Date.UTC(2024, 2, 11), newFindings: 0, resolvedFindings: 2, reviews: 1 }
		]);
		expect(buckets[1].date - buckets[0].date).toBe(86400000);
		expect(buckets[2].date - buckets[1].date).toBe(86400000);
	});

	it('respects UTC window boundaries including first midnight, before first midnight, next midnight, and end of current day', () => {
		const now = Date.UTC(2024, 5, 15, 12);
		const firstMidnight = Date.UTC(2024, 5, 14);

		insertScan(firstMidnight - 1, [{ severity: 'low', title: 'Before window' }]);
		insertScan(firstMidnight, [{ severity: 'high', title: 'At first midnight' }]);
		insertScan(Date.UTC(2024, 5, 15, 23, 59, 59, 999), [{ severity: 'med', title: 'At end of day' }]);
		insertScan(Date.UTC(2024, 5, 16), [{ severity: 'crit', title: 'At next midnight' }]);

		const buckets = getTrends(2, { repoId }, now);
		expect(buckets).toEqual([
			{ day: '6/14', date: firstMidnight, newFindings: 1, resolvedFindings: 1, reviews: 1 },
			{ day: '6/15', date: Date.UTC(2024, 5, 15), newFindings: 1, resolvedFindings: 1, reviews: 1 }
		]);
	});

	it('keeps new and fixed daily counts in the overview trend', () => {
		const now = Date.UTC(2024, 5, 15, 12);
		insertScan(Date.UTC(2024, 5, 14, 10), [
			{ severity: 'high', file: 'a.rs', title: 'Bug 1' },
			{ severity: 'med', file: 'b.rs', title: 'Bug 2' }
		]);
		insertScan(Date.UTC(2024, 5, 15, 10), [
			{ severity: 'med', file: 'b.rs', title: 'Bug 2' },
			{ severity: 'low', file: 'c.rs', title: 'Bug 3' }
		]);

		expect(getOverview(now).trend.slice(-2)).toEqual([
			{ day: '6/14', date: Date.UTC(2024, 5, 14), newFindings: 2, resolvedFindings: 0, reviews: 1 },
			{ day: '6/15', date: Date.UTC(2024, 5, 15), newFindings: 1, resolvedFindings: 1, reviews: 1 }
		]);
	});
});
