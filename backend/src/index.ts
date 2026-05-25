import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import http from 'node:http';
import { loadFromDB } from './bots.js';
import { buildApi } from './api.js';
import { buildAuthRouter, buildAdminRouter } from './auth.js';
import { attachWS } from './ws.js';
import { canaries } from './db.js';

const PORT             = parseInt(process.env.PORT || '8787', 10);
const NODE_ENV         = process.env.NODE_ENV || 'development';
const IS_PROD          = NODE_ENV === 'production';
// Optional WebSocket-only token (legacy). The main HTTP API now uses per-user
// session tokens issued by /api/auth/login (see auth.ts).
const WS_TOKEN         = process.env.WS_TOKEN || process.env.API_TOKEN || '';

// In production, ALLOWED_ORIGINS MUST be explicitly set — refuse to boot
// otherwise so we never accidentally expose CORS to the world.
if (IS_PROD && !process.env.ALLOWED_ORIGINS) {
  console.error('[fatal] ALLOWED_ORIGINS must be set in production.');
  process.exit(1);
}
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || 'http://localhost:5173')
  .split(',').map(s => s.trim()).filter(Boolean);

const app    = express();
const server = http.createServer(app);

// Security headers — sane defaults via helmet. CSP is intentionally not
// applied to the API (the frontend ships its own meta-CSP) ; we only need
// the transport hardening (HSTS, X-CT-O, Referrer-Policy, etc.).
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  crossOriginEmbedderPolicy: false,
}));
// Behind a reverse proxy (nginx, Cloudflare). Required by express-rate-limit
// to read the real client IP from X-Forwarded-For instead of the proxy's IP.
app.set('trust proxy', 1);

app.use(cors({ origin: ALLOWED_ORIGINS, credentials: false }));
app.use(express.json({ limit: '256kb' }));
app.get('/health', (_req, res) => res.json({ ok: true }));

// /api/auth (public: signup/login ; gated: me/logout/redeem/change-password)
app.use('/api/auth',  buildAuthRouter());
// /api/admin (gated by requireUser + requireAdmin)
app.use('/api/admin', buildAdminRouter());
// /api/* — every other endpoint, gated by requireUser
app.use('/api',       buildApi());

// ── Public canary trigger endpoints (no auth, by design) ───────────────────
// 1×1 transparent GIF (43 bytes)
const PIXEL_GIF = Buffer.from(
  'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
  'base64',
);

async function geolocate(ip: string) {
  try {
    const r = await fetch(`https://ipwho.is/${encodeURIComponent(ip)}`);
    const j: any = await r.json();
    if (j.success) return { country: j.country, country_code: j.country_code, city: j.city, org: j.connection?.org || j.connection?.isp };
  } catch {}
  return { country: null, country_code: null, city: null, org: null };
}

function clientIp(req: express.Request): string {
  const xf = req.headers['x-forwarded-for'];
  if (typeof xf === 'string' && xf) return xf.split(',')[0].trim();
  return (req.socket?.remoteAddress || '').replace(/^::ffff:/, '');
}

async function recordCanaryHit(req: express.Request, id: string) {
  const tok = canaries.get(id);
  if (!tok || !tok.enabled) return null;
  const ip = clientIp(req);
  const ua = String(req.headers['user-agent'] || '').slice(0, 500);
  const ref = String(req.headers['referer'] || req.headers['referrer'] || '').slice(0, 500);
  const geo = ip ? await geolocate(ip) : { country: null, country_code: null, city: null, org: null };
  canaries.recordHit(id, {
    ip: ip || null, user_agent: ua || null, referer: ref || null,
    method: req.method, path: req.originalUrl,
    country: geo.country, country_code: geo.country_code, city: geo.city, org: geo.org,
  });
  return tok;
}

// 1×1 transparent pixel (for embedding in emails/HTML)
app.get('/h/:id.gif', async (req, res) => {
  await recordCanaryHit(req, req.params.id);
  res.set({
    'Content-Type':  'image/gif',
    'Content-Length': String(PIXEL_GIF.length),
    'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
    'Pragma':        'no-cache',
  });
  res.end(PIXEL_GIF);
});

// Catch-all trigger (URL token / redirect token)
app.all('/h/:id', async (req, res) => {
  const tok = await recordCanaryHit(req, req.params.id);
  if (tok?.type === 'redirect' && tok.redirect_url) {
    res.redirect(302, tok.redirect_url);
    return;
  }
  // Plain 200 for URL canaries, or 404-looking response to be discreet
  res.status(200).type('text/plain').send('OK');
});

attachWS(server, WS_TOKEN);

server.listen(PORT, () => {
  console.log(`[netx-watcher] listening on http://localhost:${PORT}`);
  console.log(`[netx-watcher] WebSocket ws://localhost:${PORT}/ws?token=...`);
});

await loadFromDB();
