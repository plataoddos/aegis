# Aegis — Indexage & Schéma API

## 1. Stack

- Runtime : Node.js ≥ 20, TypeScript, ESM.
- HTTP : Express 4 + Helmet + CORS allow-list + `express.json({ limit:'256kb' })` + `trust proxy = 1`.
- Persistence : SQLite via `better-sqlite3`, `journal_mode = WAL`, fichier `backend/data.sqlite`.
- WebSocket : `ws` (`noServer`), upgrade sur `/ws?token=<sessionToken>`.
- Auth : scrypt (`crypto.scryptSync`, N=16384/r=8/p=1, salt 16 B, key 64 B), sessions bearer opaques (32 B `randomBytes` hex), rolling refresh.
- Crypto secrets at-rest : AES-256-GCM (`secretCrypto.ts`), master key via `MASTER_KEY` env ou `.master_key` local.
- Rate-limit : `express-rate-limit` sur `/login`, `/signup`, `/redeem`.
- Cache OSINT : table `seek_cache`, TTL `BRIX_CACHE_TTL_MS` (default 86 400 000 ms).
- Quota : `daily_usage(user_id, date UTC)`, free=5/j, premium=100/j.

## 2. Schéma SQLite

### 2.1 Auth

```sql
users (
  id              INTEGER PK AUTOINCREMENT,
  username        TEXT UNIQUE COLLATE NOCASE,
  password_hash   TEXT,                       -- scrypt: salt$hash (hex)
  is_admin        INTEGER DEFAULT 0,
  premium_until   INTEGER NULL,               -- ms epoch
  created_at      INTEGER,
  last_login_at   INTEGER NULL
)
INDEX idx_users_username (username)

auth_sessions (
  token       TEXT PK,                        -- 32 B hex
  user_id     INTEGER FK→users.id ON DELETE CASCADE,
  created_at  INTEGER,
  expires_at  INTEGER,
  user_agent  TEXT NULL
)
INDEX idx_sessions_user, idx_sessions_expires

premium_keys (
  key         TEXT PK,                        -- format aegis_<base32>
  days        INTEGER,
  note        TEXT NULL,
  created_by  INTEGER FK→users.id NULL,
  created_at  INTEGER,
  used_by     INTEGER FK→users.id NULL,
  used_at     INTEGER NULL
)
INDEX idx_premium_keys_used (used_by, used_at)
PARTIAL INDEX idx_premium_keys_unused (used_at) WHERE used_at IS NULL

daily_usage (
  user_id  INTEGER FK→users.id ON DELETE CASCADE,
  date     TEXT,                              -- YYYY-MM-DD UTC
  count    INTEGER DEFAULT 0,
  PK (user_id, date)
)

api_usage (
  id          INTEGER PK AUTOINCREMENT,
  user_id     INTEGER FK→users.id ON DELETE CASCADE,
  api         TEXT,                           -- 'brixhub' | 'ip-lookup' | …
  endpoint    TEXT,                           -- 'search' | 'lookup_email' | …
  cost        INTEGER DEFAULT 1,
  cached      INTEGER DEFAULT 0,
  ok          INTEGER DEFAULT 1,
  status      INTEGER NULL,
  created_at  INTEGER
)
INDEX idx_api_usage_user (user_id, created_at DESC)
INDEX idx_api_usage_api_ep (api, endpoint, created_at DESC)
INDEX idx_api_usage_created (created_at DESC)
```

### 2.2 Discord watcher

```sql
watches (
  user_id    TEXT PK,                         -- Discord snowflake (15-25 digits)
  label      TEXT NULL,
  added_at   INTEGER,
  created_by TEXT NULL                        -- Aegis user.id (string)
)
INDEX idx_watches_created_by

events (
  id           INTEGER PK AUTOINCREMENT,
  user_id      TEXT,                          -- Discord snowflake
  type         TEXT,                          -- 'message' | 'guild_join' | …
  guild_id     TEXT NULL,
  guild_name   TEXT NULL,
  channel_id   TEXT NULL,
  channel_name TEXT NULL,
  content      TEXT NULL,
  extra_json   TEXT NULL,
  created_at   INTEGER
)
INDEX idx_events_user_created (user_id, created_at DESC)
INDEX idx_events_created (created_at DESC)

tokens (                                      -- Discord selfbot tokens (encrypted)
  id       INTEGER PK AUTOINCREMENT,
  label    TEXT NULL,
  token    TEXT UNIQUE,                       -- AES-256-GCM payload (v1$iv$tag$ct)
  enabled  INTEGER DEFAULT 1,
  added_at INTEGER
)
```

### 2.3 Fiches

```sql
persons (
  id              INTEGER PK AUTOINCREMENT,
  nom             TEXT NOT NULL,
  prenom          TEXT NOT NULL,
  genre           TEXT NULL,
  date_naissance  TEXT NOT NULL,              -- YYYY-MM-DD
  adresse         TEXT NULL,
  complement      TEXT NULL,
  code_postal     TEXT NULL,
  ville           TEXT NULL,
  allocataire     TEXT NULL,
  matricule       TEXT NULL,
  email_alloc     TEXT NULL,
  tel_alloc       TEXT NULL,
  iban            TEXT NULL,
  bic             TEXT NULL,
  categorie       TEXT NULL,
  ext_id          TEXT NULL,
  notes           TEXT NULL,
  created_by      TEXT NULL,                  -- Aegis user.id (string)
  created_at      INTEGER,
  updated_at      INTEGER
)
INDEX idx_persons_nom (nom, prenom)
INDEX idx_persons_ville (ville)
INDEX idx_persons_created_by
```

### 2.4 Cache OSINT

```sql
seek_cache (
  cache_key   TEXT PK,                        -- sha256(endpoint|sortedParams)[0..32]
  endpoint    TEXT,
  params_json TEXT NULL,
  response    TEXT,                           -- JSON envelope BrixHub
  credits     INTEGER NULL,
  fetched_at  INTEGER
)
INDEX idx_seek_cache_fetched (fetched_at DESC)
```

### 2.5 Canaries / honeytokens

```sql
canary_tokens (
  id           TEXT PK,                       -- short random
  label        TEXT,
  type         TEXT,                          -- 'url' | 'pixel' | 'redirect'
  note         TEXT NULL,
  redirect_url TEXT NULL,
  enabled      INTEGER DEFAULT 1,
  created_by   TEXT NULL,
  created_at   INTEGER,
  last_hit_at  INTEGER NULL,
  hit_count    INTEGER DEFAULT 0
)

canary_events (
  id           INTEGER PK AUTOINCREMENT,
  token_id     TEXT FK→canary_tokens.id ON DELETE CASCADE,
  ip, user_agent, referer, method, path,
  country, country_code, city, org           TEXT NULL,
  created_at   INTEGER
)
INDEX idx_canary_events_token (token_id, created_at DESC)
INDEX idx_canary_tokens_user  (created_by, created_at DESC)
```

## 3. Indexage / stratégies

- **Cache OSINT** : clé = `sha256(endpoint || JSON.stringify(sortParams(filterEmpty(params))))[0..32]`. Lecture : `WHERE cache_key=? AND fetched_at>now-TTL`. Écriture uniquement si `res.ok && envelope.status∈{200,undefined}`. Hits cache → coût quota = 0.
- **Quota journalier** : `INSERT … ON CONFLICT(user_id,date) DO UPDATE SET count=count+1`. Reset implicite : nouvelle ligne par jour UTC.
- **Stats admin** : agrégations sur `api_usage` filtrées par `created_at >= sinceMs`, groupées par `api` / `(api,endpoint)` / `user_id` / `date(created_at/1000,'unixepoch')`.
- **Sessions** : sweep périodique (`setInterval 1 h`) `DELETE FROM auth_sessions WHERE expires_at<=now`. Sliding refresh : `UPDATE … SET expires_at=now+TTL WHERE token=?` si reste < 50 % TTL.
- **User cascade delete** : transaction `removeUserTx(id)` exécutée sans FK ON, séquence : sessions → daily_usage → api_usage → null FK premium_keys.{created_by,used_by} → persons → events liés aux watches → watches → users.
- **Tokens Discord** : décryptés à la lecture, ré-encryption transparente au premier read si payload legacy plaintext détecté (`isEncrypted()` false).

## 4. Schéma API HTTP

Base URL : `http(s)://<host>:<port>`
Auth : `Authorization: Bearer <session-token>` sauf endpoints publics.
Réponses erreur : `{ "error": string }` avec status 4xx/5xx ; succès JSON arbitraire.

### 4.1 Public

```
GET    /health                     → { ok:true }
GET    /h/:id.gif                  → 1×1 GIF, enregistre canary hit
GET    /h/:id                      → JSON pixel meta
GET    /h/:id/r                    → 302 redirect canary
```

### 4.2 `/api/auth` (rate-limited)

```
POST   /api/auth/signup            { username, password }                        → { token, user }
       limiter: 5 req / 15 min / IP
POST   /api/auth/login             { username, password }                        → { token, user }
       limiter: 10 req / 15 min / IP
POST   /api/auth/logout            (Bearer)                                       → { ok }
GET    /api/auth/me                (Bearer)                                       → user
POST   /api/auth/change-password   (Bearer) { current, next }                    → { ok }
POST   /api/auth/redeem            (Bearer) { key }                              → { ok, premium_until }
       limiter: 10 req / 1 h / IP
```

Politique mot de passe : `len ≥ 10`, ≥ 3 classes parmi {lower, upper, digit, symbol}, blacklist mots faibles, ≠ username.

`user` (publicUser) :
```ts
{ id, username, is_admin: 0|1, premium_until: number|null, created_at, last_login_at }
```

### 4.3 `/api/admin` (Bearer + is_admin=1)

```
GET    /api/admin/users                                                          → AuthUser[]
PATCH  /api/admin/users/:id        { is_admin?, premium_until? }                 → { ok }
DELETE /api/admin/users/:id                                                      → { ok }
GET    /api/admin/keys                                                           → PremiumKey[]
POST   /api/admin/keys             { days:int, count?:int≤50, note?:string }     → { ok, keys:string[] }
DELETE /api/admin/keys/:key                                                      → { ok }
GET    /api/admin/stats?range=24h|7d|30d|all                                     → {
         range, since, totals, byApi[], byEndpoint[], byUser[], daily[], recent[]
       }
```

### 4.4 `/api/*` (Bearer)

#### Status / accounts (Discord watcher)

```
GET    /api/status                                                               → { accounts, watching, totalGuilds }
GET    /api/accounts                                                             → TokenRow[]
POST   /api/accounts                { token:string≥30, label?:string }          → { ok, id }
DELETE /api/accounts/:id                                                         → { ok }
PATCH  /api/accounts/:id            { enabled?:bool, label?:string }            → { ok }
POST   /api/accounts/:id/start                                                   → { ok }
POST   /api/accounts/:id/stop                                                    → { ok }
POST   /api/control/restart                                                      → { ok }
```

#### Watches (scoped user, admin = global)

```
GET    /api/watches                                                              → Watch[]
POST   /api/watches                 { user_id:/^\d{15,25}$/, label? }           → { ok, watch, profile }
DELETE /api/watches/:id                                                          → { ok }
GET    /api/watches/:id/profile                                                  → DiscordProfile
```

#### Persons / fiches

```
GET    /api/persons                                                              → Person[]
GET    /api/persons/:id                                                          → Person
POST   /api/persons                 PersonInput (nom, prenom, date_naissance req)→ Person
PATCH  /api/persons/:id             Partial<PersonInput>                         → Person
DELETE /api/persons/:id                                                          → { ok }
```

`POST /persons` déclenche un webhook Discord (`discordWebhook.ts`) hors-ligne du chemin critique.

#### OSINT proxy — BrixHub

```
GET    /api/seek/catalog                                                         → {
         catalog: SEEK_CATALOG, credits_remaining, daily_limit
       }
GET    /api/seek/:key               (?fresh=1) query → params                    → SeekResult
POST   /api/seek/:key               body → params                                → SeekResult
POST   /api/seek-preflight          { tasks:[{key,params}] }                     → { tasks:[{key,valid,cached,fetched_at}] }
POST   /api/seek-multi              { tasks:[{key,params}], fresh?:bool }        → {
         results:SeekResult[], credits_remaining, daily_limit,
         user_quota:{ used, limit, tier:'free'|'premium' }
       }
GET    /api/ip-lookup/:ip           IPv4|IPv6                                    → { ok, data } | 502
```

#### OSINT proxy — SeekNow

```
GET    /api/seeknow/catalog                                                      → {
         catalog: SEEKNOW_CATALOG, credits_remaining, daily_limit
       }
GET    /api/seeknow/:key            query → params (whitelistés via paramKeys)   → SeeknowResult
POST   /api/seeknow/:key            body  → params                               → SeeknowResult
POST   /api/seeknow-preflight       { tasks:[{key,params}] }                     → { tasks:[{key,valid,cached,fetched_at,cost}] }
POST   /api/seeknow-multi           { tasks:[{key,params}], fresh?:bool }        → {
         results:SeeknowResult[], credits_remaining, daily_limit, user_quota
       }
```

`SEEKNOW_CATALOG` (`seeknow.ts`) — coût 1 crédit sauf mention contraire :

```
search           POST /search                cost=1   { query, type?, limit? }
stealer          POST /stealer               cost=2   { query, limit? }
discord_user     GET  /discord/user          cost=1   { discord_id }
discord_roblox   GET  /discord/to-roblox     cost=1   { discord_id }
username_github  GET  /username/github       cost=1   { username }
username_twitter GET  /username/twitter      cost=1   { username }
username_tiktok  GET  /username/tiktok       cost=1   { username }
username_reddit  GET  /username/reddit       cost=1   { username }
username_social  GET  /username/social       cost=1   { username, platforms? }
username_history GET  /username/history      cost=1   { username }
network_ip       GET  /network/ip            cost=1   { ip }
network_email    GET  /network/email-check   cost=1   { email }
network_phone    GET  /network/phone         cost=1   { phone }
domain_intel     GET  /domain/intel          cost=1   { domain }
domain_whois     GET  /domain/whois          cost=1   { domain }
gaming_xbox      GET  /gaming/xbox           cost=1   { gamertag }
gaming_roblox    GET  /gaming/roblox         cost=1   { username | user_id }
gaming_minecraft GET  /gaming/minecraft      cost=1   { username }
credits          GET  /credits               cost=0   {}
status           GET  /status                cost=0   {}
```

`SeeknowResult` (mêmes champs que `SeekResult`, mais `data` = enveloppe SeekNow `{ success, …, credits_remaining }` ou `{ error, message, errorCode? }`).

Auth upstream : `X-API-Key: seek-…` (alternative `Authorization: Bearer seek-…`). Headers de quota lus : `X-RateLimit-Limit`, `X-RateLimit-Remaining` ; sinon fallback sur `data.credits_remaining`. Cache key préfixée `seeknow|<path>|<sortedParams>` pour ne pas collisionner avec BrixHub.

`SEEK_CATALOG` (source de vérité, `seek.ts`) :

```ts
{
  search:        { path:'/search',                method:'POST', cost:1, pathParams:[]        },
  lookup_email:  { path:'/lookup/email/{email}',  method:'GET',  cost:1, pathParams:['email'] },
  lookup_phone:  { path:'/lookup/phone/{phone}',  method:'GET',  cost:1, pathParams:['phone'] },
  lookup_iban:   { path:'/lookup/iban/{iban}',    method:'GET',  cost:1, pathParams:['iban']  },
  me:            { path:'/me',                    method:'GET',  cost:0, pathParams:[]        },
  usage:         { path:'/usage',                 method:'GET',  cost:0, pathParams:[]        },
  health:        { path:'/health',                method:'GET',  cost:0, pathParams:[]        },
}
```

`SeekResult` :
```ts
{
  ok:boolean, cached:boolean, endpoint:string, cost:number,
  credits_remaining:number|null, daily_limit:number|null,
  data:any /* envelope BrixHub { status, message, data, meta } */,
  status:number, fetched_at:number, error?:string|null
}
```

Pipeline `/seek-multi` :
1. `SEEK_CATALOG[t.key]` → `spec`.
2. Split `params` ↔ `pathParams` selon `spec.pathParams`.
3. `callSeekDryRun(spec.path, allParams)` ; si `!cached && used >= limit` → `{ ok:false, status:429 }`.
4. `callSeek(spec.path, { method, cost, fresh, body|query, pathParams })`.
5. Si `cost>0 && !cached` → `dailyUsage.bump(userId)` ; `used++`.
6. `apiUsage.log(userId, 'brixhub', t.key, { cost, cached, ok, status })`.
7. Agrège → `Promise.all` → réponse + `user_quota`.

#### Canaries

```
GET    /api/canaries                                                             → CanaryToken[]
POST   /api/canaries                { label, type:'url'|'pixel'|'redirect',
                                       note?, redirect_url? }                   → CanaryToken
GET    /api/canaries/:id                                                         → CanaryToken
PATCH  /api/canaries/:id            { label?, note?, enabled?, redirect_url? } → CanaryToken
DELETE /api/canaries/:id                                                         → { ok }
GET    /api/canaries/:id/events     ?limit≤500                                   → CanaryEvent[]
GET    /api/canary-events           ?limit≤500                                   → (CanaryEvent & {token_label})[]
```

#### Events

```
GET    /api/events                  ?user_id=&type=&limit≤1000                   → Event[]
```

### 4.5 WebSocket

```
GET    /ws?token=<session-token>     Upgrade: websocket
       Frames serveur: { type:'event', event:Event } | { type:'status', … }
       Auth: token validé via sessions.resolve() avant handleUpgrade.
```

## 5. Validation / parsing

- `parseId(s)` : `/^\d+$/` + `parseInt` + `>0` ; sinon 400.
- Discord snowflake : `/^\d{15,25}$/`.
- IP : `isValidIp(ip)` (IPv4 dotted-quad 0-255 / IPv6 RFC strict).
- IBAN/SIRET/SIREN/NIR : passés tels quels en path-param URL-encodés vers BrixHub.
- Body limit : 256 KB.
- Username : trim, 3-32 chars `[A-Za-z0-9_.-]`, COLLATE NOCASE unique.

## 6. Codes d'état

```
200  OK
400  payload invalide / id invalide / quota params
401  session absente/expirée (event panel: 'aegis:auth-expired')
403  requireAdmin échoue
404  ressource introuvable
409  username déjà pris / clé déjà utilisée
429  rate-limit IP OU quota journalier user dépassé
500  erreur serveur (logs scrubbed)
502  tous providers IP-lookup KO
```

## 7. Variables d'environnement

```
PORT                 default 8787
ALLOWED_ORIGINS      CSV obligatoire en NODE_ENV=production
MASTER_KEY           hex 32 B (AES-256-GCM) — sinon .master_key local
BRIX_API_KEY         X-API-Key BrixHub
BRIX_BASE_URL        default https://brixhub.net/api/v1
BRIX_CACHE_TTL_MS    default 86400000
BRIX_USER_AGENT      default Aegis-Panel/1.0
SEEKNOW_API_KEY      X-API-Key SeekNow (`seek-…`)
SEEKNOW_BASE_URL     default https://see-know.eu/api/v1
SEEKNOW_CACHE_TTL_MS default 86400000
SEEKNOW_USER_AGENT   default Aegis-Panel/1.0
SESSION_TTL_MS       default 7 j
DISCORD_WEBHOOK_URL  notifications création fiche
```
