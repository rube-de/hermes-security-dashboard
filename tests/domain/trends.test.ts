import { describe, it, expect, beforeEach } from 'vitest';
import { addRepo } from '$lib/server/repos';
import { insertReview } from '$lib/server/ingest';
import { getTrends } from '$lib/server/trends';
import { resetDb } from '../test-utils';

// Pin timezone deterministically for DST calendar arithmetic tests
process.env.TZ = 'America/New_York';

describe('getTrends', () => {
	const repoId = 'trends-repo';

	beforeEach(() => {
		resetDb();
		addRepo({ id: repoId, lang: 'Rust' });
	});

	it('returns continuous zero-filled buckets for the requested number of days', () => {
		const now = new Date('2024-06-15T12:00:00Z').getTime();
		const buckets = getTrends(7, {}, now);
		expect(buckets).toHaveLength(7);
		for (const b of buckets) {
			expect(b.newFindings).toBe(0);
			expect(b.resolvedFindings).toBe(0);
			expect(b.reviews).toBe(0);
			expect(typeof b.day).toBe('string');
			expect(typeof b.date).toBe('number');
		}
		// Newest day is last
		expect(buckets[6].date).toBeGreaterThan(buckets[0].date);
	});

	it('aggregates new findings, resolved findings, and review counts correctly', () => {
		// Set time on June 15, 2024
		const day1 = new Date('2024-06-14T10:00:00').getTime();
		const day2 = new Date('2024-06-15T10:00:00').getTime();

		insertReview(repoId, {
			commit: 'c001',
			createdAt: day1,
			findings: [
				{ severity: 'high', file: 'a.rs', title: 'Bug 1' },
				{ severity: 'med', file: 'b.rs', title: 'Bug 2' }
			]
		});

		// Second scan on day 2 resolving Bug 1
		insertReview(repoId, {
			commit: 'c002',
			createdAt: day2,
			findings: [{ severity: 'med', file: 'b.rs', title: 'Bug 2' }]
		});

		const buckets = getTrends(2, { repoId }, day2);
		expect(buckets).toHaveLength(2);

		// Day 1: 2 new findings, 0 resolved, 1 review
		expect(buckets[0].newFindings).toBe(2);
		expect(buckets[0].resolvedFindings).toBe(0);
		expect(buckets[0].reviews).toBe(1);

		// Day 2: 0 new findings, 1 resolved, 1 review
		expect(buckets[1].newFindings).toBe(0);
		expect(buckets[1].resolvedFindings).toBe(1);
		expect(buckets[1].reviews).toBe(1);
	});

	it('scopes to repoId when provided', () => {
		addRepo({ id: 'other-repo', lang: 'Go' });
		const now = new Date('2024-06-15T12:00:00').getTime();

		insertReview(repoId, {
			commit: 'c001',
			createdAt: now,
			findings: [{ severity: 'high', file: 'a.rs', title: 'Bug 1' }]
		});
		insertReview('other-repo', {
			commit: 'o001',
			createdAt: now,
			findings: [{ severity: 'high', file: 'a.go', title: 'Other Bug' }]
		});

		const repoBuckets = getTrends(1, { repoId }, now);
		expect(repoBuckets[0].newFindings).toBe(1);

		const allBuckets = getTrends(1, {}, now);
		expect(allBuckets[0].newFindings).toBe(2);
	});

	// KNOWN-WRONG (D13, fixed by T21): getTrends buckets by server TZ instead of UTC days
	it('buckets by server timezone across a DST transition (KNOWN-WRONG: D13)', () => {
		// In America/New_York, DST spring transition was Sunday, March 10, 2024 (23 hours long).
		// Clocks sprang forward from 02:00 EST to 03:00 EDT.
		const march11Noon = new Date('2024-03-11T12:00:00').getTime();
		const buckets = getTrends(3, {}, march11Noon);
		expect(buckets).toHaveLength(3);

		// Buckets are: March 9, March 10, March 11
		expect(buckets[0].day).toBe('3/9');
		expect(buckets[1].day).toBe('3/10');
		expect(buckets[2].day).toBe('3/11');

		// Because it uses server local calendar arithmetic (Date.setDate),
		// the duration between March 10 midnight and March 11 midnight is 23 hours (82,800,000 ms),
		// NOT 24 hours (86,400,000 ms).
		const durationMs = buckets[2].date - buckets[1].date;
		expect(durationMs).toBe(23 * 3600 * 1000);
	});
});
