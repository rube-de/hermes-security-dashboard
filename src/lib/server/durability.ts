import { renameSync, rmSync } from 'node:fs';
import { db, SNAPSHOT_PATH } from './db';

/**
 * SQLite durability across an external file-sync boundary.
 *
 * In production `HERMES_DB` lives on a volume that a separate rclone sidecar
 * periodically file-copies to object storage and restores on redeploy. Copying
 * a live SQLite file with an external tool is unsafe, so we never let it copy
 * the `.db`/`-wal`/`-shm`. Instead we emit a consistent snapshot via
 * `VACUUM INTO` and hand the sidecar that single, complete file.
 *
 * Started from `hooks.server.ts` in production only (not `vite dev`), so dev and
 * root-path behavior are unchanged.
 */

const INTERVAL_SECS = Math.max(1, Number(process.env.HERMES_SNAPSHOT_INTERVAL) || 300);

let started = false;
let signalled = false;
let finalized = false;
let timer: ReturnType<typeof setInterval> | null = null;

/**
 * Write a consistent point-in-time copy for the sync layer. `VACUUM INTO` errors
 * if the target already exists, so we vacuum into a temp file and atomically
 * rename it over the snapshot — the sidecar therefore only ever sees a complete
 * database, never a half-written one.
 */
export function snapshot(): void {
	if (!SNAPSHOT_PATH) return;
	const tmp = `${SNAPSHOT_PATH}.tmp`;
	rmSync(tmp, { force: true });
	db.exec(`VACUUM INTO '${tmp.replace(/'/g, "''")}'`);
	renameSync(tmp, SNAPSHOT_PATH);
}

/** Fold the WAL back into the main DB so `-wal` doesn't grow without bound. */
function checkpoint(): void {
	db.exec('PRAGMA wal_checkpoint(TRUNCATE);');
}

function tick(): void {
	try {
		checkpoint();
		snapshot();
	} catch (err) {
		console.error('[hermes] snapshot tick failed', err);
	}
}

/**
 * On the signal: snapshot immediately (so committed data survives even if the
 * grace period is cut short) and stop the interval — but do NOT exit. We let
 * adapter-node drain in-flight requests; the close+exit happens in `finalize`.
 */
function onSignal(reason: string): void {
	if (signalled) return;
	signalled = true;
	if (timer) clearInterval(timer);
	console.log(`[hermes] ${reason} — snapshotting, awaiting request drain`);
	try {
		snapshot();
	} catch (err) {
		console.error('[hermes] snapshot on signal failed', err);
	}
}

/**
 * Runs on `sveltekit:shutdown`, which adapter-node emits only after the HTTP
 * server has closed all connections. Captures any writes that landed during the
 * drain, closes the DB, and exits cleanly.
 */
function finalize(): void {
	if (finalized) return;
	finalized = true;
	try {
		snapshot();
	} catch (err) {
		console.error('[hermes] final snapshot failed', err);
	}
	try {
		db.close();
	} catch {
		/* already closed */
	}
	console.log('[hermes] shutdown complete');
	process.exit(0);
}

/** Idempotent. Starts the snapshot interval and installs shutdown traps. */
export function startDurability(): void {
	if (started) return;
	started = true;

	if (!SNAPSHOT_PATH) {
		console.warn('[hermes] durability disabled (in-memory DB) — no snapshots emitted');
		return;
	}

	// Emit one immediately so a snapshot exists before the first interval elapses,
	// then on the configured cadence.
	tick();
	timer = setInterval(tick, INTERVAL_SECS * 1000);
	timer.unref?.();

	// Cooperate with adapter-node's graceful shutdown: it traps SIGTERM/SIGINT,
	// drains the HTTP server, then emits `sveltekit:shutdown`. We snapshot on the
	// signal for safety and do the close+exit once the drain has finished.
	process.once('SIGTERM', () => onSignal('SIGTERM'));
	process.once('SIGINT', () => onSignal('SIGINT'));
	process.once('sveltekit:shutdown', finalize);

	console.log(`[hermes] durability on — snapshot every ${INTERVAL_SECS}s → ${SNAPSHOT_PATH}`);
}
