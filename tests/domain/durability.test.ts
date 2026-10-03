import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DatabaseSync, backup } from 'node:sqlite';
import { unlinkSync, existsSync, renameSync } from 'node:fs';

describe('durability snapshot round-trip', () => {
	const sourcePath = '/tmp/hermes-durability-test-source.db';
	const snapshotPath = '/tmp/hermes-durability-test-target.db';

	beforeEach(() => {
		if (existsSync(sourcePath)) unlinkSync(sourcePath);
		if (existsSync(snapshotPath)) unlinkSync(snapshotPath);
	});

	afterEach(() => {
		if (existsSync(sourcePath)) unlinkSync(sourcePath);
		if (existsSync(snapshotPath)) unlinkSync(snapshotPath);
	});

	it('creates an exact point-in-time snapshot with async backup() that restores identical data', async () => {
		const sourceDb = new DatabaseSync(sourcePath);
		sourceDb.exec(`
			CREATE TABLE repos (id TEXT PRIMARY KEY, lang TEXT);
			CREATE TABLE findings (id INTEGER PRIMARY KEY, title TEXT, severity TEXT);
			INSERT INTO repos VALUES ('oasis-core', 'Rust'), ('sapphire', 'Solidity');
			INSERT INTO findings VALUES (1, 'Reentrancy', 'high'), (2, 'Missing Auth', 'crit');
		`);

		const tmp = `${snapshotPath}.tmp`;
		await backup(sourceDb, tmp);
		renameSync(tmp, snapshotPath);

		// Source DB can continue operating or close
		sourceDb.close();

		expect(existsSync(snapshotPath)).toBe(true);
		const restoredDb = new DatabaseSync(snapshotPath);
		const repos = restoredDb.prepare('SELECT * FROM repos ORDER BY id').all();
		const findings = restoredDb.prepare('SELECT * FROM findings ORDER BY id').all();

		expect(repos).toEqual([
			{ id: 'oasis-core', lang: 'Rust' },
			{ id: 'sapphire', lang: 'Solidity' }
		]);
		expect(findings).toEqual([
			{ id: 1, title: 'Reentrancy', severity: 'high' },
			{ id: 2, title: 'Missing Auth', severity: 'crit' }
		]);
		restoredDb.close();
	});
});
