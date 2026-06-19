import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, existsSync, statSync, copyFileSync, rmSync } from 'node:fs';
import { dirname } from 'node:path';
import { contentHash } from './content-hash';

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

const SCHEMA = `
CREATE TABLE IF NOT EXISTS repos (
  id          TEXT PRIMARY KEY,
  lang        TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  path        TEXT NOT NULL DEFAULT '',
  branch      TEXT NOT NULL DEFAULT 'main',
  lines       INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS reviews (
  id             TEXT PRIMARY KEY,
  repo_id        TEXT NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
  commit_hash    TEXT NOT NULL,
  model          TEXT NOT NULL DEFAULT '',
  trigger        TEXT NOT NULL DEFAULT 'Scheduled',
  engine         TEXT NOT NULL DEFAULT 'slither+semgrep+llm',
  summary        TEXT NOT NULL DEFAULT '',
  html           TEXT,
  duration_secs  INTEGER NOT NULL DEFAULT 0,
  lines          INTEGER NOT NULL DEFAULT 0,
  files_scanned  INTEGER NOT NULL DEFAULT 0,
  prev_commit    TEXT,
  new_count      INTEGER NOT NULL DEFAULT 0,
  resolved_count INTEGER NOT NULL DEFAULT 0,
  resolved_json  TEXT NOT NULL DEFAULT '[]',
  content_hash   TEXT,
  created_at     INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_reviews_repo ON reviews(repo_id, created_at DESC);
-- Dedup key. A commit can be scanned many times (non-deterministic LLM re-runs,
-- multiple models), so uniqueness is on the scan's *content* (commit + model +
-- engine + finding set), not on (repo, commit). Backstops the idempotent POST
-- guard. Created in migrate() rather than here because content_hash is added by
-- ALTER on pre-existing DBs and must exist before the index references it.

CREATE TABLE IF NOT EXISTS findings (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  review_id      TEXT NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
  repo_id        TEXT NOT NULL,
  severity       TEXT NOT NULL,
  title          TEXT NOT NULL,
  file           TEXT NOT NULL DEFAULT '',
  line           INTEGER NOT NULL DEFAULT 0,
  cwe            TEXT NOT NULL DEFAULT '',
  description    TEXT NOT NULL DEFAULT '',
  code           TEXT NOT NULL DEFAULT '',
  recommendation TEXT NOT NULL DEFAULT '',
  fingerprint    TEXT NOT NULL,
  is_new         INTEGER NOT NULL DEFAULT 0,
  first_seen_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_findings_review ON findings(review_id);
CREATE INDEX IF NOT EXISTS idx_findings_fp ON findings(repo_id, fingerprint);

-- Human triage of a finding (acknowledged / false-positive / accepted-risk). Keyed on
-- (repo_id, fingerprint) — the SAME stable identity the new/carried/resolved diff rides —
-- so a tag re-attaches on every agent re-run and across multi-model scans of a commit, and
-- the append-only insertReview write path never touches it. Absence of a row means
-- "open/untriaged"; clearing a tag deletes the row. fp_title/fp_file snapshot the finding
-- text at tag time so future drift-repair (when a rephrase shifts the fingerprint) is
-- possible without a migration.
CREATE TABLE IF NOT EXISTS finding_triage (
  repo_id     TEXT NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
  fingerprint TEXT NOT NULL,
  status      TEXT NOT NULL,
  note        TEXT NOT NULL DEFAULT '',
  fp_title    TEXT NOT NULL DEFAULT '',
  fp_file     TEXT NOT NULL DEFAULT '',
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  PRIMARY KEY (repo_id, fingerprint)
);

CREATE TABLE IF NOT EXISTS scan (
  id           INTEGER PRIMARY KEY CHECK (id = 1),
  active       INTEGER NOT NULL DEFAULT 0,
  repo_id      TEXT,
  commit_hash  TEXT,
  current_file TEXT,
  progress     REAL NOT NULL DEFAULT 0,
  engine       TEXT,
  started_at   INTEGER
);

CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

db.exec(SCHEMA);
migrate();

// Ensure the singleton scan row exists.
db.prepare('INSERT OR IGNORE INTO scan (id, active) VALUES (1, 0)').run();

/**
 * In-process, idempotent schema migration. `CREATE TABLE IF NOT EXISTS` is a no-op
 * on an existing table, so columns added after first deploy and the move off the
 * old `(repo, commit)` uniqueness have to be applied explicitly here. Safe to run
 * on every boot and on a snapshot restored from a prior version.
 */
function migrate(): void {
	const cols = new Set(
		(db.prepare('PRAGMA table_info(reviews)').all() as { name: string }[]).map((r) => r.name)
	);

	// Atomic: wrap the whole swap so a failure (e.g. CREATE UNIQUE INDEX on data we
	// couldn't fully dedup) rolls back the index DROP too. Otherwise a crash between
	// DROP and CREATE would leave the table with neither guard and re-crash on every
	// reboot (backfill is then a no-op, so it never self-heals).
	db.exec('BEGIN');
	try {
		if (!cols.has('model')) db.exec("ALTER TABLE reviews ADD COLUMN model TEXT NOT NULL DEFAULT ''");
		if (!cols.has('content_hash')) db.exec('ALTER TABLE reviews ADD COLUMN content_hash TEXT');

		// A commit is no longer unique within a repo — drop the old guard before the new
		// content-hash index, or both would constrain the table at once.
		db.exec('DROP INDEX IF EXISTS idx_reviews_repo_commit');

		backfillContentHashes();

		// Collapse pre-existing duplicate scans before the unique index. DBs created
		// before the (repo, commit) guard ever existed (the initial release had no
		// dedup at all) can hold byte-identical review rows from an at-least-once
		// delivery retry; those backfill to the SAME content_hash and would make the
		// unique index throw. Keep the LAST-inserted row per (repo, content_hash):
		// when two rows share a content hash but differ in untracked finding prose
		// (description/line/cwe/code/recommendation), the later submission is the more
		// likely to carry corrected detail, so collapsing toward it loses less than
		// keeping the earliest. Findings cascade-delete via the FK.
		const dups = db
			.prepare(
				`DELETE FROM reviews
				 WHERE content_hash IS NOT NULL
				   AND rowid NOT IN (
				     SELECT MAX(rowid) FROM reviews
				     WHERE content_hash IS NOT NULL
				     GROUP BY repo_id, content_hash
				   )`
			)
			.run();
		if (dups.changes > 0)
			console.log(`[hermes] collapsed ${dups.changes} duplicate review(s) before indexing`);

		db.exec(
			'CREATE UNIQUE INDEX IF NOT EXISTS idx_reviews_repo_hash ON reviews(repo_id, content_hash)'
		);
		// Non-unique lookup index for the per-commit union (overview) and the openRuns
		// scan — the dropped guard previously covered (repo_id, commit_hash).
		db.exec('CREATE INDEX IF NOT EXISTS idx_reviews_commit ON reviews(repo_id, commit_hash)');

		recomputeDeltas();

		db.exec('COMMIT');
	} catch (e) {
		db.exec('ROLLBACK');
		throw e;
	}
}

/**
 * Compute content_hash for rows that predate the column (NULL). Without this, a
 * post-upgrade retry of an old (repo, commit) would hash to a value no existing
 * row carries and insert a twin. Backfilled hashes are NOT guaranteed unique —
 * the earliest releases had no dedup, so a repo may carry duplicate review rows
 * that backfill to the same hash; migrate() collapses those before building the
 * unique index.
 */
function backfillContentHashes(): void {
	const rows = db
		.prepare('SELECT id, commit_hash, model, engine FROM reviews WHERE content_hash IS NULL')
		.all() as { id: string; commit_hash: string; model: string; engine: string }[];
	if (rows.length === 0) return;

	const findingsStmt = db.prepare('SELECT severity, file, title FROM findings WHERE review_id = ?');
	const upd = db.prepare('UPDATE reviews SET content_hash = ? WHERE id = ?');
	for (const r of rows) {
		const findings = findingsStmt.all(r.id) as { severity: string; file: string; title: string }[];
		// contentHash() canonicalizes the finding set (drops unknown severities, collapses
		// same-fingerprint duplicates) and trims commit/model/engine, so a legacy row whose
		// findings predate that canonicalization still hashes to what a faithful resubmit
		// produces — there's no value left to normalize here.
		const h = contentHash({
			commit: r.commit_hash,
			model: r.model ?? '',
			engine: r.engine,
			findings
		});
		upd.run(h, r.id);
	}
	console.log(`[hermes] backfilled content_hash for ${rows.length} review(s)`);
}

/**
 * One-time: bring the denormalized new/resolved deltas onto the current model.
 *
 * The intermediate "multiple scans per commit" release computed a per-scan delta for
 * EVERY scan of a commit (re-scans included) and relied on a query-time `is_first`
 * guard to avoid double-counting in trends. That guard is gone — trends now sum every
 * row — so those stale re-scan deltas would inflate the totals. Recompute the deltas
 * the way insertReview now writes them, from data already on the rows:
 *   - is_new flags exactly ONE finding row per (repo, fingerprint): the earliest
 *     occurrence (first by review created_at, ties broken by finding rowid); new_count
 *     follows. A single owner row keeps same-millisecond siblings from both counting.
 *   - resolved_count and prev_commit belong only to a commit's first scan; clear them
 *     on every later scan of the same (repo, commit) so a re-scan reports no diff.
 * Guarded by a meta marker so the table rewrite runs at most once. On a DB that only
 * ever had one scan per commit (the prior production line) this leaves resolved
 * untouched and only normalizes is_new.
 */
function recomputeDeltas(): void {
	const done = db.prepare("SELECT value FROM meta WHERE key = 'delta_model'").get() as
		| { value: string }
		| undefined;
	if (done?.value === 'firstseen') return;

	// Flag exactly ONE finding row per (repo, fingerprint): the earliest occurrence
	// (first by review created_at, ties broken by finding rowid). A single owner row —
	// not a created_at == first_seen_at equality — keeps two same-millisecond sibling
	// scans from both claiming the discovery.
	db.exec('UPDATE findings SET is_new = 0');
	db.exec(
		`UPDATE findings SET is_new = 1 WHERE rowid IN (
		   SELECT MIN(f.rowid) FROM findings f
		   JOIN reviews r ON r.id = f.review_id
		   WHERE r.created_at = f.first_seen_at
		   GROUP BY f.repo_id, f.fingerprint
		 )`
	);
	db.exec(
		`UPDATE reviews SET new_count =
		   (SELECT COUNT(*) FROM findings f WHERE f.review_id = reviews.id AND f.is_new = 1)`
	);
	// Clear the resolved delta AND the diff base on any scan that has an earlier scan of
	// the same (repo, commit) — i.e. every scan except the commit's first — so a migrated
	// re-scan renders no "Change since" header.
	db.exec(
		`UPDATE reviews SET resolved_count = 0, resolved_json = '[]', prev_commit = NULL
		 WHERE EXISTS (
		   SELECT 1 FROM reviews e
		   WHERE e.repo_id = reviews.repo_id AND e.commit_hash = reviews.commit_hash
		     AND (e.created_at < reviews.created_at
		          OR (e.created_at = reviews.created_at AND e.rowid < reviews.rowid))
		 )`
	);
	db.prepare(
		"INSERT INTO meta (key, value) VALUES ('delta_model', 'firstseen') ON CONFLICT(key) DO UPDATE SET value = excluded.value"
	).run();
	console.log('[hermes] recomputed review deltas onto first-seen model');
}

// Seeding is triggered from hooks.server.ts `init` at runtime startup (not at
// import time) to avoid circular-init order problems during the build.
