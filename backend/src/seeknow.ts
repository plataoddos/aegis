/**
 * SeekNow API client (https://see-know.eu/api/v1)
 *
 * Provider jumeau de BrixHub (`seek.ts`) — même contrat :
 *  - Proxy serveur : la clé `seek-…` ne fuit jamais côté browser.
 *  - Cache SQLite partagé (`seek_cache`) avec TTL 24 h. Les paths SeekNow
 *    (préfixe `/search`, `/stealer`, `/discord/…`, `/username/…`, etc.)
 *    ne collisionnent jamais avec BrixHub (paths différents).
 *  - Headers `X-RateLimit-Remaining` / `X-RateLimit-Limit` lus à chaque
 *    appel pour exposer les crédits restants au panel.
 *
 * Différences upstream :
 *  - Auth : `X-API-Key: seek-<key>` (alternative `Authorization: Bearer …`).
 *  - Coûts par endpoint : la plupart = 1 crédit, `/stealer` = 2.
 *  - Envelope : `{ success: bool, …, credits_remaining }` (pas de
 *    `{ status, message, data, meta }` à la BrixHub).
 */
import { createHash } from 'node:crypto';
import { seekCache } from './db.js';

const SEEKNOW_BASE_URL    = process.env.SEEKNOW_BASE_URL || 'https://see-know.eu/api/v1';
const SEEKNOW_API_KEY     = process.env.SEEKNOW_API_KEY  || '';
const SEEKNOW_CACHE_TTL   = parseInt(process.env.SEEKNOW_CACHE_TTL_MS || '86400000', 10); // 24 h
const SEEKNOW_USER_AGENT  = process.env.SEEKNOW_USER_AGENT || 'Aegis-Panel/1.0';

let lastDailyRemaining: number | null = null;
let lastDailyLimit:     number | null = null;

export function getSeeknowCredits()    { return lastDailyRemaining; }
export function getSeeknowDailyLimit() { return lastDailyLimit;     }

/** Dry-run cache check, no network. */
export function callSeeknowDryRun(endpoint: string, params: Record<string, any>): {
  cached: boolean;
  fetched_at: number | null;
} {
  const key = makeKey(endpoint, params);
  const cached = seekCache.get(key, SEEKNOW_CACHE_TTL);
  return cached
    ? { cached: true, fetched_at: cached.fetched_at }
    : { cached: false, fetched_at: null };
}

export interface SeeknowResult {
  ok: boolean;
  cached: boolean;
  endpoint: string;
  cost: number;
  credits_remaining: number | null;
  daily_limit: number | null;
  /** Upstream JSON ({ success, …, credits_remaining }). */
  data: any;
  status: number;
  fetched_at: number;
  error?: string | null;
}

function makeKey(endpoint: string, params: Record<string, any>): string {
  const norm = JSON.stringify(
    Object.entries(params)
      .filter(([_, v]) => v !== undefined && v !== null && v !== '')
      .sort(([a], [b]) => a.localeCompare(b))
  );
  return createHash('sha256').update(`seeknow|${endpoint}|${norm}`).digest('hex').slice(0, 32);
}

interface CallOpts {
  method?: 'GET' | 'POST';
  fresh?: boolean;
  body?: Record<string, any>;
  query?: Record<string, any>;
  cost?: number;
}

export async function callSeeknow(endpoint: string, opts: CallOpts = {}): Promise<SeeknowResult> {
  const params = { ...(opts.query || {}), ...(opts.body || {}) };
  const key = makeKey(endpoint, params);

  // ── Cache hit ───────────────────────────────────────────────────────────
  if (!opts.fresh) {
    const cached = seekCache.get(key, SEEKNOW_CACHE_TTL);
    if (cached) {
      return {
        ok: true,
        cached: true,
        endpoint,
        cost: opts.cost ?? 0,
        credits_remaining: cached.credits,
        daily_limit: lastDailyLimit,
        data: JSON.parse(cached.response),
        status: 200,
        fetched_at: cached.fetched_at,
      };
    }
  }

  if (!SEEKNOW_API_KEY) {
    throw new Error('SEEKNOW_API_KEY non configurée dans backend/.env');
  }

  const method = opts.method || (opts.body ? 'POST' : 'GET');
  let url = `${SEEKNOW_BASE_URL}${endpoint}`;
  if (opts.query && Object.keys(opts.query).length > 0) {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(opts.query)) {
      if (v !== undefined && v !== null && v !== '') qs.append(k, String(v));
    }
    if (qs.toString()) url += '?' + qs.toString();
  }

  const headers: Record<string, string> = {
    'X-API-Key':  SEEKNOW_API_KEY,
    'Accept':     'application/json',
    'User-Agent': SEEKNOW_USER_AGENT,
  };
  if (method === 'POST') headers['Content-Type'] = 'application/json';

  const res = await fetch(url, {
    method,
    headers,
    body: method === 'POST' ? JSON.stringify(opts.body || {}) : undefined,
  });

  // Rate-limit headers (SeekNow = X-RateLimit-Limit / X-RateLimit-Remaining,
  // sans suffixe -Day contrairement à BrixHub).
  const remHeader = res.headers.get('x-ratelimit-remaining');
  const limHeader = res.headers.get('x-ratelimit-limit');
  const remaining = remHeader != null ? Number(remHeader) : null;
  const limit     = limHeader != null ? Number(limHeader) : null;
  if (remaining != null && Number.isFinite(remaining)) lastDailyRemaining = remaining;
  if (limit     != null && Number.isFinite(limit))     lastDailyLimit     = limit;

  let data: any = null;
  try { data = await res.json(); } catch { data = await res.text().catch(() => null); }

  // SeekNow envelope : `{ success: true, …, credits_remaining }` ou
  // `{ error, message, errorCode? }` en cas d'échec. On considère success
  // ssi HTTP 2xx et `success !== false`.
  const isSuccess =
    res.ok &&
    data &&
    typeof data === 'object' &&
    (data as any).success !== false;

  // Si l'envelope expose `credits_remaining`, on la prend en priorité (les
  // headers ne sont pas toujours présents en cas d'erreur).
  const envelopeCredits =
    data && typeof data === 'object' && typeof (data as any).credits_remaining === 'number'
      ? (data as any).credits_remaining
      : null;
  if (envelopeCredits != null) lastDailyRemaining = envelopeCredits;

  if (isSuccess) {
    seekCache.set(key, endpoint, params, data, lastDailyRemaining);
  } else {
    const safe =
      data && typeof data === 'object'
        ? {
            error:     typeof (data as any).error   === 'string' ? (data as any).error.slice(0, 120) : undefined,
            message:   typeof (data as any).message === 'string' ? (data as any).message.slice(0, 200) : undefined,
            errorCode: (data as any).errorCode,
          }
        : '[non-object response]';
    console.warn(`[seeknow] ${method} ${endpoint} → ${res.status}`, safe);
  }

  const errorMessage = !isSuccess && data && typeof data === 'object'
    ? ((data as any).message || (data as any).error || null)
    : null;

  return {
    ok: res.ok && isSuccess,
    cached: false,
    endpoint,
    cost: opts.cost ?? 0,
    credits_remaining: lastDailyRemaining,
    daily_limit: lastDailyLimit,
    data,
    status: res.status,
    error: errorMessage,
    fetched_at: Date.now(),
  };
}

// ── Endpoint catalog ────────────────────────────────────────────────────────
// Source unique consommée par api.ts (proxy + multi) et le panel (cost hints).
// `paramKeys` = noms des champs attendus dans le body (POST) ou query (GET).
// `cost`      = crédits SeekNow (`/stealer` = 2, le reste = 1, status/credits = 0).
export const SEEKNOW_CATALOG = {
  // Universal Search (POST)
  search:           { path: '/search',                method: 'POST', cost: 1, paramKeys: ['query', 'type', 'limit'] as string[] },
  stealer:          { path: '/stealer',               method: 'POST', cost: 2, paramKeys: ['query', 'limit'] as string[] },

  // Discord
  discord_user:     { path: '/discord/user',          method: 'GET',  cost: 1, paramKeys: ['discord_id'] as string[] },
  discord_roblox:   { path: '/discord/to-roblox',     method: 'GET',  cost: 1, paramKeys: ['discord_id'] as string[] },

  // Username platforms
  username_github:  { path: '/username/github',       method: 'GET',  cost: 1, paramKeys: ['username'] as string[] },
  username_twitter: { path: '/username/twitter',      method: 'GET',  cost: 1, paramKeys: ['username'] as string[] },
  username_tiktok:  { path: '/username/tiktok',       method: 'GET',  cost: 1, paramKeys: ['username'] as string[] },
  username_reddit:  { path: '/username/reddit',       method: 'GET',  cost: 1, paramKeys: ['username'] as string[] },
  username_social:  { path: '/username/social',       method: 'GET',  cost: 1, paramKeys: ['username', 'platforms'] as string[] },
  username_history: { path: '/username/history',      method: 'GET',  cost: 1, paramKeys: ['username'] as string[] },

  // Network
  network_ip:       { path: '/network/ip',            method: 'GET',  cost: 1, paramKeys: ['ip'] as string[] },
  network_email:    { path: '/network/email-check',   method: 'GET',  cost: 1, paramKeys: ['email'] as string[] },
  network_phone:    { path: '/network/phone',         method: 'GET',  cost: 1, paramKeys: ['phone'] as string[] },

  // Domain
  domain_intel:     { path: '/domain/intel',          method: 'GET',  cost: 1, paramKeys: ['domain'] as string[] },
  domain_whois:     { path: '/domain/whois',          method: 'GET',  cost: 1, paramKeys: ['domain'] as string[] },

  // Gaming
  gaming_xbox:      { path: '/gaming/xbox',           method: 'GET',  cost: 1, paramKeys: ['gamertag'] as string[] },
  gaming_roblox:    { path: '/gaming/roblox',         method: 'GET',  cost: 1, paramKeys: ['username', 'user_id'] as string[] },
  gaming_minecraft: { path: '/gaming/minecraft',      method: 'GET',  cost: 1, paramKeys: ['username'] as string[] },

  // Account / status (free)
  credits:          { path: '/credits',               method: 'GET',  cost: 0, paramKeys: [] as string[] },
  status:           { path: '/status',                method: 'GET',  cost: 0, paramKeys: [] as string[] },
} as const;

export type SeeknowKey = keyof typeof SEEKNOW_CATALOG;
