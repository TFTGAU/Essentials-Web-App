import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

export const dataDir = process.env.DATA_DIR || path.resolve('data-store');
fs.mkdirSync(dataDir, { recursive: true });

export const db = new DatabaseSync(path.join(dataDir, 'essentials.db'));

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS users (
    email       TEXT PRIMARY KEY,
    name        TEXT,
    picture     TEXT,
    is_admin    INTEGER NOT NULL DEFAULT 0,
    source      TEXT NOT NULL DEFAULT 'app',   -- 'env' users are managed by environment variables
    added_by    TEXT,
    created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    last_login  TEXT
  );

  CREATE TABLE IF NOT EXISTS assessments (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    scope       TEXT NOT NULL DEFAULT '[]',     -- JSON array of in-scope domain names ([] = all)
    archived    INTEGER NOT NULL DEFAULT 0,
    created_by  TEXT NOT NULL,
    created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_by  TEXT,
    updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );

  -- One row per answered item. kind: action | igp | e8level | e8override
  CREATE TABLE IF NOT EXISTS responses (
    assessment_id INTEGER NOT NULL REFERENCES assessments(id) ON DELETE CASCADE,
    kind          TEXT NOT NULL,
    domain        TEXT NOT NULL DEFAULT '',
    item_id       TEXT NOT NULL,
    data          TEXT NOT NULL DEFAULT '{}',
    updated_by    TEXT,
    updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    PRIMARY KEY (assessment_id, kind, domain, item_id)
  );
  CREATE INDEX IF NOT EXISTS responses_updated ON responses(assessment_id, updated_at);

  -- Server-side sessions. Only a keyed hash of the cookie token is stored.
  CREATE TABLE IF NOT EXISTS sessions (
    token_hash  TEXT PRIMARY KEY,
    email       TEXT NOT NULL,
    created_at  TEXT NOT NULL,
    expires_at  TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS sessions_email ON sessions(email);
`);

// Migrations for databases created by earlier versions
const assessmentCols = db.prepare(`PRAGMA table_info(assessments)`).all().map((c) => c.name);
if (!assessmentCols.includes('restored_at')) db.exec(`ALTER TABLE assessments ADD COLUMN restored_at TEXT`);

export const now = () => new Date().toISOString();

export function tx(fn) {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}
