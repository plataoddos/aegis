import Database from 'better-sqlite3';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { encryptSecret, decryptSecret, isEncrypted } from './secretCrypto.js';

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

  CREATE TABLE IF NOT EXISTS persons (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    -- Identité (nom, prenom, date_naissance requis)
    nom             TEXT NOT NULL,
    prenom          TEXT NOT NULL,
    genre           TEXT,
    date_naissance  TEXT NOT NULL,
    -- Contact
    adresse         TEXT,
    complement      TEXT,
    code_postal     TEXT,
    ville           TEXT,
    -- Allocataire
    allocataire     TEXT,
    matricule       TEXT,
    email_alloc     TEXT,
    tel_alloc       TEXT,
    -- Bancaire
    iban            TEXT,
    bic             TEXT,
    -- Meta
    categorie       TEXT,
    ext_id          TEXT,
    notes           TEXT,
    created_at      INTEGER NOT NULL,
    updated_at      INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_persons_nom    ON persons (nom, prenom);
  CREATE INDEX IF NOT EXISTS idx_persons_ville  ON persons (ville);

  CREATE TABLE IF NOT EXISTS seek_cache (
    cache_key   TEXT PRIMARY KEY,
    endpoint    TEXT NOT NULL,
    params_json TEXT,
    response    TEXT NOT NULL,
    credits     INTEGER,
    fetched_at  INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_seek_cache_fetched ON seek_cache (fetched_at DESC);

  -- ── Multi-tenant users ────────────────────────────────────────────────
  CREATE TABLE IF NOT EXISTS users (
    key         TEXT PRIMARY KEY,
    username    TEXT NOT NULL,
    role        TEXT NOT NULL DEFAULT 'user',  -- 'admin' | 'user'
    created_at  INTEGER NOT NULL,
    expires_at  INTEGER,                       -- null = lifetime
    duration    INTEGER NOT NULL DEFAULT -1    -- days, -1 = lifetime
  );

  CREATE INDEX IF NOT EXISTS idx_users_username ON users (username);

  -- ── Canary / honeytoken triggers ──────────────────────────────────────
  CREATE TABLE IF NOT EXISTS canary_tokens (
    id           TEXT PRIMARY KEY,           -- short random ID (used in trigger URL)
    label        TEXT NOT NULL,
    type         TEXT NOT NULL,              -- 'url' | 'pixel' | 'redirect'
    note         TEXT,                       -- placement note (where you put it)
    redirect_url TEXT,                       -- only for type='redirect'
    enabled      INTEGER NOT NULL DEFAULT 1,
    created_by   TEXT,                       -- aegis user key
    created_at   INTEGER NOT NULL,
    last_hit_at  INTEGER,
    hit_count    INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS canary_events (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    token_id    TEXT NOT NULL,
    ip          TEXT,
    user_agent  TEXT,
    referer     TEXT,
    method      TEXT,
    path        TEXT,
    country     TEXT,
    country_code TEXT,
    city        TEXT,
    org         TEXT,
    created_at  INTEGER NOT NULL,
    FOREIGN KEY (token_id) REFERENCES canary_tokens(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_canary_events_token  ON canary_events (token_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_canary_tokens_user   ON canary_tokens (created_by, created_at DESC);
`);

// ── Idempotent migrations (ALTER TABLE … ADD COLUMN) ─────────────────────────
function hasColumn(table: string, column: string): boolean {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  return cols.some(c => c.name === column);
}

function ensureColumn(table: string, column: string, decl: string) {
  if (!hasColumn(table, column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${decl}`);
  }
}

// Rename legacy `owner_key` column to `created_by` if it exists (no-op otherwise)
function renameIfLegacy(table: string) {
  if (hasColumn(table, 'owner_key') && !hasColumn(table, 'created_by')) {
    db.exec(`ALTER TABLE ${table} RENAME COLUMN owner_key TO created_by`);
  }
}
renameIfLegacy('persons');
renameIfLegacy('watches');

// `created_by` — id du compte utilisateur Aegis auquel la ligne est rattachée.
// (À ne pas confondre avec `watches.user_id` qui est l'ID Discord surveillé.)
// Stored as TEXT for backwards compatibility with the legacy key-based scheme,
// but new code writes the integer user id (SQLite is dynamically typed).
ensureColumn('persons', 'created_by', 'TEXT');
ensureColumn('watches', 'created_by', 'TEXT');

// Drop legacy indexes if any, then create the new ones
db.exec(`
  DROP INDEX IF EXISTS idx_persons_owner;
  DROP INDEX IF EXISTS idx_watches_owner;
  CREATE INDEX IF NOT EXISTS idx_persons_created_by ON persons (created_by);
  CREATE INDEX IF NOT EXISTS idx_watches_created_by ON watches (created_by);
`);

// ── Migrate the legacy `users` table (key-based localStorage scheme) to the
//    new auth scheme (username + password_hash + premium). The legacy table is
//    archived as `users_legacy`; the new `users` table is created fresh.
{
  const cols = db.prepare(`PRAGMA table_info(users)`).all() as { name: string }[];
  const isLegacy = cols.some(c => c.name === 'key') && !cols.some(c => c.name === 'password_hash');
  if (isLegacy) {
    db.exec(`ALTER TABLE users RENAME TO users_legacy`);
  }
}

db.exec(`
  -- ── New auth-based users (username + password_hash) ──────────────────
  CREATE TABLE IF NOT EXISTS users (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    username        TEXT    NOT NULL UNIQUE COLLATE NOCASE,
    password_hash   TEXT    NOT NULL,
    is_admin        INTEGER NOT NULL DEFAULT 0,
    premium_until   INTEGER,                    -- ms timestamp, NULL = no premium
    created_at      INTEGER NOT NULL,
    last_login_at   INTEGER
  );

  -- ── Bearer sessions (issued at login, opaque random tokens) ──────────
  CREATE TABLE IF NOT EXISTS auth_sessions (
    token       TEXT PRIMARY KEY,
    user_id     INTEGER NOT NULL,
    created_at  INTEGER NOT NULL,
    expires_at  INTEGER NOT NULL,
    user_agent  TEXT,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_sessions_user    ON auth_sessions (user_id);
  CREATE INDEX IF NOT EXISTS idx_sessions_expires ON auth_sessions (expires_at);

  -- ── Premium activation keys (single-use, X days of premium) ──────────
  CREATE TABLE IF NOT EXISTS premium_keys (
    key         TEXT PRIMARY KEY,
    days        INTEGER NOT NULL,
    note        TEXT,
    created_by  INTEGER,                        -- admin user id
    created_at  INTEGER NOT NULL,
    used_by     INTEGER,                        -- user id who redeemed
    used_at     INTEGER,
    FOREIGN KEY (created_by) REFERENCES users(id),
    FOREIGN KEY (used_by)    REFERENCES users(id)
  );
  CREATE INDEX IF NOT EXISTS idx_premium_keys_used    ON premium_keys (used_by, used_at);
  CREATE INDEX IF NOT EXISTS idx_premium_keys_unused  ON premium_keys (used_at) WHERE used_at IS NULL;

  -- ── Per-user daily quota counters (reset implicitly each UTC day) ────
  CREATE TABLE IF NOT EXISTS daily_usage (
    user_id    INTEGER NOT NULL,
    date       TEXT    NOT NULL,                -- 'YYYY-MM-DD' UTC
    count      INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id, date),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  -- ── Detailed per-call API usage log (for stats: per provider/endpoint) ─
  CREATE TABLE IF NOT EXISTS api_usage (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL,
    api         TEXT    NOT NULL,                -- 'brixhub', 'ip-lookup', …
    endpoint    TEXT    NOT NULL,                -- 'search', 'lookup_email', …
    cost        INTEGER NOT NULL DEFAULT 1,      -- quota units (0 if cached)
    cached      INTEGER NOT NULL DEFAULT 0,
    ok          INTEGER NOT NULL DEFAULT 1,
    status      INTEGER,                         -- upstream HTTP status
    created_at  INTEGER NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_api_usage_user    ON api_usage (user_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_api_usage_api_ep  ON api_usage (api, endpoint, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_api_usage_created ON api_usage (created_at DESC);
`);

export interface Watch {
  user_id: string;
  label: string | null;
  added_at: number;
  /** Aegis user key the watch belongs to (null = legacy / admin global). */
  created_by: string | null;
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

const stmtListWatches       = db.prepare('SELECT * FROM watches ORDER BY added_at DESC');
const stmtListWatchesByUser = db.prepare('SELECT * FROM watches WHERE created_by = ? ORDER BY added_at DESC');
const stmtGetWatch          = db.prepare('SELECT * FROM watches WHERE user_id = ?');
const stmtAddWatch          = db.prepare('INSERT OR REPLACE INTO watches (user_id, label, added_at, created_by) VALUES (?, ?, ?, ?)');
const stmtDeleteWatch       = db.prepare('DELETE FROM watches WHERE user_id = ?');
const stmtDeleteWatchScoped = db.prepare('DELETE FROM watches WHERE user_id = ? AND created_by = ?');
const stmtDeleteEvents      = db.prepare('DELETE FROM events WHERE user_id = ?');

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
  /** List all watches (admin view). */
  list:        () => stmtListWatches.all() as Watch[],
  /** List watches attached to a specific Aegis user. */
  listByUser:  (userKey: string) => stmtListWatchesByUser.all(userKey) as Watch[],
  get:         (id: string) => stmtGetWatch.get(id) as Watch | undefined,
  /** Add/replace a watch, optionally attached to an Aegis user. */
  add:         (id: string, label: string | null, userKey: string | null = null) =>
    stmtAddWatch.run(id, label, Date.now(), userKey),
  /** Remove a watch globally (admin). Deletes its events too. */
  remove:      (id: string) => {
    stmtDeleteEvents.run(id);
    stmtDeleteWatch.run(id);
  },
  /** Remove only if attached to userKey. Returns whether it was deleted. */
  removeIfOwned: (id: string, userKey: string) => {
    const r = stmtDeleteWatchScoped.run(id, userKey);
    if (r.changes > 0) stmtDeleteEvents.run(id);
    return r.changes > 0;
  },
  /** All currently-watched Discord IDs (across all users). */
  ids:         () => new Set((stmtListWatches.all() as Watch[]).map(w => w.user_id)),
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
const stmtUpdateToken  = db.prepare('UPDATE tokens SET token = ? WHERE id = ?');
const stmtDeleteToken  = db.prepare('DELETE FROM tokens WHERE id = ?');
const stmtSetEnabled   = db.prepare('UPDATE tokens SET enabled = ? WHERE id = ?');
const stmtUpdateLabel  = db.prepare('UPDATE tokens SET label = ? WHERE id = ?');

// Selfbot tokens are encrypted at rest (AES-256-GCM, see secretCrypto.ts).
// Legacy plaintext rows are transparently re-encrypted on first read.
function decryptRow(row: TokenRow | undefined): TokenRow | undefined {
  if (!row) return row;
  try {
    if (isEncrypted(row.token)) {
      return { ...row, token: decryptSecret(row.token) };
    }
    // Legacy plaintext → upgrade in place so the next read is encrypted.
    const enc = encryptSecret(row.token);
    stmtUpdateToken.run(enc, row.id);
    return row;
  } catch {
    // Decryption failed (wrong key, corruption) — return without the token so
    // the bot can't (mis)use it ; the admin will see "ready=false".
    return { ...row, token: '' };
  }
}

export const tokens = {
  list:    () => (stmtListTokens.all() as TokenRow[]).map(r => decryptRow(r)!),
  get:     (id: number) => decryptRow(stmtGetToken.get(id) as TokenRow | undefined),
  add:     (label: string | null, token: string) => {
    const r = stmtAddToken.run(label, encryptSecret(token), Date.now());
    return r.lastInsertRowid as number;
  },
  remove:  (id: number) => stmtDeleteToken.run(id),
  setEnabled: (id: number, enabled: boolean) => stmtSetEnabled.run(enabled ? 1 : 0, id),
  setLabel:   (id: number, label: string | null) => stmtUpdateLabel.run(label, id),
};

// ── Persons ─────────────────────────────────────────────────────────────────
export interface Person {
  id: number;
  nom: string;
  prenom: string;
  genre: string | null;
  date_naissance: string;
  adresse: string | null;
  complement: string | null;
  code_postal: string | null;
  ville: string | null;
  allocataire: string | null;
  matricule: string | null;
  email_alloc: string | null;
  tel_alloc: string | null;
  iban: string | null;
  bic: string | null;
  categorie: string | null;
  ext_id: string | null;
  notes: string | null;
  created_at: number;
  updated_at: number;
}

export type PersonInput = Omit<Person, 'id' | 'created_at' | 'updated_at'>;

const PERSON_FIELDS = [
  'nom', 'prenom', 'genre', 'date_naissance',
  'adresse', 'complement', 'code_postal', 'ville',
  'allocataire', 'matricule', 'email_alloc', 'tel_alloc',
  'iban', 'bic', 'categorie', 'ext_id', 'notes',
] as const;

const stmtListPersons       = db.prepare('SELECT * FROM persons ORDER BY updated_at DESC');
const stmtListPersonsByUser  = db.prepare('SELECT * FROM persons WHERE created_by = ? ORDER BY updated_at DESC');
const stmtGetPerson          = db.prepare('SELECT * FROM persons WHERE id = ?');
const stmtDeletePerson       = db.prepare('DELETE FROM persons WHERE id = ?');
const stmtDeletePersonScoped = db.prepare('DELETE FROM persons WHERE id = ? AND created_by = ?');
const stmtInsertPerson       = db.prepare(`
  INSERT INTO persons (${PERSON_FIELDS.join(', ')}, created_by, created_at, updated_at)
  VALUES (${PERSON_FIELDS.map(() => '?').join(', ')}, ?, ?, ?)
`);

export const persons = {
  list: () => stmtListPersons.all() as Person[],
  listByUser: (userId: number | string) => stmtListPersonsByUser.all(String(userId)) as Person[],
  get:  (id: number) => stmtGetPerson.get(id) as Person | undefined,
  insert: (p: PersonInput, ownerId: number | string | null = null) => {
    const now = Date.now();
    const values = PERSON_FIELDS.map(f => (p as any)[f] ?? null);
    const r = stmtInsertPerson.run(...values, ownerId == null ? null : String(ownerId), now, now);
    return r.lastInsertRowid as number;
  },
  update: (id: number, p: Partial<PersonInput>) => {
    const fields = PERSON_FIELDS.filter(f => f in p);
    if (!fields.length) return 0;
    const sql = `UPDATE persons SET ${fields.map(f => `${f} = ?`).join(', ')}, updated_at = ? WHERE id = ?`;
    const vals = fields.map(f => (p as any)[f] ?? null);
    return db.prepare(sql).run(...vals, Date.now(), id).changes;
  },
  remove: (id: number) => stmtDeletePerson.run(id).changes,
  removeIfOwned: (id: number, ownerId: number | string) =>
    stmtDeletePersonScoped.run(id, String(ownerId)).changes,
  /** Returns the row's owner id, or null if not set (legacy / global). */
  ownerOf: (id: number): string | null => {
    const row = stmtGetPerson.get(id) as { created_by: string | null } | undefined;
    return row ? row.created_by : null;
  },
};

// ── Seek API cache ──────────────────────────────────────────────────────────
const stmtGetCache = db.prepare(
  'SELECT * FROM seek_cache WHERE cache_key = ? AND fetched_at > ?'
);
const stmtSetCache = db.prepare(`
  INSERT INTO seek_cache (cache_key, endpoint, params_json, response, credits, fetched_at)
  VALUES (?, ?, ?, ?, ?, ?)
  ON CONFLICT(cache_key) DO UPDATE SET
    response = excluded.response,
    credits  = excluded.credits,
    fetched_at = excluded.fetched_at
`);
const stmtPruneCache = db.prepare('DELETE FROM seek_cache WHERE fetched_at < ?');

export interface SeekCacheRow {
  cache_key: string;
  endpoint: string;
  params_json: string | null;
  response: string;
  credits: number | null;
  fetched_at: number;
}

export const seekCache = {
  /** Returns cached row if not expired (TTL ms ago). */
  get: (key: string, ttlMs: number) => {
    const cutoff = Date.now() - ttlMs;
    return stmtGetCache.get(key, cutoff) as SeekCacheRow | undefined;
  },
  set: (key: string, endpoint: string, params: any, response: any, credits: number | null) => {
    stmtSetCache.run(
      key, endpoint, params ? JSON.stringify(params) : null,
      JSON.stringify(response), credits, Date.now()
    );
  },
  /** Drop entries older than `olderThanMs`. */
  prune: (olderThanMs: number) => stmtPruneCache.run(Date.now() - olderThanMs).changes,
};

// ── Canary tokens / honeytokens ─────────────────────────────────────────────
export interface CanaryToken {
  id: string;
  label: string;
  type: 'url' | 'pixel' | 'redirect';
  note: string | null;
  redirect_url: string | null;
  enabled: number;
  created_by: string | null;
  created_at: number;
  last_hit_at: number | null;
  hit_count: number;
}

export interface CanaryEvent {
  id: number;
  token_id: string;
  ip: string | null;
  user_agent: string | null;
  referer: string | null;
  method: string | null;
  path: string | null;
  country: string | null;
  country_code: string | null;
  city: string | null;
  org: string | null;
  created_at: number;
}

const stmtListCanaries        = db.prepare('SELECT * FROM canary_tokens ORDER BY created_at DESC');
const stmtListCanariesByUser  = db.prepare('SELECT * FROM canary_tokens WHERE created_by = ? ORDER BY created_at DESC');
const stmtGetCanary           = db.prepare('SELECT * FROM canary_tokens WHERE id = ?');
const stmtInsertCanary        = db.prepare(`
  INSERT INTO canary_tokens (id, label, type, note, redirect_url, enabled, created_by, created_at, hit_count)
  VALUES (?, ?, ?, ?, ?, 1, ?, ?, 0)
`);
const stmtDeleteCanary        = db.prepare('DELETE FROM canary_tokens WHERE id = ?');
const stmtUpdateCanary        = db.prepare(`UPDATE canary_tokens SET label = ?, note = ?, enabled = ?, redirect_url = ? WHERE id = ?`);
const stmtBumpCanaryHit       = db.prepare('UPDATE canary_tokens SET hit_count = hit_count + 1, last_hit_at = ? WHERE id = ?');
const stmtInsertCanaryEvent   = db.prepare(`
  INSERT INTO canary_events (token_id, ip, user_agent, referer, method, path, country, country_code, city, org, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);
const stmtListCanaryEvents    = db.prepare(`
  SELECT * FROM canary_events WHERE token_id = ? ORDER BY created_at DESC LIMIT ?
`);
const stmtListAllCanaryEvents = db.prepare(`
  SELECT e.*, t.label as token_label
  FROM canary_events e
  JOIN canary_tokens t ON t.id = e.token_id
  WHERE (? IS NULL OR t.created_by = ?)
  ORDER BY e.created_at DESC
  LIMIT ?
`);

export const canaries = {
  list:       (userKey?: string) => (userKey
    ? stmtListCanariesByUser.all(userKey)
    : stmtListCanaries.all()) as CanaryToken[],
  get:        (id: string) => stmtGetCanary.get(id) as CanaryToken | undefined,
  insert:     (t: Omit<CanaryToken, 'created_at' | 'last_hit_at' | 'hit_count' | 'enabled'>) => {
    stmtInsertCanary.run(t.id, t.label, t.type, t.note, t.redirect_url, t.created_by, Date.now());
    return canaries.get(t.id)!;
  },
  update:     (id: string, p: { label?: string; note?: string | null; enabled?: boolean; redirect_url?: string | null }) => {
    const cur = canaries.get(id);
    if (!cur) return 0;
    return stmtUpdateCanary.run(
      p.label ?? cur.label,
      p.note !== undefined ? p.note : cur.note,
      p.enabled !== undefined ? (p.enabled ? 1 : 0) : cur.enabled,
      p.redirect_url !== undefined ? p.redirect_url : cur.redirect_url,
      id
    ).changes;
  },
  remove:     (id: string) => stmtDeleteCanary.run(id).changes,
  recordHit:  (id: string, ev: Omit<CanaryEvent, 'id' | 'created_at' | 'token_id'>) => {
    const now = Date.now();
    stmtInsertCanaryEvent.run(
      id, ev.ip, ev.user_agent, ev.referer, ev.method, ev.path,
      ev.country, ev.country_code, ev.city, ev.org, now,
    );
    stmtBumpCanaryHit.run(now, id);
  },
  events:     (tokenId: string, limit = 100) =>
    stmtListCanaryEvents.all(tokenId, Math.min(limit, 500)) as CanaryEvent[],
  recentEvents: (userKey: string | null, limit = 50) =>
    stmtListAllCanaryEvents.all(userKey, userKey, Math.min(limit, 500)) as (CanaryEvent & { token_label: string })[],
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

// ─────────────────────────────────────────────────────────────────────────────
//  Authentification (users / sessions / premium / quota journalier)
// ─────────────────────────────────────────────────────────────────────────────

export interface AuthUser {
  id: number;
  username: string;
  password_hash: string;
  is_admin: 0 | 1;
  premium_until: number | null;
  created_at: number;
  last_login_at: number | null;
}

export interface PremiumKey {
  key: string;
  days: number;
  note: string | null;
  created_by: number | null;
  created_at: number;
  used_by: number | null;
  used_at: number | null;
}

const stmtUserById       = db.prepare('SELECT * FROM users WHERE id = ?');
const stmtUserByUsername = db.prepare('SELECT * FROM users WHERE username = ? COLLATE NOCASE');
const stmtUserCount      = db.prepare('SELECT COUNT(*) AS n FROM users');
const stmtInsertUser     = db.prepare(`
  INSERT INTO users (username, password_hash, is_admin, created_at)
  VALUES (?, ?, ?, ?)
`);
const stmtUpdateLastLogin = db.prepare('UPDATE users SET last_login_at = ? WHERE id = ?');
const stmtSetPremiumUntil = db.prepare('UPDATE users SET premium_until = ? WHERE id = ?');
const stmtListUsers       = db.prepare('SELECT id, username, is_admin, premium_until, created_at, last_login_at FROM users ORDER BY created_at DESC');
const stmtSetAdmin        = db.prepare('UPDATE users SET is_admin = ? WHERE id = ?');
const stmtDeleteUser      = db.prepare('DELETE FROM users WHERE id = ?');
const stmtUpdatePassword  = db.prepare('UPDATE users SET password_hash = ? WHERE id = ?');

// Statements used by the explicit cascade in `users.remove`. We don't rely on
// `PRAGMA foreign_keys = ON` (it's off by default in better-sqlite3), so we
// clean up dependent rows manually inside a transaction.
const stmtDelUserSessions    = db.prepare('DELETE FROM auth_sessions WHERE user_id = ?');
const stmtDelUserDailyUsage  = db.prepare('DELETE FROM daily_usage   WHERE user_id = ?');
const stmtDelUserApiUsage    = db.prepare('DELETE FROM api_usage     WHERE user_id = ?');
// Premium keys reference users(id) without ON DELETE — null the FK fields
// instead of dropping the keys (they're audit history).
const stmtNullPremiumCreated = db.prepare('UPDATE premium_keys SET created_by = NULL WHERE created_by = ?');
const stmtNullPremiumUsed    = db.prepare('UPDATE premium_keys SET used_by    = NULL WHERE used_by    = ?');
// Persons & watches reference the user via TEXT(created_by). Delete the rows
// the user owned along with the user itself.
const stmtDelUserPersons     = db.prepare('DELETE FROM persons WHERE created_by = ?');
const stmtDelUserWatchEvents = db.prepare('DELETE FROM events  WHERE user_id IN (SELECT user_id FROM watches WHERE created_by = ?)');
const stmtDelUserWatches     = db.prepare('DELETE FROM watches WHERE created_by = ?');

const removeUserTx = db.transaction((id: number) => {
  const idStr = String(id);
  stmtDelUserSessions.run(id);
  stmtDelUserDailyUsage.run(id);
  stmtDelUserApiUsage.run(id);
  stmtNullPremiumCreated.run(id);
  stmtNullPremiumUsed.run(id);
  stmtDelUserPersons.run(idStr);
  stmtDelUserWatchEvents.run(idStr);
  stmtDelUserWatches.run(idStr);
  return stmtDeleteUser.run(id).changes;
});

export const users = {
  count: (): number => (stmtUserCount.get() as { n: number }).n,
  byId: (id: number) => stmtUserById.get(id) as AuthUser | undefined,
  byUsername: (username: string) => stmtUserByUsername.get(username) as AuthUser | undefined,
  insert: (username: string, passwordHash: string, isAdmin = false): AuthUser => {
    const r = stmtInsertUser.run(username, passwordHash, isAdmin ? 1 : 0, Date.now());
    return users.byId(r.lastInsertRowid as number)!;
  },
  touchLogin: (id: number) => { stmtUpdateLastLogin.run(Date.now(), id); },
  setPremiumUntil: (id: number, ts: number | null) => { stmtSetPremiumUntil.run(ts, id); },
  setAdmin: (id: number, isAdmin: boolean) => { stmtSetAdmin.run(isAdmin ? 1 : 0, id); },
  setPassword: (id: number, hash: string) => { stmtUpdatePassword.run(hash, id); },
  list: () => stmtListUsers.all() as Array<Omit<AuthUser, 'password_hash'>>,
  /** Hard-delete a user + all rows that reference them (atomic transaction). */
  remove: (id: number) => removeUserTx(id),
};

// ── Sessions ──────────────────────────────────────────────────────────────
const stmtInsertSession = db.prepare(`
  INSERT INTO auth_sessions (token, user_id, created_at, expires_at, user_agent)
  VALUES (?, ?, ?, ?, ?)
`);
const stmtGetSession = db.prepare(`
  SELECT s.*, u.id AS u_id, u.username, u.is_admin, u.premium_until, u.created_at AS u_created_at, u.last_login_at
  FROM auth_sessions s
  JOIN users u ON u.id = s.user_id
  WHERE s.token = ? AND s.expires_at > ?
`);
const stmtDeleteSession        = db.prepare('DELETE FROM auth_sessions WHERE token = ?');
const stmtDeleteUserSessions   = db.prepare('DELETE FROM auth_sessions WHERE user_id = ?');
const stmtSweepExpiredSessions = db.prepare('DELETE FROM auth_sessions WHERE expires_at <= ?');
const stmtTouchSession         = db.prepare('UPDATE auth_sessions SET expires_at = ? WHERE token = ?');

export const sessions = {
  insert: (token: string, userId: number, expiresAt: number, userAgent: string | null) => {
    stmtInsertSession.run(token, userId, Date.now(), expiresAt, userAgent);
  },
  resolve: (token: string): (Omit<AuthUser, 'password_hash'> & { token: string }) | null => {
    const row: any = stmtGetSession.get(token, Date.now());
    if (!row) return null;
    return {
      token: row.token,
      id: row.u_id,
      username: row.username,
      is_admin: row.is_admin,
      premium_until: row.premium_until,
      created_at: row.u_created_at,
      last_login_at: row.last_login_at,
    };
  },
  remove:        (token: string) => stmtDeleteSession.run(token).changes,
  removeForUser: (userId: number) => stmtDeleteUserSessions.run(userId).changes,
  sweepExpired:  () => stmtSweepExpiredSessions.run(Date.now()).changes,
  /** Extend the session expiry to `newExpiresAt`. Used for sliding refresh. */
  touch:         (token: string, newExpiresAt: number) =>
                   stmtTouchSession.run(newExpiresAt, token).changes,
};

// Sweep expired sessions every hour.
setInterval(() => sessions.sweepExpired(), 3600_000).unref?.();

// ── Premium keys ──────────────────────────────────────────────────────────
const stmtInsertPremiumKey = db.prepare(`
  INSERT INTO premium_keys (key, days, note, created_by, created_at)
  VALUES (?, ?, ?, ?, ?)
`);
const stmtGetPremiumKey      = db.prepare('SELECT * FROM premium_keys WHERE key = ?');
const stmtMarkPremiumKeyUsed = db.prepare('UPDATE premium_keys SET used_by = ?, used_at = ? WHERE key = ? AND used_at IS NULL');
const stmtListPremiumKeys    = db.prepare('SELECT * FROM premium_keys ORDER BY created_at DESC LIMIT ?');
const stmtRemovePremiumKey   = db.prepare('DELETE FROM premium_keys WHERE key = ? AND used_at IS NULL');

export const premiumKeys = {
  insert: (key: string, days: number, note: string | null, createdBy: number | null) => {
    stmtInsertPremiumKey.run(key, days, note, createdBy, Date.now());
    return premiumKeys.get(key)!;
  },
  get:    (key: string) => stmtGetPremiumKey.get(key) as PremiumKey | undefined,
  /** Atomically marks the key as used. Returns true on success, false if already used. */
  redeem: (key: string, userId: number): boolean =>
    stmtMarkPremiumKeyUsed.run(userId, Date.now(), key).changes > 0,
  list:   (limit = 200) => stmtListPremiumKeys.all(Math.min(limit, 1000)) as PremiumKey[],
  /** Only allows deletion of unused keys (admin cleanup). */
  remove: (key: string) => stmtRemovePremiumKey.run(key).changes,
};

// ── Daily usage (per-user quota counter) ──────────────────────────────────
const stmtGetUsage = db.prepare('SELECT count FROM daily_usage WHERE user_id = ? AND date = ?');
const stmtBumpUsage = db.prepare(`
  INSERT INTO daily_usage (user_id, date, count) VALUES (?, ?, 1)
  ON CONFLICT(user_id, date) DO UPDATE SET count = count + 1
`);

function utcDateString(): string {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD UTC
}

export const dailyUsage = {
  /** Returns today's call count for the user (UTC day). */
  today: (userId: number): number => {
    const row = stmtGetUsage.get(userId, utcDateString()) as { count: number } | undefined;
    return row?.count ?? 0;
  },
  /** Increments today's counter. Call only when an actual upstream call was made. */
  bump: (userId: number) => {
    stmtBumpUsage.run(userId, utcDateString());
  },
};

// ─────────────────────────────────────────────────────────────────────────────
//  Detailed API usage log — used by the admin "Statistiques" page to show per
//  provider / endpoint / user consumption.
// ─────────────────────────────────────────────────────────────────────────────
export interface ApiUsageRow {
  id: number;
  user_id: number;
  api: string;
  endpoint: string;
  cost: number;
  cached: 0 | 1;
  ok: 0 | 1;
  status: number | null;
  created_at: number;
}

const stmtInsertApiUsage = db.prepare(`
  INSERT INTO api_usage (user_id, api, endpoint, cost, cached, ok, status, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`);

const stmtUsageTotals = db.prepare(`
  SELECT
    COUNT(*) AS calls,
    COALESCE(SUM(CASE WHEN cached = 1 THEN 0 ELSE cost END), 0) AS quota_used,
    COALESCE(SUM(cached), 0) AS cache_hits,
    COALESCE(SUM(CASE WHEN ok = 0 THEN 1 ELSE 0 END), 0) AS errors
  FROM api_usage
  WHERE created_at >= ?
`);

const stmtUsageByApi = db.prepare(`
  SELECT api,
         COUNT(*) AS calls,
         COALESCE(SUM(CASE WHEN cached = 1 THEN 0 ELSE cost END), 0) AS quota_used,
         COALESCE(SUM(cached), 0) AS cache_hits,
         COALESCE(SUM(CASE WHEN ok = 0 THEN 1 ELSE 0 END), 0) AS errors
  FROM api_usage
  WHERE created_at >= ?
  GROUP BY api
  ORDER BY calls DESC
`);

const stmtUsageByEndpoint = db.prepare(`
  SELECT api, endpoint,
         COUNT(*) AS calls,
         COALESCE(SUM(CASE WHEN cached = 1 THEN 0 ELSE cost END), 0) AS quota_used,
         COALESCE(SUM(cached), 0) AS cache_hits,
         COALESCE(SUM(CASE WHEN ok = 0 THEN 1 ELSE 0 END), 0) AS errors
  FROM api_usage
  WHERE created_at >= ?
  GROUP BY api, endpoint
  ORDER BY calls DESC
`);

const stmtUsageByUser = db.prepare(`
  SELECT u.id, u.username, u.is_admin, u.premium_until,
         COUNT(au.id) AS calls,
         COALESCE(SUM(CASE WHEN au.cached = 1 THEN 0 ELSE au.cost END), 0) AS quota_used
  FROM api_usage au
  JOIN users u ON u.id = au.user_id
  WHERE au.created_at >= ?
  GROUP BY au.user_id
  ORDER BY calls DESC
  LIMIT 50
`);

const stmtUsageDaily = db.prepare(`
  SELECT date(created_at / 1000, 'unixepoch') AS day,
         COUNT(*) AS calls,
         COALESCE(SUM(CASE WHEN cached = 1 THEN 0 ELSE cost END), 0) AS quota_used
  FROM api_usage
  WHERE created_at >= ?
  GROUP BY day
  ORDER BY day ASC
`);

const stmtUsageRecent = db.prepare(`
  SELECT au.id, au.user_id, u.username, au.api, au.endpoint, au.cost, au.cached, au.ok, au.status, au.created_at
  FROM api_usage au
  LEFT JOIN users u ON u.id = au.user_id
  ORDER BY au.created_at DESC
  LIMIT ?
`);

export const apiUsage = {
  log: (
    userId: number,
    api: string,
    endpoint: string,
    opts: { cost?: number; cached?: boolean; ok?: boolean; status?: number | null } = {}
  ) => {
    stmtInsertApiUsage.run(
      userId,
      api,
      endpoint,
      opts.cost ?? 1,
      opts.cached ? 1 : 0,
      opts.ok === false ? 0 : 1,
      opts.status ?? null,
      Date.now(),
    );
  },
  /** Aggregated stats since `sinceMs` (epoch). */
  totals:        (sinceMs: number) => stmtUsageTotals.get(sinceMs) as { calls: number; quota_used: number; cache_hits: number; errors: number },
  byApi:         (sinceMs: number) => stmtUsageByApi.all(sinceMs)        as Array<{ api: string; calls: number; quota_used: number; cache_hits: number; errors: number }>,
  byEndpoint:    (sinceMs: number) => stmtUsageByEndpoint.all(sinceMs)   as Array<{ api: string; endpoint: string; calls: number; quota_used: number; cache_hits: number; errors: number }>,
  byUser:        (sinceMs: number) => stmtUsageByUser.all(sinceMs)       as Array<{ id: number; username: string; is_admin: 0 | 1; premium_until: number | null; calls: number; quota_used: number }>,
  daily:         (sinceMs: number) => stmtUsageDaily.all(sinceMs)        as Array<{ day: string; calls: number; quota_used: number }>,
  recent:        (limit = 50)      => stmtUsageRecent.all(Math.min(limit, 500)) as Array<ApiUsageRow & { username: string | null }>,
};
