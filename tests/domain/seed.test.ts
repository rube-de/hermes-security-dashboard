import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '$lib/server/db';
import { seedIfEmpty } from '$lib/server/seed';
import { resetDb } from '../test-utils';

function getRepoCount(): number {
	const row = db.prepare('SELECT COUNT(*) AS n FROM repos').get();
	if (row && typeof row === 'object' && 'n' in row) {
		return Number(row.n);
	}
	return -1;
}

describe('seedIfEmpty behavior', () => {
	beforeEach(() => {
		resetDb();
		delete process.env.HERMES_SEED_DEMO;
	});

	it('does not seed in production mode when HERMES_SEED_DEMO is unset', () => {
		seedIfEmpty(false);
		expect(getRepoCount()).toBe(0);
	});

	it('seeds in dev mode when HERMES_SEED_DEMO is unset', () => {
		seedIfEmpty(true);
		expect(getRepoCount()).toBeGreaterThan(0);
	});

	it('seeds in production mode when HERMES_SEED_DEMO=true', () => {
		process.env.HERMES_SEED_DEMO = 'true';
		seedIfEmpty(false);
		expect(getRepoCount()).toBeGreaterThan(0);
	});

	it('does not seed in dev mode when HERMES_SEED_DEMO=false', () => {
		process.env.HERMES_SEED_DEMO = 'false';
		seedIfEmpty(true);
		expect(getRepoCount()).toBe(0);
	});
});
