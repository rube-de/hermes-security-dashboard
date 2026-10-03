import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { LATEST_VERSION, migrate } from '$lib/server/migrations';

function userVersion(db: DatabaseSync): number {
	return Number(db.prepare('PRAGMA user_version').get()?.user_version);
}

/** Table → sorted column names, plus sorted index names: the shape fresh and migrated DBs must share. */
function shape(db: DatabaseSync) {
	const tables = db
		.prepare(
			"SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
		)
		.all()
		.map((r) => String(r.name));
	const columns = Object.fromEntries(
		tables.map((t) => [
			t,
			db
				.prepare(`PRAGMA table_info(${t})`)
				.all()
				.map((c) => String(c.name))
				.sort()
		])
	);
	const indexes = db
		.prepare(
			"SELECT name FROM sqlite_master WHERE type = 'index' AND name NOT LIKE 'sqlite_%' ORDER BY name"
		)
		.all()
		.map((r) => String(r.name));
	return { tables, columns, indexes };
}

/** The earliest release: no model/content_hash columns, no dedup index, no triage table. */
function earliestReleaseDb(): DatabaseSync {
	const db = new DatabaseSync(':memory:');
	db.exec(`
		CREATE TABLE repos (id TEXT PRIMARY KEY, lang TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
		  path TEXT NOT NULL DEFAULT '', branch TEXT NOT NULL DEFAULT 'main', lines INTEGER NOT NULL DEFAULT 0,
		  created_at INTEGER NOT NULL);
		CREATE TABLE reviews (id TEXT PRIMARY KEY, repo_id TEXT NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
		  commit_hash TEXT NOT NULL, trigger TEXT NOT NULL DEFAULT 'Scheduled',
		  engine TEXT NOT NULL DEFAULT 'slither+semgrep+llm', summary TEXT NOT NULL DEFAULT '', html TEXT,
		  duration_secs INTEGER NOT NULL DEFAULT 0, lines INTEGER NOT NULL DEFAULT 0,
		  files_scanned INTEGER NOT NULL DEFAULT 0, prev_commit TEXT, new_count INTEGER NOT NULL DEFAULT 0,
		  resolved_count INTEGER NOT NULL DEFAULT 0, resolved_json TEXT NOT NULL DEFAULT '[]',
		  created_at INTEGER NOT NULL);
		CREATE TABLE findings (id INTEGER PRIMARY KEY AUTOINCREMENT,
		  review_id TEXT NOT NULL REFERENCES reviews(id) ON DELETE CASCADE, repo_id TEXT NOT NULL,
		  severity TEXT NOT NULL, title TEXT NOT NULL, file TEXT NOT NULL DEFAULT '', line INTEGER NOT NULL DEFAULT 0,
		  cwe TEXT NOT NULL DEFAULT '', description TEXT NOT NULL DEFAULT '', code TEXT NOT NULL DEFAULT '',
		  recommendation TEXT NOT NULL DEFAULT '', fingerprint TEXT NOT NULL, is_new INTEGER NOT NULL DEFAULT 0,
		  first_seen_at INTEGER NOT NULL);
		CREATE TABLE scan (id INTEGER PRIMARY KEY CHECK (id = 1), active INTEGER NOT NULL DEFAULT 0, repo_id TEXT,
		  commit_hash TEXT, current_file TEXT, progress REAL NOT NULL DEFAULT 0, engine TEXT, started_at INTEGER);
		CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
	`);
	db.exec('PRAGMA foreign_keys = ON');
	return db;
}

function insertReview(db: DatabaseSync, id: string, commit: string, createdAt: number) {
	db.prepare(
		'INSERT INTO reviews (id, repo_id, commit_hash, new_count, created_at) VALUES (?, ?, ?, 1, ?)'
	).run(id, 'r1', commit, createdAt);
	db.prepare(
		`INSERT INTO findings (review_id, repo_id, severity, title, file, fingerprint, is_new, first_seen_at)
		 VALUES (?, 'r1', 'high', 'Reentrancy', 'a.sol', 'fp-1', 1, 1000)`
	).run(id);
}

describe('migrate', () => {
	it('stamps a fresh database with the latest version', () => {
		const db = new DatabaseSync(':memory:');
		migrate(db);
		expect(userVersion(db)).toBe(LATEST_VERSION);
		expect(shape(db).tables).toEqual([
			'finding_triage',
			'findings',
			'meta',
			'repos',
			'reviews',
			'scan'
		]);
	});

	it('migrates the earliest release onto the same shape as a fresh database', () => {
		const fresh = new DatabaseSync(':memory:');
		migrate(fresh);
		const old = earliestReleaseDb();
		migrate(old);
		expect(userVersion(old)).toBe(LATEST_VERSION);
		expect(shape(old)).toEqual(shape(fresh));
	});

	it('backfills hashes, collapses byte-identical duplicate scans to the last one, and re-derives is_new', () => {
		const db = earliestReleaseDb();
		db.prepare("INSERT INTO repos (id, lang, created_at) VALUES ('r1', 'Solidity', 0)").run();
		// At-least-once delivery retry: the same scan landed twice.
		insertReview(db, 'rv-a', 'c1', 1000);
		insertReview(db, 'rv-b', 'c1', 1000);

		migrate(db);

		const reviews = db.prepare('SELECT id, content_hash, new_count FROM reviews').all();
		expect(reviews).toHaveLength(1);
		expect(reviews[0].id).toBe('rv-b');
		expect(reviews[0].content_hash).toMatch(/^[0-9a-f]{40,}$/);
		expect(reviews[0].new_count).toBe(1);
		expect(db.prepare('SELECT COUNT(*) AS n FROM findings').get()?.n).toBe(1);
		expect(db.prepare("SELECT value FROM meta WHERE key = 'delta_model'").get()?.value).toBe(
			'firstseen'
		);
	});

	it('replaces the old (repo, commit) unique guard so a commit can be scanned twice', () => {
		const db = earliestReleaseDb();
		db.exec('CREATE UNIQUE INDEX idx_reviews_repo_commit ON reviews(repo_id, commit_hash)');
		migrate(db);
		const indexes = shape(db).indexes;
		expect(indexes).not.toContain('idx_reviews_repo_commit');
		expect(indexes).toContain('idx_reviews_repo_hash');
	});

	it('runs nothing on a database already at the latest version', () => {
		const db = earliestReleaseDb();
		db.prepare("INSERT INTO repos (id, lang, created_at) VALUES ('r1', 'Solidity', 0)").run();
		insertReview(db, 'rv-a', 'c1', 1000);
		migrate(db);

		// State migration 1 would rewrite if it ran again.
		db.exec("DELETE FROM meta WHERE key = 'delta_model'");
		db.exec('UPDATE findings SET is_new = 0');
		db.exec('UPDATE reviews SET content_hash = NULL');

		migrate(db);

		expect(db.prepare('SELECT is_new FROM findings').get()?.is_new).toBe(0);
		expect(db.prepare('SELECT content_hash FROM reviews').get()?.content_hash).toBeNull();
		expect(db.prepare("SELECT 1 FROM meta WHERE key = 'delta_model'").get()).toBeUndefined();
	});

	it('refuses a database written by a newer build', () => {
		const db = new DatabaseSync(':memory:');
		migrate(db);
		db.exec(`PRAGMA user_version = ${LATEST_VERSION + 1}`);
		expect(() => migrate(db)).toThrow(/newer than this build/);
	});
});
