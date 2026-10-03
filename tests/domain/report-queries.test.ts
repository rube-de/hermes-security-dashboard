import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '$lib/server/db';
import { addRepo } from '$lib/server/repos';
import { insertReview } from '$lib/server/ingest';
import { load } from '../../src/routes/repo/[id]/review/[rid]/+page.server';
import { resetDb } from '../test-utils';

function countPreparesDuring(action: () => void): number {
	let count = 0;
	const originalPrepare = db.prepare.bind(db);
	db.prepare = ((...args: Parameters<typeof originalPrepare>) => {
		count++;
		return originalPrepare(...args);
	}) as typeof db.prepare;

	try {
		action();
	} finally {
		db.prepare = originalPrepare;
	}

	return count;
}

describe('report page load query count', () => {
	const repoId = 'query-count-test';

	beforeEach(() => {
		resetDb();
		addRepo({ id: repoId, lang: 'TypeScript' });
	});

	it('executes a constant number of prepares on report load regardless of review count', () => {
		const review1 = insertReview(repoId, {
			commit: 'c001',
			createdAt: 1000,
			findings: [{ severity: 'high', file: 'a.ts', title: 'Issue 1' }]
		});

		const mockEvent1 = {
			params: { id: repoId, rid: review1.id }
		};

		// Invoke page load with 1 review in repo history
		const queriesWith1Review = countPreparesDuring(() => {
			load(mockEvent1 as never);
		});

		// Now insert 10 additional reviews into the repository
		for (let i = 2; i <= 11; i++) {
			insertReview(repoId, {
				commit: `c00${i}`,
				createdAt: 1000 + i * 1000,
				findings: [{ severity: 'low', file: 'b.ts', title: `Issue ${i}` }]
			});
		}

		// Invoke page load again for review1 with 11 reviews in repo history
		const queriesWith11Reviews = countPreparesDuring(() => {
			load(mockEvent1 as never);
		});

		// The query prepare count must be strictly constant, not proportional to reviews in the repo
		expect(queriesWith1Review).toBeGreaterThan(0);
		expect(queriesWith11Reviews).toBe(queriesWith1Review);
	});
});
