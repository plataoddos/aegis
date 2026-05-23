/**
 * Seek API proxy (see-know.eu).
 *
 * - All calls go through this module so the API key never reaches the panel.
 * - Responses are cached in SQLite (TTL 24h by default) — re-running the same
 *   query twice in the cache window costs 0 credits.
 * - The remaining credit count returned by the upstream API is tracked here
 *   and exposed to the panel.
 */
import { createHash } from 'node:crypto';
import { seekCache } from './db.js';

const SEEK_BASE_URL  = process.env.SEEK_BASE_URL  || 'https://see-know.eu';
const SEEK_API_KEY   = process.env.SEEK_API_KEY   || '';
const SEEK_CACHE_TTL = parseInt(process.env.SEEK_CACHE_TTL_MS || '86400000', 10); // 24h

let lastKnownCredits: number | null = null;
export function getKnownCredits() { return lastKnownCredits; }

/**
 * Dry-run a call: only checks the cache, never hits the network.
 * Used by the panel preflight to estimate the credit cost of a multi-search.
 */
export function callSeekDryRun(endpoint: string, params: Record<string, any>): {
  cached: boolean;
  fetched_at: number | null;
} {
  const key = makeKey(endpoint, params);
  const cached = seekCache.get(key, SEEK_CACHE_TTL);
  return cached
    ? { cached: true, fetched_at: cached.fetched_at }
    : { cached: false, fetched_at: null };
}

export interface SeekResult {
  ok: boolean;
  cached: boolean;
  /** Endpoint path used upstream (e.g. /api/v1/search) */
  endpoint: string;
  /** Cost in credits according to the catalog (informational). */
  cost: number;
  /** Credits remaining as last reported by upstream. */
  credits_remaining: number | null;
  /** Upstream JSON body. */
  data: any;
  /** Upstream HTTP status. */
  status: number;
  /** Cache timestamp (when the cached body was originally fetched). */
  fetched_at: number;
}

function makeKey(endpoint: string, params: Record<string, any>): string {
  const norm = JSON.stringify(
    Object.entries(params)
      .filter(([_, v]) => v !== undefined && v !== null && v !== '')
      .sort(([a], [b]) => a.localeCompare(b))
  );
  return createHash('sha256').update(`${endpoint}|${norm}`).digest('hex').slice(0, 32);
}

interface CallOpts {
  /** REST method, defaults POST for /search and /stealer, GET otherwise. */
  method?: 'GET' | 'POST';
  /** Force a fresh call (skip cache read). */
  fresh?: boolean;
  /** Body for POST requests. */
  body?: Record<string, any>;
  /** Query params for GET requests. */
  query?: Record<string, any>;
  /** Cost catalog value, just informational. */
  cost?: number;
}

export async function callSeek(endpoint: string, opts: CallOpts = {}): Promise<SeekResult> {
  const params = { ...(opts.query || {}), ...(opts.body || {}) };
  const key = makeKey(endpoint, params);

  // ── Cache hit ─────────────────────────────────────────────────────────────
  if (!opts.fresh) {
    const cached = seekCache.get(key, SEEK_CACHE_TTL);
    if (cached) {
      return {
        ok: true,
        cached: true,
        endpoint,
        cost: opts.cost ?? 0,
        credits_remaining: cached.credits,
        data: JSON.parse(cached.response),
        status: 200,
        fetched_at: cached.fetched_at,
      };
    }
  }

  // ── Live call ─────────────────────────────────────────────────────────────
  if (!SEEK_API_KEY) {
    throw new Error('SEEK_API_KEY non configurée dans backend/.env');
  }

  const method = opts.method || (opts.body ? 'POST' : 'GET');
  let url = `${SEEK_BASE_URL}${endpoint}`;
  if (opts.query && Object.keys(opts.query).length > 0) {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(opts.query)) {
      if (v !== undefined && v !== null && v !== '') qs.append(k, String(v));
    }
    url += '?' + qs.toString();
  }

  const headers: Record<string, string> = {
    'X-API-Key': SEEK_API_KEY,
    'Accept': 'application/json',
    'User-Agent': 'Aegis-Panel/1.0',
  };
  if (method === 'POST') headers['Content-Type'] = 'application/json';

  const res = await fetch(url, {
    method,
    headers,
    body: method === 'POST' ? JSON.stringify(opts.body || {}) : undefined,
  });

  let data: any = null;
  try { data = await res.json(); } catch { data = await res.text().catch(() => null); }

  const credits = (data && typeof data === 'object' && 'credits_remaining' in data)
    ? Number((data as any).credits_remaining) : null;
  if (credits != null && Number.isFinite(credits)) lastKnownCredits = credits;

  // Cache only successful responses (don't cache errors → user can retry without paying twice)
  if (res.ok && data && typeof data === 'object' && (data as any).success !== false) {
    seekCache.set(key, endpoint, params, data, credits);
  }

  return {
    ok: res.ok,
    cached: false,
    endpoint,
    cost: opts.cost ?? 0,
    credits_remaining: credits,
    data,
    status: res.status,
    fetched_at: Date.now(),
  };
}

// ── Endpoint catalog ────────────────────────────────────────────────────────
// Single source of truth for endpoint costs and shapes. Used by api.ts to
// expose the proxy and by the panel for cost hints.
export const SEEK_CATALOG = {
  search:           { path: '/api/v1/search',                 method: 'POST', cost: 1 },
  stealer:          { path: '/api/v1/stealer',                method: 'POST', cost: 2 },
  discord_user:     { path: '/api/v1/discord/user',           method: 'GET',  cost: 1 },
  discord_roblox:   { path: '/api/v1/discord/to-roblox',      method: 'GET',  cost: 1 },
  username_github:  { path: '/api/v1/username/github',        method: 'GET',  cost: 1 },
  username_twitter: { path: '/api/v1/username/twitter',       method: 'GET',  cost: 1 },
  username_tiktok:  { path: '/api/v1/username/tiktok',        method: 'GET',  cost: 1 },
  username_reddit:  { path: '/api/v1/username/reddit',        method: 'GET',  cost: 1 },
  username_social:  { path: '/api/v1/username/social',        method: 'GET',  cost: 1 },
  username_history: { path: '/api/v1/username/history',       method: 'GET',  cost: 1 },
  network_ip:       { path: '/api/v1/network/ip',             method: 'GET',  cost: 1 },
  network_email:    { path: '/api/v1/network/email-check',    method: 'GET',  cost: 1 },
  network_phone:    { path: '/api/v1/network/phone',          method: 'GET',  cost: 1 },
  domain_intel:     { path: '/api/v1/domain/intel',           method: 'GET',  cost: 1 },
  domain_whois:     { path: '/api/v1/domain/whois',           method: 'GET',  cost: 1 },
  gaming_xbox:      { path: '/api/v1/gaming/xbox',            method: 'GET',  cost: 1 },
  gaming_roblox:    { path: '/api/v1/gaming/roblox',          method: 'GET',  cost: 1 },
  gaming_minecraft: { path: '/api/v1/gaming/minecraft',       method: 'GET',  cost: 1 },
} as const;

export type SeekKey = keyof typeof SEEK_CATALOG;
