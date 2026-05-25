/**
 * BrixHub API client (https://brixhub.net/api/v1)
 *
 * - All upstream calls are proxied through this module so the API key never
 *   reaches the browser.
 * - Responses are cached in SQLite (TTL 24 h by default) — re-running the same
 *   query inside the cache window is free (no quota consumed).
 * - The remaining daily quota reported via the `X-RateLimit-Remaining-Day`
 *   response header is tracked and exposed to the panel.
 *
 * The exported names keep the historical "Seek" prefix to minimise churn in
 * the rest of the codebase. The implementation now talks to BrixHub.
 */
import { createHash } from 'node:crypto';
import { seekCache } from './db.js';

const BRIX_BASE_URL =
  process.env.BRIX_BASE_URL || process.env.SEEK_BASE_URL || 'https://brixhub.net/api/v1';
const BRIX_API_KEY  =
  process.env.BRIX_API_KEY  || process.env.SEEK_API_KEY  || '';
const BRIX_CACHE_TTL =
  parseInt(process.env.BRIX_CACHE_TTL_MS || process.env.SEEK_CACHE_TTL_MS || '86400000', 10); // 24 h
const BRIX_USER_AGENT = process.env.BRIX_USER_AGENT || 'Aegis-Panel/1.0';

let lastDailyRemaining: number | null = null;
let lastDailyLimit:     number | null = null;

export function getKnownCredits()   { return lastDailyRemaining; }
export function getDailyLimit()     { return lastDailyLimit;     }

/**
 * Dry-run: only checks the cache, never hits the network. Used by the panel
 * preflight to estimate the cost (free vs paid) of a multi-search.
 */
export function callSeekDryRun(endpoint: string, params: Record<string, any>): {
  cached: boolean;
  fetched_at: number | null;
} {
  const key = makeKey(endpoint, params);
  const cached = seekCache.get(key, BRIX_CACHE_TTL);
  return cached
    ? { cached: true, fetched_at: cached.fetched_at }
    : { cached: false, fetched_at: null };
}

export interface SeekResult {
  ok: boolean;
  cached: boolean;
  /** Endpoint path used upstream (e.g. /api/v1/search) */
  endpoint: string;
  /** Cost in quota units (informational, BrixHub uses 1 req = 1 unit). */
  cost: number;
  /** Daily quota remaining as last reported by upstream. */
  credits_remaining: number | null;
  /** Total daily quota for the API key. */
  daily_limit: number | null;
  /** Upstream JSON body (BrixHub envelope: status/message/data/meta). */
  data: any;
  /** Upstream HTTP status. */
  status: number;
  /** Cache timestamp (when the cached body was originally fetched). */
  fetched_at: number;
  /** Human-readable upstream error message, when ok=false. */
  error?: string | null;
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
  /** REST method, defaults to POST when a body is provided, otherwise GET. */
  method?: 'GET' | 'POST';
  /** Force a fresh call (skip cache read). */
  fresh?: boolean;
  /** Body for POST requests. */
  body?: Record<string, any>;
  /** Query params for GET requests. */
  query?: Record<string, any>;
  /** Catalog cost (informational). */
  cost?: number;
  /** Path-param substitution: { email: 'foo@bar' } replaces `{email}` in the path. */
  pathParams?: Record<string, string>;
}

export async function callSeek(endpoint: string, opts: CallOpts = {}): Promise<SeekResult> {
  // Substitute :param / {param} placeholders in path before caching key calc
  let resolvedPath = endpoint;
  if (opts.pathParams) {
    for (const [k, v] of Object.entries(opts.pathParams)) {
      resolvedPath = resolvedPath.replace(`{${k}}`, encodeURIComponent(v));
    }
  }

  const params = { ...(opts.query || {}), ...(opts.body || {}), ...(opts.pathParams || {}) };
  const key = makeKey(resolvedPath, params);

  // ── Cache hit ─────────────────────────────────────────────────────────────
  if (!opts.fresh) {
    const cached = seekCache.get(key, BRIX_CACHE_TTL);
    if (cached) {
      return {
        ok: true,
        cached: true,
        endpoint: resolvedPath,
        cost: opts.cost ?? 0,
        credits_remaining: cached.credits,
        daily_limit: lastDailyLimit,
        data: JSON.parse(cached.response),
        status: 200,
        fetched_at: cached.fetched_at,
      };
    }
  }

  // ── Live call ─────────────────────────────────────────────────────────────
  if (!BRIX_API_KEY) {
    throw new Error('BRIX_API_KEY non configurée dans backend/.env');
  }

  const method = opts.method || (opts.body ? 'POST' : 'GET');
  let url = `${BRIX_BASE_URL}${resolvedPath}`;
  if (opts.query && Object.keys(opts.query).length > 0) {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(opts.query)) {
      if (v !== undefined && v !== null && v !== '') qs.append(k, String(v));
    }
    if (qs.toString()) url += '?' + qs.toString();
  }

  const headers: Record<string, string> = {
    'X-API-Key':  BRIX_API_KEY,
    'Accept':     'application/json',
    'User-Agent': BRIX_USER_AGENT,
  };
  if (method === 'POST') headers['Content-Type'] = 'application/json';

  const res = await fetch(url, {
    method,
    headers,
    body: method === 'POST' ? JSON.stringify(opts.body || {}) : undefined,
  });

  // Update quota counters from response headers
  const remHeader = res.headers.get('x-ratelimit-remaining-day');
  const limHeader = res.headers.get('x-ratelimit-limit-day');
  const remaining = remHeader != null ? Number(remHeader) : null;
  const limit     = limHeader != null ? Number(limHeader) : null;
  if (remaining != null && Number.isFinite(remaining)) lastDailyRemaining = remaining;
  if (limit     != null && Number.isFinite(limit))     lastDailyLimit     = limit;

  let data: any = null;
  try { data = await res.json(); } catch { data = await res.text().catch(() => null); }

  // Cache only successful responses (avoid burning quota twice on errors).
  // BrixHub envelope: { status: 200, message: 'ok', data: {...}, meta: {...} }
  const isSuccess =
    res.ok &&
    data &&
    typeof data === 'object' &&
    (data.status === 200 || data.status === undefined);
  if (isSuccess) {
    seekCache.set(key, resolvedPath, params, data, lastDailyRemaining);
  } else {
    // Log upstream errors so they're easy to diagnose, but scrub obvious PII.
    // We only keep the error envelope's status/message — never the data blob,
    // which can carry emails, phone numbers, NIR/IBAN, etc.
    const safe =
      data && typeof data === 'object'
        ? {
            status:  (data as any).status,
            message: typeof (data as any).message === 'string'
              ? (data as any).message.slice(0, 200) : undefined,
            error_type: (data as any).error?.type,
          }
        : '[non-object response]';
    console.warn(`[brixhub] ${method} ${resolvedPath} → ${res.status}`, safe);
  }

  // Extract human-readable error message from the BrixHub envelope when present.
  const errorMessage = !isSuccess && data && typeof data === 'object'
    ? (data.error?.message || data.error?.type || data.message || null)
    : null;

  return {
    ok: res.ok && isSuccess,
    cached: false,
    endpoint: resolvedPath,
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
// Single source of truth — used by api.ts to expose the proxy and by the
// panel for cost hints. BrixHub charges 1 quota unit per call (no per-endpoint
// pricing differences; `cost` is informational only).
export const SEEK_CATALOG = {
  // Universal multi-criteria search.
  search:       { path: '/search',                  method: 'POST', cost: 1, pathParams: [] as string[] },

  // Reverse lookups (single-identifier → profile).
  lookup_email: { path: '/lookup/email/{email}',    method: 'GET',  cost: 1, pathParams: ['email'] as string[] },
  lookup_phone: { path: '/lookup/phone/{phone}',    method: 'GET',  cost: 1, pathParams: ['phone'] as string[] },
  lookup_iban:  { path: '/lookup/iban/{iban}',      method: 'GET',  cost: 1, pathParams: ['iban']  as string[] },

  // Account / health (free).
  me:           { path: '/me',                      method: 'GET',  cost: 0, pathParams: [] as string[] },
  usage:        { path: '/usage',                   method: 'GET',  cost: 0, pathParams: [] as string[] },
  health:       { path: '/health',                  method: 'GET',  cost: 0, pathParams: [] as string[] },
} as const;

export type SeekKey = keyof typeof SEEK_CATALOG;
