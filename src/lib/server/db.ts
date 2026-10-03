import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, existsSync, statSync, copyFileSync, rmSync } from 'node:fs';
import { dirname } from 'node:path';
import { migrate } from './migrations';

/** Live database file. */
export const DB_PATH = process.env.HERMES_DB || 'hermes.db';

/**
 * Consistent point-in-time copy emitted for the external sync layer to ship to
 * object storage (see `durability.ts`). Defaults next to the live DB; never the
 * live `.db`/`-wal`/`-shm`, which are unsafe to copy with an external tool.
 */
export const SNAPSHOT_PATH =
	DB_PATH === ':memory:' ? '' : process.env.HERMES_DB_SNAPSHOT || `${DB_PATH}.snapshot`;

if (DB_PATH !== ':memory:') {
	const dir = dirname(DB_PATH);
	if (dir && dir !== '.') mkdirSync(dir, { recursive: true });

	// Restore from the synced snapshot BEFORE opening (and before seeding): on a
	// fresh or restored volume the live DB is missing/empty but the snapshot the
	// sidecar shipped is present — copy it into place so real data is served and
	// demo seeding stays a no-op. Stale WAL/SHM are dropped so they can't shadow it.
	const liveMissingOrEmpty = !existsSync(DB_PATH) || statSync(DB_PATH).size === 0;
	if (liveMissingOrEmpty && SNAPSHOT_PATH && existsSync(SNAPSHOT_PATH)) {
		copyFileSync(SNAPSHOT_PATH, DB_PATH);
		rmSync(`${DB_PATH}-wal`, { force: true });
		rmSync(`${DB_PATH}-shm`, { force: true });
		console.log(`[hermes] restored database from snapshot ${SNAPSHOT_PATH}`);
	}
}

export const db = new DatabaseSync(DB_PATH);

// WAL keeps reads non-blocking and decouples the live file from the snapshot the
// sync sidecar copies; NORMAL is the safe durability/throughput trade-off under
// WAL; busy_timeout absorbs brief lock contention instead of throwing.
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA synchronous = NORMAL;');
db.exec('PRAGMA busy_timeout = 5000;');
db.exec('PRAGMA foreign_keys = ON;');

migrate(db);

// Ensure the singleton scan row exists.
db.prepare('INSERT OR IGNORE INTO scan (id, active) VALUES (1, 0)').run();

// Seeding is triggered from hooks.server.ts `init` at runtime startup (not at
// import time) to avoid circular-init order problems during the build.
