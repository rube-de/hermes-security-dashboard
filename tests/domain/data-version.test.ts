import { describe, expect, it, beforeEach } from 'vitest';
import { db } from '$lib/server/db';
import { getDataVersion } from '$lib/server/meta';
import { addRepo } from '$lib/server/repos';
import { insertReview } from '$lib/server/ingest';
import { setTriage, clearTriage } from '$lib/server/triage';
import { setScan } from '$lib/server/scan';
import { resetDb } from '../test-utils';

describe('data_version counter and triggers', () => {
	beforeEach(() => {
		resetDb();
	});

	it('starts at 1 after resetDb', () => {
		expect(getDataVersion()).toBe(1);
	});

	it('increments on repo register and update', () => {
		const v0 = getDataVersion();
		addRepo({ id: 'test-repo', lang: 'Rust' });
		const v1 = getDataVersion();
		expect(v1).toBeGreaterThan(v0);

		addRepo({ id: 'test-repo', lang: 'Go', description: 'Updated desc' });
		const v2 = getDataVersion();
		expect(v2).toBeGreaterThan(v1);
	});

	it('increments on review insertion', () => {
		addRepo({ id: 'test-repo', lang: 'Rust' });
		const vBefore = getDataVersion();

		insertReview('test-repo', {
			commit: 'c001',
			findings: [{ severity: 'high', file: 'src/main.rs', title: 'Buffer Overflow' }]
		});
		const vAfter = getDataVersion();
		expect(vAfter).toBeGreaterThan(vBefore);
	});

	it('increments on triage set and clear', () => {
		addRepo({ id: 'test-repo', lang: 'Rust' });
		const { id: reviewId } = insertReview('test-repo', {
			commit: 'c001',
			findings: [{ severity: 'high', file: 'src/main.rs', title: 'Buffer Overflow' }]
		});
		const row = db.prepare('SELECT fingerprint FROM findings WHERE review_id = ?').get(reviewId) as {
			fingerprint: string;
		};
		const fp = row.fingerprint;

		const vBeforeSet = getDataVersion();
		setTriage('test-repo', fp, 'acknowledged', 'investigating');
		const vAfterSet = getDataVersion();
		expect(vAfterSet).toBeGreaterThan(vBeforeSet);

		setTriage('test-repo', fp, 'accepted_risk', 'mitigated by firewall');
		const vAfterUpdate = getDataVersion();
		expect(vAfterUpdate).toBeGreaterThan(vAfterSet);

		clearTriage('test-repo', fp);
		const vAfterClear = getDataVersion();
		expect(vAfterClear).toBeGreaterThan(vAfterUpdate);
	});

	it('increments on scan state start and finish, but NOT on progress ticks', () => {
		addRepo({ id: 'test-repo', lang: 'Rust' });
		const vInitial = getDataVersion();

		// Start scan (active: true, repoId, commit set)
		setScan({ active: true, repoId: 'test-repo', commit: 'c001', progress: 0 });
		const vStarted = getDataVersion();
		expect(vStarted).toBeGreaterThan(vInitial);

		// Progress update only: progress and currentFile change, active/repoId/commit stay the same
		setScan({ active: true, repoId: 'test-repo', commit: 'c001', progress: 25, currentFile: 'src/a.rs' });
		expect(getDataVersion()).toBe(vStarted);

		setScan({ active: true, repoId: 'test-repo', commit: 'c001', progress: 50, currentFile: 'src/b.rs' });
		expect(getDataVersion()).toBe(vStarted);

		setScan({ active: true, repoId: 'test-repo', commit: 'c001', progress: 100, currentFile: 'src/c.rs' });
		expect(getDataVersion()).toBe(vStarted);

		// Scan stop (active: false)
		setScan({ active: false });
		const vStopped = getDataVersion();
		expect(vStopped).toBeGreaterThan(vStarted);
	});
});
