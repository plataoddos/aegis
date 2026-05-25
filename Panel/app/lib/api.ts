/**
 * Shared HTTP client for the panel.
 *
 * The session token is stored in `localStorage['aegis_session']` after a
 * successful login (see useAuth). Every request transparently attaches it as
 * a Bearer token. Components that historically read `VITE_WATCHER_API_TOKEN`
 * should be migrated to use this module so they pick up per-user sessions.
 */

export const API_URL =
  ((import.meta as any).env?.VITE_WATCHER_API_URL as string) || 'http://localhost:8787';

const TOKEN_KEY = 'aegis_session';

export function getToken(): string {
  try { return localStorage.getItem(TOKEN_KEY) || ''; }
  catch { return ''; }
}

export function setToken(token: string | null) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {}
}

export class ApiError extends Error {
  status: number;
  body: any;
  constructor(status: number, body: any, message: string) {
    super(message);
    this.status = status;
    this.body   = body;
  }
}

async function parseError(res: Response, fallback: string): Promise<string> {
  try {
    const j: any = await res.json();
    return j?.error
      || j?.message
      || j?.data?.error?.message
      || j?.data?.message
      || fallback;
  } catch {
    return fallback;
  }
}

/**
 * Low-level fetch wrapper that auto-injects auth and parses JSON errors.
 * Dispatches an `aegis:auth-expired` window event on 401 so the AuthProvider
 * can clear local state and redirect to login.
 */
export async function apiFetch<T = any>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const token = getToken();
  const headers = new Headers(init.headers || {});
  if (token) headers.set('Authorization', `Bearer ${token}`);
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');

  const res = await fetch(API_URL + path, { ...init, headers });
  if (res.status === 401) {
    // Token revoked / expired — let the AuthProvider handle logout.
    window.dispatchEvent(new CustomEvent('aegis:auth-expired'));
  }

  if (!res.ok) {
    const msg = await parseError(res, `HTTP ${res.status}`);
    let body: any = null;
    try { body = await res.clone().json(); } catch {}
    throw new ApiError(res.status, body, msg);
  }
  // Treat empty 204 responses gracefully.
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const apiGet  = <T = any>(p: string) => apiFetch<T>(p);
export const apiPost = <T = any>(p: string, body?: any) =>
  apiFetch<T>(p, { method: 'POST', body: body != null ? JSON.stringify(body) : undefined });
export const apiPatch = <T = any>(p: string, body?: any) =>
  apiFetch<T>(p, { method: 'PATCH', body: body != null ? JSON.stringify(body) : undefined });
export const apiDelete = <T = any>(p: string) =>
  apiFetch<T>(p, { method: 'DELETE' });
