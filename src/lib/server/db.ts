import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const DB_PATH = process.env.HERMES_DB || 'hermes.db';

if (DB_PATH !== ':memory:') {
	const dir = dirname(DB_PATH);
	if (dir && dir !== '.') mkdirSync(dir, { recursive: true });
}

export const db = new DatabaseSync(DB_PATH);

db.exec('PRAGMA journal_mode = WAL;');
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
  created_at     INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_reviews_repo ON reviews(repo_id, created_at DESC);
-- One review per (repo, commit): a commit's code is immutable, so re-submitting
-- the same commit is a retry, not a new run. Backstops the idempotent POST guard.
CREATE UNIQUE INDEX IF NOT EXISTS idx_reviews_repo_commit ON reviews(repo_id, commit_hash);

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

// Ensure the singleton scan row exists.
db.prepare('INSERT OR IGNORE INTO scan (id, active) VALUES (1, 0)').run();

// Seeding is triggered from hooks.server.ts `init` at runtime startup (not at
// import time) to avoid circular-init order problems during the build.
