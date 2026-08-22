import { DatabaseSync } from 'node:sqlite';
import { cfg } from './config.js';
export let db;
export function initDb(dbPath = cfg.dbPath) {
    db = new DatabaseSync(dbPath);
    db.exec('PRAGMA journal_mode = WAL');
    db.exec('PRAGMA foreign_keys = ON');
    db.exec(`
    CREATE TABLE IF NOT EXISTS agents (
      id            TEXT PRIMARY KEY,
      name          TEXT NOT NULL UNIQUE,
      parent_id     TEXT REFERENCES agents(id),
      session_id    TEXT,
      cwd           TEXT NOT NULL,
      model         TEXT,
      system_prompt TEXT,
      status        TEXT NOT NULL DEFAULT 'idle',
      retry_count   INTEGER NOT NULL DEFAULT 0,
      next_attempt_at INTEGER,
      total_cost_usd  REAL NOT NULL DEFAULT 0,
      total_turns     INTEGER NOT NULL DEFAULT 0,
      last_error    TEXT,
      created_at    INTEGER NOT NULL,
      updated_at    INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS messages (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_id   TEXT NOT NULL REFERENCES agents(id),
      from_type  TEXT NOT NULL,
      from_id    TEXT,
      from_label TEXT,
      content    TEXT NOT NULL,
      status     TEXT NOT NULL DEFAULT 'pending',
      turn_id    INTEGER,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_msg_pending ON messages(agent_id, status);
    CREATE TABLE IF NOT EXISTS watchers (
      id         TEXT PRIMARY KEY,
      agent_id   TEXT NOT NULL REFERENCES agents(id),
      type       TEXT NOT NULL,
      name       TEXT,
      config     TEXT NOT NULL,
      enabled    INTEGER NOT NULL DEFAULT 1,
      state      TEXT,
      last_fired_at INTEGER,
      fire_count INTEGER NOT NULL DEFAULT 0,
      last_error TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS turns (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_id TEXT NOT NULL,
      status TEXT NOT NULL,
      session_id_after TEXT,
      num_turns INTEGER,
      cost_usd REAL,
      usage TEXT,
      error TEXT,
      started_at INTEGER NOT NULL,
      finished_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_id TEXT,
      turn_id INTEGER,
      kind TEXT NOT NULL,
      payload TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_events_agent ON events(agent_id, id);
  `);
    migrate();
}
/** Additive migrations for DBs created by an earlier schema. Safe to re-run. */
function migrate() {
    const cols = new Set(db.prepare('PRAGMA table_info(agents)').all().map((c) => c.name));
    // standing = exempt from the idle reaper (long-lived dispatchers etc.)
    if (!cols.has('standing'))
        db.exec('ALTER TABLE agents ADD COLUMN standing INTEGER NOT NULL DEFAULT 0');
}
export const now = () => Date.now();
//# sourceMappingURL=db.js.map