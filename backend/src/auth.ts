/**
 * Authentication module.
 *
 *  - Password hashing via Node's built-in scrypt (no external dep).
 *  - Opaque bearer sessions stored in SQLite (24 h TTL by default).
 *  - Premium activation : single-use keys grant N days of premium ; while
 *    `users.premium_until > now()`, the user has the premium tier.
 *  - Per-user daily quota for /api/seek/* : 5 calls free, 100 calls premium.
 *
 * Public surface:
 *   - buildAuthRouter()                 → mount on /api/auth
 *   - buildAdminRouter()                → mount on /api/admin (gated)
 *   - requireUser, requireAdmin         → express middlewares
 *   - QUOTA_FREE / QUOTA_PREMIUM        → tier limits (also exposed to clients)
 *   - quotaForUser(user)                → effective daily limit
 *   - generatePremiumKey()              → admin helper
 */
import { Router, type Request, type Response, type NextFunction } from 'express';
import rateLimit from 'express-rate-limit';
import { randomBytes, scryptSync, timingSafeEqual, randomUUID } from 'node:crypto';
import { users, sessions, premiumKeys, dailyUsage, apiUsage, persons, watches, type AuthUser } from './db.js';
import { SEEK_CATALOG, getKnownCredits, getDailyLimit } from './seek.js';

// ─── Quota tiers (shared with the panel via /api/auth/me) ───────────────────
export const QUOTA_FREE    = 5;
export const QUOTA_PREMIUM = 100;
const SESSION_TTL_MS       = 24 * 3600 * 1000; // 24 h

export type SessionUser = Omit<AuthUser, 'password_hash'> & { token: string };

// ─── Password hashing (scrypt + 16-byte salt, 64-byte hash) ─────────────────
function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 64);
  return `${salt.toString('hex')}:${hash.toString('hex')}`;
}

function verifyPassword(password: string, stored: string): boolean {
  const [saltHex, hashHex] = stored.split(':');
  if (!saltHex || !hashHex) return false;
  try {
    const salt = Buffer.from(saltHex, 'hex');
    const hash = Buffer.from(hashHex, 'hex');
    const test = scryptSync(password, salt, 64);
    return hash.length === test.length && timingSafeEqual(hash, test);
  } catch {
    return false;
  }
}

// ─── Premium key helper (formats as `aegis_<24 url-safe chars>`) ────────────
export function generatePremiumKey(): string {
  return 'aegis_' + randomBytes(18).toString('base64url'); // 24 chars after prefix
}

// ─── Effective daily quota for a user ───────────────────────────────────────
export function isPremium(u: { premium_until: number | null }): boolean {
  return !!u.premium_until && u.premium_until > Date.now();
}

export function quotaForUser(u: { premium_until: number | null }): number {
  return isPremium(u) ? QUOTA_PREMIUM : QUOTA_FREE;
}

// ─── Session resolution from Bearer header ──────────────────────────────────
function readBearer(req: Request): string | null {
  const h = req.header('authorization') || '';
  return h.startsWith('Bearer ') ? h.slice(7).trim() : null;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: SessionUser;
    }
  }
}

// Sliding-refresh: every authenticated request bumps the session expiry by at
// most once every minute (cheap DB write; avoids the 23 h-58 mid-flow logout
// without making the bearer token immortal).
const SESSION_REFRESH_THROTTLE_MS = 60 * 1000;
const lastTouchAt = new Map<string, number>();

export function requireUser(req: Request, res: Response, next: NextFunction): void {
  const token = readBearer(req);
  if (!token) { res.status(401).json({ error: 'unauthorized' }); return; }
  const u = sessions.resolve(token);
  if (!u) { res.status(401).json({ error: 'session_expired' }); return; }
  const now  = Date.now();
  const last = lastTouchAt.get(token) || 0;
  if (now - last >= SESSION_REFRESH_THROTTLE_MS) {
    lastTouchAt.set(token, now);
    try { sessions.touch(token, now + SESSION_TTL_MS); } catch {}
  }
  req.user = u;
  next();
}

export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  if (!req.user) { res.status(401).json({ error: 'unauthorized' }); return; }
  if (!req.user.is_admin) { res.status(403).json({ error: 'forbidden' }); return; }
  next();
}

// ─── Username/password validation ───────────────────────────────────────────
// Top-1k weakest passwords. Rejected outright. Kept short to stay readable;
// pair with the entropy/structure rules below for a defense-in-depth check.
const WEAK_PASSWORDS = new Set([
  'password', 'password1', 'password123', 'motdepasse', 'azerty', 'azerty123',
  '123456', '12345678', '123456789', '1234567890', 'qwerty', 'qwerty123',
  'admin', 'admin123', 'administrator', 'root', 'toor', 'letmein', 'welcome',
  'monkey', 'dragon', 'iloveyou', 'sunshine', 'princess', 'football',
  'aegis', 'aegis123', 'aegispanel', 'changeme', 'changeit',
]);

export const PASSWORD_MIN_LENGTH = 10;

/**
 * Returns null if the password meets the policy, otherwise a short FR message.
 * Policy: ≥10 chars, ≤200 chars, at least 3 of {lower, upper, digit, symbol},
 * not in the weak-password blacklist, not equal to (or containing) the username.
 */
function validatePasswordStrength(password: string, username?: string): string | null {
  if (password.length < PASSWORD_MIN_LENGTH) {
    return `Le mot de passe doit contenir au moins ${PASSWORD_MIN_LENGTH} caractères`;
  }
  if (password.length > 200) {
    return 'Le mot de passe est trop long (max 200)';
  }
  const lower  = /[a-z]/.test(password);
  const upper  = /[A-Z]/.test(password);
  const digit  = /\d/.test(password);
  const symbol = /[^A-Za-z0-9]/.test(password);
  const classes = [lower, upper, digit, symbol].filter(Boolean).length;
  if (classes < 3) {
    return 'Mélange minuscules, majuscules, chiffres et symboles (au moins 3 catégories)';
  }
  const lc = password.toLowerCase();
  if (WEAK_PASSWORDS.has(lc)) {
    return 'Ce mot de passe est trop courant — choisis-en un autre';
  }
  if (username && lc.includes(username.toLowerCase())) {
    return 'Le mot de passe ne doit pas contenir le nom d\'utilisateur';
  }
  return null;
}

function validateCredentials(username: any, password: any): string | null {
  if (typeof username !== 'string' || typeof password !== 'string') {
    return 'Identifiants invalides';
  }
  if (!/^[a-zA-Z0-9_.-]{3,32}$/.test(username)) {
    return "Le nom d'utilisateur doit contenir 3 à 32 caractères (lettres, chiffres, _.-)";
  }
  return validatePasswordStrength(password, username);
}

// ─── Rate limiters ──────────────────────────────────────────────────────────
// Anti brute-force on the auth endpoints. The limits target unauthenticated
// attackers (key = IP) ; legitimate users almost never hit them.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,  // 15 min
  limit:    10,              // 10 tries per IP per window
  standardHeaders: 'draft-7',
  legacyHeaders:   false,
  message: { error: 'Trop de tentatives, réessaie dans quelques minutes.' },
});
const signupLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,  // 1 h
  limit:    5,               // 5 signups per IP per hour
  standardHeaders: 'draft-7',
  legacyHeaders:   false,
  message: { error: 'Trop d\'inscriptions depuis cette IP, réessaie plus tard.' },
});
const redeemLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit:    20,              // 20 redeem attempts per IP per 15 min
  standardHeaders: 'draft-7',
  legacyHeaders:   false,
  message: { error: 'Trop d\'essais d\'activation, réessaie plus tard.' },
});

// ─── Routes ─────────────────────────────────────────────────────────────────
export function buildAuthRouter(): Router {
  const r = Router();

  /**
   * Sign up. The first user created is automatically promoted to admin so the
   * operator can bootstrap the instance without poking at the DB.
   */
  r.post('/signup', signupLimiter, (req, res) => {
    const { username, password } = req.body ?? {};
    const err = validateCredentials(username, password);
    if (err) { res.status(400).json({ error: err }); return; }

    const existing = users.byUsername(username);
    if (existing) { res.status(409).json({ error: 'Ce nom est déjà utilisé' }); return; }

    const isFirst = users.count() === 0;
    const u = users.insert(String(username).trim(), hashPassword(password), isFirst);

    const token = randomUUID();
    sessions.insert(token, u.id, Date.now() + SESSION_TTL_MS, req.header('user-agent') || null);
    users.touchLogin(u.id);

    res.json({
      token,
      user: publicUser({ ...u, last_login_at: Date.now() }),
      bootstrap_admin: isFirst,
    });
  });

  r.post('/login', loginLimiter, (req, res) => {
    const { username, password } = req.body ?? {};
    if (typeof username !== 'string' || typeof password !== 'string') {
      res.status(400).json({ error: 'Identifiants invalides' });
      return;
    }
    const u = users.byUsername(username.trim());
    if (!u || !verifyPassword(password, u.password_hash)) {
      res.status(401).json({ error: 'Identifiants invalides' });
      return;
    }
    const token = randomUUID();
    sessions.insert(token, u.id, Date.now() + SESSION_TTL_MS, req.header('user-agent') || null);
    users.touchLogin(u.id);
    res.json({ token, user: publicUser({ ...u, last_login_at: Date.now() }) });
  });

  r.post('/logout', requireUser, (req, res) => {
    sessions.remove(req.user!.token);
    res.json({ ok: true });
  });

  r.get('/me', requireUser, (req, res) => {
    res.json(publicUser(req.user!));
  });

  r.post('/change-password', requireUser, (req, res) => {
    const { current, next } = req.body ?? {};
    if (typeof current !== 'string' || typeof next !== 'string') {
      res.status(400).json({ error: 'Champs manquants' }); return;
    }
    const pwErr = validatePasswordStrength(next, req.user!.username);
    if (pwErr) { res.status(400).json({ error: pwErr }); return; }
    const me = users.byId(req.user!.id);
    if (!me || !verifyPassword(current, me.password_hash)) {
      res.status(401).json({ error: 'Mot de passe actuel incorrect' }); return;
    }
    users.setPassword(me.id, hashPassword(next));
    sessions.removeForUser(me.id); // force re-login on all devices except this one
    sessions.insert(req.user!.token, me.id, Date.now() + SESSION_TTL_MS, req.header('user-agent') || null);
    res.json({ ok: true });
  });

  /**
   * Redeem a premium key. Atomically marks the key as used, then extends the
   * user's `premium_until` (stacks if they already have premium).
   */
  r.post('/redeem', redeemLimiter, requireUser, (req, res) => {
    const { key } = req.body ?? {};
    if (typeof key !== 'string' || !key.trim()) {
      res.status(400).json({ error: 'Clé manquante' }); return;
    }
    const trimmed = key.trim();
    const k = premiumKeys.get(trimmed);
    if (!k)            { res.status(404).json({ error: 'Clé inconnue' }); return; }
    if (k.used_at)     { res.status(409).json({ error: 'Clé déjà utilisée' }); return; }

    const ok = premiumKeys.redeem(trimmed, req.user!.id);
    if (!ok) { res.status(409).json({ error: 'Clé déjà utilisée' }); return; }

    const me  = users.byId(req.user!.id)!;
    const now = Date.now();
    const base = me.premium_until && me.premium_until > now ? me.premium_until : now;
    const newUntil = base + k.days * 86400_000;
    users.setPremiumUntil(me.id, newUntil);

    res.json({
      ok: true,
      days: k.days,
      premium_until: newUntil,
    });
  });

  return r;
}

// ─── Admin routes (premium key management, user listing) ────────────────────
export function buildAdminRouter(): Router {
  const r = Router();
  r.use(requireUser, requireAdmin);

  r.get('/users', (_req, res) => {
    res.json(users.list());
  });

  r.patch('/users/:id', (req, res) => {
    if (!/^\d+$/.test(req.params.id)) { res.status(400).json({ error: 'id invalide' }); return; }
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id) || id <= 0) { res.status(400).json({ error: 'id invalide' }); return; }
    const target = users.byId(id);
    if (!target) { res.status(404).json({ error: 'utilisateur introuvable' }); return; }
    const { is_admin, premium_until } = req.body ?? {};
    if (typeof is_admin === 'boolean') users.setAdmin(id, is_admin);
    if (premium_until === null || typeof premium_until === 'number') users.setPremiumUntil(id, premium_until);
    res.json({ ok: true });
  });

  r.delete('/users/:id', (req, res) => {
    if (!/^\d+$/.test(req.params.id)) { res.status(400).json({ error: 'id invalide' }); return; }
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id) || id <= 0) { res.status(400).json({ error: 'id invalide' }); return; }
    if (id === req.user!.id) { res.status(400).json({ error: 'Impossible de se supprimer soi-même' }); return; }
    if (!users.byId(id))     { res.status(404).json({ error: 'utilisateur introuvable' }); return; }
    try {
      const changes = users.remove(id);
      res.json({ ok: true, deleted: !!changes });
    } catch (e: any) {
      console.error('[admin] delete user failed', { id, err: e?.message });
      res.status(500).json({ error: 'suppression impossible', detail: e?.message || 'unknown' });
    }
  });

  r.get('/keys', (_req, res) => {
    res.json(premiumKeys.list(500));
  });

  r.post('/keys', (req, res) => {
    const days  = parseInt(String(req.body?.days ?? '0'), 10);
    const count = Math.min(parseInt(String(req.body?.count ?? '1'), 10) || 1, 50);
    const note  = typeof req.body?.note === 'string' ? req.body.note.slice(0, 200) : null;
    if (!Number.isFinite(days) || days < 1 || days > 3650) {
      res.status(400).json({ error: 'days invalide (1..3650)' }); return;
    }
    const generated: { key: string; days: number }[] = [];
    for (let i = 0; i < count; i++) {
      const k = generatePremiumKey();
      premiumKeys.insert(k, days, note, req.user!.id);
      generated.push({ key: k, days });
    }
    res.json({ ok: true, keys: generated });
  });

  r.delete('/keys/:key', (req, res) => {
    const changes = premiumKeys.remove(req.params.key);
    if (!changes) { res.status(404).json({ error: 'clé introuvable ou déjà utilisée' }); return; }
    res.json({ ok: true });
  });

  /**
   * Aggregated API consumption stats. Window defaults to 7 days, overridable
   * via ?range=24h|7d|30d|all.
   */
  r.get('/stats', (req, res) => {
    const range = String(req.query.range || '7d');
    const now = Date.now();
    const since =
      range === '24h' ? now - 24 * 3600 * 1000 :
      range === '30d' ? now - 30 * 24 * 3600 * 1000 :
      range === 'all' ? 0 :
                        now - 7  * 24 * 3600 * 1000;

    // Apex BrixHub quota (mirrored from response headers)
    const brix = {
      remaining: getKnownCredits(),
      limit:     getDailyLimit(),
      catalog:   Object.entries(SEEK_CATALOG).map(([key, spec]) => ({
        key, path: spec.path, method: spec.method, cost: spec.cost,
      })),
    };

    res.json({
      range,
      since,
      now,
      totals:     apiUsage.totals(since),
      by_api:     apiUsage.byApi(since),
      by_endpoint: apiUsage.byEndpoint(since),
      by_user:    apiUsage.byUser(since),
      daily:      apiUsage.daily(since),
      recent:     apiUsage.recent(50),
      brixhub:    brix,
      tiers: { free: QUOTA_FREE, premium: QUOTA_PREMIUM },
      content: {
        fiches:  persons.list().length,
        watches: watches.list().length,
        users:   users.list().length,
      },
    });
  });

  return r;
}

// ─── Public-shape user (omits password_hash, adds quota) ────────────────────
export function publicUser(u: SessionUser | (Omit<AuthUser, 'password_hash'> & { token?: string })) {
  const premiumActive = isPremium(u);
  return {
    id:           u.id,
    username:     u.username,
    is_admin:     !!u.is_admin,
    premium:      premiumActive,
    premium_until: premiumActive ? u.premium_until : null,
    created_at:   u.created_at,
    last_login_at: u.last_login_at,
    quota: {
      used:  dailyUsage.today(u.id),
      limit: premiumActive ? QUOTA_PREMIUM : QUOTA_FREE,
      tier:  premiumActive ? 'premium' : 'free',
    },
  };
}
