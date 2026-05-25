/**
 * Auth provider — wraps the app, exposes useAuth().
 *
 *   const { user, login, signup, logout, redeem, refresh } = useAuth();
 *
 * `user` is the public-shape user from /api/auth/me (or null if logged out).
 *   - user.quota = { used, limit, tier: 'free' | 'premium' }
 *   - user.is_admin
 *   - user.premium / user.premium_until
 */
import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from 'react';
import { toast } from 'sonner';
import { apiPost, apiGet, setToken, getToken } from './api';

export interface PublicUser {
  id: number;
  username: string;
  is_admin: boolean;
  premium: boolean;
  premium_until: number | null;
  created_at: number;
  last_login_at: number | null;
  quota: { used: number; limit: number; tier: 'free' | 'premium' };
}

interface AuthContextValue {
  user:    PublicUser | null;
  loading: boolean;
  login:   (username: string, password: string) => Promise<PublicUser>;
  signup:  (username: string, password: string) => Promise<PublicUser>;
  logout:  () => Promise<void>;
  redeem:  (key: string) => Promise<{ days: number; premium_until: number }>;
  changePassword: (current: string, next: string) => Promise<void>;
  refresh: () => Promise<PublicUser | null>;
}

const Ctx = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser]       = useState<PublicUser | null>(null);
  const [loading, setLoading] = useState(true);

  /** Re-fetch /api/auth/me from the current session token, if any. */
  const refresh = useCallback(async (): Promise<PublicUser | null> => {
    if (!getToken()) {
      setUser(null);
      return null;
    }
    try {
      const me = await apiGet<PublicUser>('/api/auth/me');
      setUser(me);
      return me;
    } catch {
      setToken(null);
      setUser(null);
      return null;
    }
  }, []);

  // Boot: try to resume a session if a token is in localStorage.
  useEffect(() => {
    refresh().finally(() => setLoading(false));
  }, [refresh]);

  // Listen for 401s coming from any fetch (apiFetch dispatches this event).
  // Only show the "session expirée" toast if the user *was* logged in — avoids
  // the toast spam on the public login screen.
  useEffect(() => {
    const onExpired = () => {
      const wasAuthed = !!getToken();
      setToken(null);
      setUser(null);
      if (wasAuthed) {
        toast.error('Session expirée', {
          description: 'Reconnecte-toi pour continuer.',
          duration: 5000,
        });
      }
    };
    window.addEventListener('aegis:auth-expired', onExpired);
    return () => window.removeEventListener('aegis:auth-expired', onExpired);
  }, []);

  const login = async (username: string, password: string) => {
    const r = await apiPost<{ token: string; user: PublicUser }>('/api/auth/login', { username, password });
    setToken(r.token);
    setUser(r.user);
    return r.user;
  };

  const signup = async (username: string, password: string) => {
    const r = await apiPost<{ token: string; user: PublicUser; bootstrap_admin?: boolean }>(
      '/api/auth/signup', { username, password });
    setToken(r.token);
    setUser(r.user);
    return r.user;
  };

  const logout = async () => {
    try { await apiPost('/api/auth/logout', {}); } catch {}
    setToken(null);
    setUser(null);
  };

  const redeem = async (key: string) => {
    const r = await apiPost<{ ok: true; days: number; premium_until: number }>(
      '/api/auth/redeem', { key });
    await refresh();
    return { days: r.days, premium_until: r.premium_until };
  };

  const changePassword = async (current: string, next: string) => {
    await apiPost('/api/auth/change-password', { current, next });
  };

  return (
    <Ctx.Provider value={{ user, loading, login, signup, logout, redeem, changePassword, refresh }}>
      {children}
    </Ctx.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth must be used within an AuthProvider');
  return v;
}
