import Database from 'better-sqlite3';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH   = resolve(__dirname, '..', 'data.sqlite');

export const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS watches (
    user_id    TEXT PRIMARY KEY,
    label      TEXT,
    added_at   INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS events (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     TEXT NOT NULL,
    type        TEXT NOT NULL,
    guild_id    TEXT,
    guild_name  TEXT,
    channel_id  TEXT,
    channel_name TEXT,
    content     TEXT,
    extra_json  TEXT,
    created_at  INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_events_user_created ON events (user_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_events_created      ON events (created_at DESC);

  CREATE TABLE IF NOT EXISTS tokens (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    label     TEXT,
    token     TEXT NOT NULL UNIQUE,
    enabled   INTEGER NOT NULL DEFAULT 1,
    added_at  INTEGER NOT NULL
  );
`);

export interface Watch {
  user_id: string;
  label: string | null;
  added_at: number;
}

export interface Event {
  id: number;
  user_id: string;
  type: string;
  guild_id: string | null;
  guild_name: string | null;
  channel_id: string | null;
  channel_name: string | null;
  content: string | null;
  extra_json: string | null;
  created_at: number;
}

// ── Prepared statements ─────────────────────────────────────────────────────

const stmtListWatches    = db.prepare('SELECT * FROM watches ORDER BY added_at DESC');
const stmtGetWatch       = db.prepare('SELECT * FROM watches WHERE user_id = ?');
const stmtAddWatch       = db.prepare('INSERT OR REPLACE INTO watches (user_id, label, added_at) VALUES (?, ?, ?)');
const stmtDeleteWatch    = db.prepare('DELETE FROM watches WHERE user_id = ?');
const stmtDeleteEvents   = db.prepare('DELETE FROM events WHERE user_id = ?');

const stmtInsertEvent = db.prepare(`
  INSERT INTO events (user_id, type, guild_id, guild_name, channel_id, channel_name, content, extra_json, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const stmtListEvents = db.prepare(`
  SELECT * FROM events
  WHERE (? IS NULL OR user_id = ?)
    AND (? IS NULL OR type = ?)
  ORDER BY created_at DESC
  LIMIT ?
`);

// ── API ─────────────────────────────────────────────────────────────────────

export const watches = {
  list:   () => stmtListWatches.all() as Watch[],
  get:    (id: string) => stmtGetWatch.get(id) as Watch | undefined,
  add:    (id: string, label: string | null) => stmtAddWatch.run(id, label, Date.now()),
  remove: (id: string) => {
    stmtDeleteEvents.run(id);
    stmtDeleteWatch.run(id);
  },
  ids:    () => new Set((stmtListWatches.all() as Watch[]).map(w => w.user_id)),
};

export interface TokenRow {
  id: number;
  label: string | null;
  token: string;
  enabled: number;
  added_at: number;
}

const stmtListTokens   = db.prepare('SELECT * FROM tokens ORDER BY added_at DESC');
const stmtGetToken     = db.prepare('SELECT * FROM tokens WHERE id = ?');
const stmtAddToken     = db.prepare('INSERT INTO tokens (label, token, enabled, added_at) VALUES (?, ?, 1, ?)');
const stmtDeleteToken  = db.prepare('DELETE FROM tokens WHERE id = ?');
const stmtSetEnabled   = db.prepare('UPDATE tokens SET enabled = ? WHERE id = ?');
const stmtUpdateLabel  = db.prepare('UPDATE tokens SET label = ? WHERE id = ?');

export const tokens = {
  list:    () => stmtListTokens.all() as TokenRow[],
  get:     (id: number) => stmtGetToken.get(id) as TokenRow | undefined,
  add:     (label: string | null, token: string) => {
    const r = stmtAddToken.run(label, token, Date.now());
    return r.lastInsertRowid as number;
  },
  remove:  (id: number) => stmtDeleteToken.run(id),
  setEnabled: (id: number, enabled: boolean) => stmtSetEnabled.run(enabled ? 1 : 0, id),
  setLabel:   (id: number, label: string | null) => stmtUpdateLabel.run(label, id),
};

export const events = {
  insert: (e: Omit<Event, 'id' | 'created_at'> & { created_at?: number }) => {
    const result = stmtInsertEvent.run(
      e.user_id, e.type, e.guild_id, e.guild_name, e.channel_id, e.channel_name, e.content, e.extra_json,
      e.created_at ?? Date.now()
    );
    return result.lastInsertRowid as number;
  },
  list: (opts: { userId?: string; type?: string; limit?: number } = {}) => {
    const userId = opts.userId ?? null;
    const type   = opts.type   ?? null;
    const limit  = Math.min(opts.limit ?? 200, 1000);
    return stmtListEvents.all(userId, userId, type, type, limit) as Event[];
  },
};
