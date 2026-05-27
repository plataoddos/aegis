import { Router, type Request, type Response } from 'express';
import { watches, events, persons, canaries, dailyUsage, apiUsage, users, type PersonInput } from './db.js';
import crypto from 'node:crypto';
import {
  refreshWatchedIds, listAccounts, fetchProfile, totalGuildCount,
  addToken, removeAccount, setEnabled, setLabel, startAccount, stopAccount, restartAll,
} from './bots.js';
import { callSeek, callSeekDryRun, SEEK_CATALOG, getKnownCredits, getDailyLimit, type SeekKey } from './seek.js';
import {
  callSeeknow, callSeeknowDryRun, SEEKNOW_CATALOG,
  getSeeknowCredits, getSeeknowDailyLimit, type SeeknowKey,
} from './seeknow.js';
import { notifyPersonCreated } from './discordWebhook.js';
import { requireUser, isPremium, quotaForUser } from './auth.js';

/**
 * Builds the per-user API router (mounted at /api).
 *
 * Auth: every endpoint here is gated by `requireUser`, which resolves the
 * Bearer session token issued by /api/auth/login. The legacy single-token
 * `API_TOKEN` model is gone — admins are tracked via the `is_admin` flag on
 * the user row instead.
 */
/**
 * Strictly parses a positive integer ID from a route param. Returns NaN for
 * anything else ("42abc", "-1", "0", "«xyz»…), so callers can short-circuit
 * with a 400. Avoids parseInt's permissive coercion.
 */
function parseId(raw: string): number {
  if (!/^\d+$/.test(raw)) return NaN;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 && n < Number.MAX_SAFE_INTEGER ? n : NaN;
}

export function buildApi() {
  const r = Router();

  // All endpoints below require an authenticated user session.
  r.use(requireUser);

  // ── Status ────────────────────────────────────────────────────────────────
  r.get('/status', (_req, res) => {
    const accounts = listAccounts();
    res.json({
      accounts,
      ready_accounts: accounts.filter(a => a.status === 'ready').length,
      total_accounts: accounts.length,
      total_guilds:   totalGuildCount(),
      watched:        watches.list().length,
    });
  });

  // ── Token / accounts management ──────────────────────────────────────────
  r.get('/accounts', (_req, res) => {
    res.json(listAccounts());
  });

  r.post('/accounts', async (req, res) => {
    const { token, label } = req.body ?? {};
    if (!token || typeof token !== 'string' || token.length < 30) {
      res.status(400).json({ error: 'token invalide' });
      return;
    }
    try {
      const id = await addToken(label ? String(label).slice(0, 80) : null, token.trim());
      res.json({ ok: true, id });
    } catch (e: any) {
      res.status(400).json({ error: e?.message || 'erreur' });
    }
  });

  r.delete('/accounts/:id', async (req, res) => {
    const id = parseId(req.params.id);
    if (!id) { res.status(400).json({ error: 'id invalide' }); return; }
    await removeAccount(id);
    res.json({ ok: true });
  });

  r.patch('/accounts/:id', async (req, res) => {
    const id = parseId(req.params.id);
    if (!id) { res.status(400).json({ error: 'id invalide' }); return; }
    const { enabled, label } = req.body ?? {};
    if (typeof enabled === 'boolean') await setEnabled(id, enabled);
    if (label !== undefined)         await setLabel(id, label ? String(label).slice(0, 80) : null);
    res.json({ ok: true });
  });

  r.post('/accounts/:id/start', async (req, res) => {
    const id = parseId(req.params.id);
    if (!id) { res.status(400).json({ error: 'id invalide' }); return; }
    await startAccount(id);
    res.json({ ok: true });
  });

  r.post('/accounts/:id/stop', async (req, res) => {
    const id = parseId(req.params.id);
    if (!id) { res.status(400).json({ error: 'id invalide' }); return; }
    await stopAccount(id);
    res.json({ ok: true });
  });

  r.post('/control/restart', async (_req, res) => {
    await restartAll();
    res.json({ ok: true });
  });

  // ── Watches (scoped per user; admin sees everything) ─────────────────────
  r.get('/watches', (req, res) => {
    const me = req.user!;
    res.json(me.is_admin ? watches.list() : watches.listByUser(String(me.id)));
  });

  r.post('/watches', async (req, res) => {
    const { user_id, label } = req.body ?? {};
    if (!user_id || !/^\d{15,25}$/.test(String(user_id))) {
      res.status(400).json({ error: 'invalid user_id (must be a Discord snowflake)' });
      return;
    }
    const me = req.user!;
    // If the watch already exists for someone else, reject (avoids cross-user takeover).
    const existing = watches.get(String(user_id));
    if (existing && existing.created_by && existing.created_by !== String(me.id) && !me.is_admin) {
      res.status(409).json({ error: 'Cet utilisateur est déjà surveillé par un autre compte' });
      return;
    }
    watches.add(String(user_id), label ? String(label).slice(0, 80) : null, String(me.id));
    refreshWatchedIds();
    const profile = await fetchProfile(String(user_id));
    res.json({ ok: true, watch: watches.get(String(user_id)), profile });
  });

  r.delete('/watches/:id', (req, res) => {
    const me = req.user!;
    if (me.is_admin) {
      watches.remove(req.params.id);
    } else {
      const removed = watches.removeIfOwned(req.params.id, String(me.id));
      if (!removed) { res.status(404).json({ error: 'not found' }); return; }
    }
    refreshWatchedIds();
    res.json({ ok: true });
  });

  r.get('/watches/:id/profile', async (req, res) => {
    const profile = await fetchProfile(req.params.id);
    if (!profile) {
      res.status(404).json({ error: 'profile not found' });
      return;
    }
    res.json(profile);
  });

  // ── Persons (fiches) ─────────────────────────────────────────────────────
  const sanitizePerson = (body: any): Partial<PersonInput> => {
    const out: any = {};
    const fields = [
      'nom', 'prenom', 'genre', 'date_naissance',
      'adresse', 'complement', 'code_postal', 'ville',
      'allocataire', 'matricule', 'email_alloc', 'tel_alloc',
      'iban', 'bic', 'categorie', 'ext_id', 'notes',
    ];
    for (const f of fields) {
      if (f in body) {
        const v = body[f];
        out[f] = v === '' || v == null ? null : String(v).slice(0, 2000);
      }
    }
    return out;
  };

  // Helper: returns true iff the caller may access (read/edit/delete) the row.
  const ownsPerson = (id: number, req: Request): boolean => {
    const me = req.user!;
    if (me.is_admin) return true;
    const owner = persons.ownerOf(id);
    // Legacy rows with no owner are visible to admins only (via is_admin above).
    return owner != null && owner === String(me.id);
  };

  r.get('/persons', (req, res) => {
    const me = req.user!;
    res.json(me.is_admin ? persons.list() : persons.listByUser(me.id));
  });

  r.get('/persons/:id', (req, res) => {
    const id = parseId(req.params.id);
    if (!id) { res.status(400).json({ error: 'id invalide' }); return; }
    const p = persons.get(id);
    if (!p) { res.status(404).json({ error: 'not found' }); return; }
    if (!ownsPerson(id, req)) { res.status(403).json({ error: 'forbidden' }); return; }
    res.json(p);
  });

  r.post('/persons', (req, res) => {
    const body = req.body ?? {};
    const p = sanitizePerson(body);
    if (!p.nom || !p.prenom || !p.date_naissance) {
      res.status(400).json({ error: 'nom, prenom, date_naissance requis' });
      return;
    }
    try {
      const id = persons.insert(p as PersonInput, req.user!.id);
      const created = persons.get(id);
      if (created) notifyPersonCreated(created); // fire-and-forget Discord webhook
      res.json(created);
    } catch (e: any) {
      res.status(400).json({ error: e?.message || 'erreur' });
    }
  });

  r.patch('/persons/:id', (req, res) => {
    const id = parseId(req.params.id);
    if (!id) { res.status(400).json({ error: 'id invalide' }); return; }
    if (!persons.get(id)) { res.status(404).json({ error: 'not found' }); return; }
    if (!ownsPerson(id, req)) { res.status(403).json({ error: 'forbidden' }); return; }
    const p = sanitizePerson(req.body ?? {});
    persons.update(id, p);
    res.json(persons.get(id));
  });

  r.delete('/persons/:id', (req, res) => {
    const id = parseId(req.params.id);
    if (!id) { res.status(400).json({ error: 'id invalide' }); return; }
    if (!persons.get(id)) { res.status(404).json({ error: 'not found' }); return; }
    if (!ownsPerson(id, req)) { res.status(403).json({ error: 'forbidden' }); return; }
    persons.remove(id);
    res.json({ ok: true });
  });

  // ── BrixHub API proxy (https://brixhub.net/api/v1) ───────────────────────
  // Generic dispatcher: panel calls /api/seek/<key> with JSON body or query.
  // Each call:
  //  - is short-circuited by a 24h cache (same input → 0 quota cost)
  //  - keeps the BrixHub API key (X-API-Key) on the server side
  //  - returns { cached, credits_remaining, daily_limit, data, cost }
  // Routes are still mounted under /seek/* for backward compatibility.
  r.get('/seek/catalog', (_req, res) => {
    res.json({
      catalog:           SEEK_CATALOG,
      credits_remaining: getKnownCredits(), // = daily_remaining (BrixHub)
      daily_limit:       getDailyLimit(),
    });
  });

  const handleSeek = async (key: SeekKey, req: Request, res: Response) => {
    const spec = SEEK_CATALOG[key];
    if (!spec) { res.status(404).json({ error: 'unknown endpoint' }); return; }
    const fresh = req.query.fresh === '1' || req.body?.fresh === true;

    // ── Per-user daily quota gate ──────────────────────────────────────────
    // Free-tier users get 5 calls/day, premium users get 100. Cache hits do
    // NOT consume quota (we only bump the counter when callSeek actually
    // hit upstream). Free endpoints (cost=0: me/usage/health) are also
    // exempt from the quota.
    const me  = users.byId(req.user!.id)!;
    const limit = quotaForUser(me);
    const used  = dailyUsage.today(me.id);
    if (spec.cost > 0 && used >= limit) {
      res.status(429).json({
        error: `Quota journalier atteint (${used}/${limit} requêtes).`,
        quota: { used, limit, tier: isPremium(me) ? 'premium' : 'free' },
      });
      return;
    }

    // Extract path params from body/query when the endpoint declares them
    // (e.g. /api/v1/lookup/email/{email}).
    const pathParams: Record<string, string> = {};
    const remainingBody:  Record<string, any> = { ...(req.body  || {}) };
    const remainingQuery: Record<string, any> = { ...(req.query || {}) };
    for (const p of spec.pathParams) {
      const v = remainingBody[p] ?? remainingQuery[p];
      if (v == null || v === '') {
        res.status(400).json({ error: `paramètre requis manquant: ${p}` });
        return;
      }
      pathParams[p] = String(v);
      delete remainingBody[p];
      delete remainingQuery[p];
    }

    try {
      const result = await callSeek(spec.path, {
        method:     spec.method,
        cost:       spec.cost,
        fresh,
        body:       spec.method === 'POST' ? remainingBody  : undefined,
        query:      spec.method === 'GET'  ? remainingQuery : undefined,
        pathParams,
      });
      // Only count cache misses against the user's daily quota.
      if (spec.cost > 0 && !result.cached) {
        dailyUsage.bump(me.id);
      }
      apiUsage.log(me.id, 'brixhub', key, {
        cost:   spec.cost,
        cached: result.cached,
        ok:     result.ok,
        status: result.status,
      });
      res.status(result.ok ? 200 : 502).json({
        ...result,
        // Surface user quota alongside upstream BrixHub credits so the panel
        // can show both.
        user_quota: {
          used:  dailyUsage.today(me.id),
          limit,
          tier:  isPremium(me) ? 'premium' : 'free',
        },
      });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || 'brixhub error' });
    }
  };

  // Single dispatch route. Method = GET or POST depending on the endpoint, the
  // panel just hits POST /api/seek/<key> for POST endpoints and GET otherwise.
  r.get('/seek/:key',  (req, res) => handleSeek(req.params.key as SeekKey, req, res));
  r.post('/seek/:key', (req, res) => handleSeek(req.params.key as SeekKey, req, res));

  // ── Preflight: which tasks would hit the cache (free) vs live (paid) ──────
  // Used by the multi-field "Recherche personne" form to display the real
  // credit cost before the user commits.
  r.post('/seek-preflight', async (req, res) => {
    const tasks = Array.isArray(req.body?.tasks) ? req.body.tasks : [];
    const out = tasks.map((t: any) => {
      const spec = SEEK_CATALOG[t?.key as SeekKey];
      if (!spec) return { key: t?.key, valid: false, cached: false };
      try {
        const r = callSeekDryRun(spec.path, t?.params || {});
        return { key: t.key, valid: true, cached: r.cached, fetched_at: r.fetched_at, cost: spec.cost };
      } catch {
        return { key: t.key, valid: false, cached: false };
      }
    });
    res.json({ tasks: out });
  });

  // ── Multi-call: run several seek tasks in parallel (with cache) ──────────
  // Quota gate: each non-cached, costly call counts against the user's daily
  // limit. Cached or zero-cost endpoints don't.
  r.post('/seek-multi', async (req, res) => {
    const tasks = Array.isArray(req.body?.tasks) ? req.body.tasks : [];
    const fresh = req.body?.fresh === true;
    const me    = users.byId(req.user!.id)!;
    const limit = quotaForUser(me);
    let used    = dailyUsage.today(me.id);

    const results = await Promise.all(tasks.map(async (t: any) => {
      const spec = SEEK_CATALOG[t?.key as SeekKey];
      if (!spec) return { key: t?.key, ok: false, error: 'unknown endpoint' };
      try {
        const params: Record<string, any> = { ...(t.params || {}) };
        const pathParams: Record<string, string> = {};
        for (const p of spec.pathParams) {
          if (params[p] != null && params[p] !== '') {
            pathParams[p] = String(params[p]);
            delete params[p];
          }
        }
        // Pre-check the cache; if a live call would push us over the limit,
        // refuse without burning quota.
        if (spec.cost > 0) {
          const dry = callSeekDryRun(spec.path, { ...params, ...pathParams });
          if (!dry.cached && used >= limit) {
            return { key: t.key, ok: false, status: 429, error: `Quota journalier atteint (${used}/${limit})` };
          }
        }
        const result = await callSeek(spec.path, {
          method: spec.method,
          cost:   spec.cost,
          fresh,
          body:   spec.method === 'POST' ? params : undefined,
          query:  spec.method === 'GET'  ? params : undefined,
          pathParams,
        });
        if (spec.cost > 0 && !result.cached) {
          dailyUsage.bump(me.id);
          used += 1;
        }
        apiUsage.log(me.id, 'brixhub', t.key, {
          cost:   spec.cost,
          cached: result.cached,
          ok:     result.ok,
          status: result.status,
        });
        return { key: t.key, params: t.params, ...result };
      } catch (e: any) {
        return { key: t.key, ok: false, error: e?.message || 'error' };
      }
    }));
    res.json({
      results,
      credits_remaining: getKnownCredits(),
      daily_limit:       getDailyLimit(),
      user_quota: {
        used,
        limit,
        tier: isPremium(me) ? 'premium' : 'free',
      },
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  //  SeekNow proxy (https://see-know.eu/api/v1)
  //  Provider parallèle à BrixHub. Mêmes garanties (cache, quota user,
  //  audit, scrubbing) — seul l'upstream et le catalogue changent.
  // ─────────────────────────────────────────────────────────────────────────
  r.get('/seeknow/catalog', (_req, res) => {
    res.json({
      catalog:           SEEKNOW_CATALOG,
      credits_remaining: getSeeknowCredits(),
      daily_limit:       getSeeknowDailyLimit(),
    });
  });

  const handleSeeknow = async (key: SeeknowKey, req: Request, res: Response) => {
    const spec = SEEKNOW_CATALOG[key];
    if (!spec) { res.status(404).json({ error: 'unknown endpoint' }); return; }
    const fresh = req.query.fresh === '1' || req.body?.fresh === true;

    const me    = users.byId(req.user!.id)!;
    const limit = quotaForUser(me);
    const used  = dailyUsage.today(me.id);
    if (spec.cost > 0 && used >= limit) {
      res.status(429).json({
        error: `Quota journalier atteint (${used}/${limit} requêtes).`,
        quota: { used, limit, tier: isPremium(me) ? 'premium' : 'free' },
      });
      return;
    }

    // Whitelist params (le catalogue déclare les clés acceptées) — évite
    // qu'on relaie n'importe quoi à l'upstream.
    const src: Record<string, any> = { ...(req.query || {}), ...(req.body || {}) };
    const params: Record<string, any> = {};
    for (const k of spec.paramKeys) {
      if (src[k] != null && src[k] !== '') params[k] = src[k];
    }

    try {
      const result = await callSeeknow(spec.path, {
        method: spec.method,
        cost:   spec.cost,
        fresh,
        body:   spec.method === 'POST' ? params : undefined,
        query:  spec.method === 'GET'  ? params : undefined,
      });
      if (spec.cost > 0 && !result.cached) {
        dailyUsage.bump(me.id);
      }
      apiUsage.log(me.id, 'seeknow', key, {
        cost:   spec.cost,
        cached: result.cached,
        ok:     result.ok,
        status: result.status,
      });
      res.status(result.ok ? 200 : 502).json({
        ...result,
        user_quota: {
          used:  dailyUsage.today(me.id),
          limit,
          tier:  isPremium(me) ? 'premium' : 'free',
        },
      });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || 'seeknow error' });
    }
  };

  r.get('/seeknow/:key',  (req, res) => handleSeeknow(req.params.key as SeeknowKey, req, res));
  r.post('/seeknow/:key', (req, res) => handleSeeknow(req.params.key as SeeknowKey, req, res));

  // Preflight & multi pour SeekNow (même contrat que /seek-preflight et /seek-multi).
  r.post('/seeknow-preflight', async (req, res) => {
    const tasks = Array.isArray(req.body?.tasks) ? req.body.tasks : [];
    const out = tasks.map((t: any) => {
      const spec = SEEKNOW_CATALOG[t?.key as SeeknowKey];
      if (!spec) return { key: t?.key, valid: false, cached: false };
      try {
        const r = callSeeknowDryRun(spec.path, t?.params || {});
        return { key: t.key, valid: true, cached: r.cached, fetched_at: r.fetched_at, cost: spec.cost };
      } catch {
        return { key: t.key, valid: false, cached: false };
      }
    });
    res.json({ tasks: out });
  });

  r.post('/seeknow-multi', async (req, res) => {
    const tasks = Array.isArray(req.body?.tasks) ? req.body.tasks : [];
    const fresh = req.body?.fresh === true;
    const me    = users.byId(req.user!.id)!;
    const limit = quotaForUser(me);
    let used    = dailyUsage.today(me.id);

    const results = await Promise.all(tasks.map(async (t: any) => {
      const spec = SEEKNOW_CATALOG[t?.key as SeeknowKey];
      if (!spec) return { key: t?.key, ok: false, error: 'unknown endpoint' };
      try {
        const src: Record<string, any> = t.params || {};
        const params: Record<string, any> = {};
        for (const k of spec.paramKeys) {
          if (src[k] != null && src[k] !== '') params[k] = src[k];
        }
        if (spec.cost > 0) {
          const dry = callSeeknowDryRun(spec.path, params);
          if (!dry.cached && used >= limit) {
            return { key: t.key, ok: false, status: 429, error: `Quota journalier atteint (${used}/${limit})` };
          }
        }
        const result = await callSeeknow(spec.path, {
          method: spec.method,
          cost:   spec.cost,
          fresh,
          body:   spec.method === 'POST' ? params : undefined,
          query:  spec.method === 'GET'  ? params : undefined,
        });
        if (spec.cost > 0 && !result.cached) {
          dailyUsage.bump(me.id);
          used += 1;
        }
        apiUsage.log(me.id, 'seeknow', t.key, {
          cost:   spec.cost,
          cached: result.cached,
          ok:     result.ok,
          status: result.status,
        });
        return { key: t.key, params: t.params, ...result };
      } catch (e: any) {
        return { key: t.key, ok: false, error: e?.message || 'error' };
      }
    }));

    res.json({
      results,
      credits_remaining: getSeeknowCredits(),
      daily_limit:       getSeeknowDailyLimit(),
      user_quota: {
        used,
        limit,
        tier: isPremium(me) ? 'premium' : 'free',
      },
    });
  });

  // ── IP Lookup (proxied, fallback chain) ──────────────────────────────────
  // Free providers, no API key required:
  //   1. ipwho.is        — primary (rich payload, generous)
  //   2. ipapi.co        — fallback (covers ipwho.is downtime)
  // Result is always normalized to the same envelope so the UI doesn't care.
  // Strict IPv4 + RFC 4291 IPv6 (incl. mixed `::ffff:1.2.3.4`). Rejects nonsense
  // like `:::` or `a:::b` early so we don't proxy garbage to upstream lookups.
  const IPV4_RX = /^(25[0-5]|2[0-4]\d|[01]?\d?\d)(\.(25[0-5]|2[0-4]\d|[01]?\d?\d)){3}$/;
  const IPV6_RX = /^(([0-9a-f]{1,4}:){7}[0-9a-f]{1,4}|([0-9a-f]{1,4}:){1,7}:|([0-9a-f]{1,4}:){1,6}:[0-9a-f]{1,4}|([0-9a-f]{1,4}:){1,5}(:[0-9a-f]{1,4}){1,2}|([0-9a-f]{1,4}:){1,4}(:[0-9a-f]{1,4}){1,3}|([0-9a-f]{1,4}:){1,3}(:[0-9a-f]{1,4}){1,4}|([0-9a-f]{1,4}:){1,2}(:[0-9a-f]{1,4}){1,5}|[0-9a-f]{1,4}:(:[0-9a-f]{1,4}){1,6}|:((:[0-9a-f]{1,4}){1,7}|:)|::ffff(:0{1,4})?:(25[0-5]|2[0-4]\d|[01]?\d?\d)(\.(25[0-5]|2[0-4]\d|[01]?\d?\d)){3})$/i;
  const isValidIp = (s: string): boolean => IPV4_RX.test(s) || IPV6_RX.test(s);

  async function ipwhois(ip: string) {
    const r = await fetch(`https://ipwho.is/${encodeURIComponent(ip)}`, {
      headers: { 'User-Agent': 'Aegis-Panel/1.0' },
    });
    const j: any = await r.json();
    if (!j.success) throw new Error(j.message || 'ipwho.is failed');
    return {
      provider: 'ipwho.is',
      ip:           j.ip,
      type:         j.type,
      city:         j.city,
      region:       j.region,
      country:      j.country,
      country_code: j.country_code,
      continent:    j.continent,
      latitude:     j.latitude,
      longitude:    j.longitude,
      postal:       j.postal,
      flag_emoji:   j.flag?.emoji,
      asn:          j.connection?.asn,
      org:          j.connection?.org,
      isp:          j.connection?.isp,
      domain:       j.connection?.domain,
      timezone:     j.timezone?.id,
      utc_offset:   j.timezone?.utc,
      local_time:   j.timezone?.current_time,
      calling_code: j.calling_code,
      capital:      j.capital,
    };
  }

  async function ipapico(ip: string) {
    const r = await fetch(`https://ipapi.co/${encodeURIComponent(ip)}/json/`, {
      headers: { 'User-Agent': 'Aegis-Panel/1.0' },
    });
    const j: any = await r.json();
    if (j.error) throw new Error(j.reason || 'ipapi.co failed');
    return {
      provider: 'ipapi.co',
      ip:           j.ip,
      type:         j.version === 6 ? 'IPv6' : 'IPv4',
      city:         j.city,
      region:       j.region,
      country:      j.country_name,
      country_code: j.country_code,
      continent:    j.continent_code,
      latitude:     j.latitude,
      longitude:    j.longitude,
      postal:       j.postal,
      flag_emoji:   undefined as string | undefined,
      asn:          j.asn ? Number(String(j.asn).replace(/^AS/i, '')) : undefined,
      org:          j.org,
      isp:          j.org,
      domain:       undefined as string | undefined,
      timezone:     j.timezone,
      utc_offset:   j.utc_offset,
      local_time:   undefined as string | undefined,
      calling_code: j.country_calling_code ? String(j.country_calling_code).replace(/^\+/, '') : undefined,
      capital:      j.country_capital,
    };
  }

  r.get('/ip-lookup/:ip', async (req, res) => {
    const ip = String(req.params.ip).trim();
    if (!isValidIp(ip)) { res.status(400).json({ error: 'IP invalide (IPv4 ou IPv6 attendue)' }); return; }
    const errors: string[] = [];
    for (const fn of [ipwhois, ipapico]) {
      try {
        const data = await fn(ip);
        apiUsage.log(req.user!.id, 'ip-lookup', fn.name, { cost: 0, ok: true, status: 200 });
        res.json({ ok: true, data });
        return;
      } catch (e: any) {
        errors.push(`${fn.name}: ${e?.message || 'fail'}`);
      }
    }
    apiUsage.log(req.user!.id, 'ip-lookup', 'all', { cost: 0, ok: false, status: 502 });
    res.status(502).json({ ok: false, error: 'Tous les providers IP ont échoué', detail: errors });
  });

  // ── Canaries / Honeytokens (authenticated CRUD) ──────────────────────────
  r.get('/canaries', (_req, res) => {
    res.json(canaries.list());
  });

  r.post('/canaries', (req, res) => {
    const { label, type, note, redirect_url } = req.body ?? {};
    if (!label || typeof label !== 'string') {
      res.status(400).json({ error: 'label requis' });
      return;
    }
    const t = (type || 'url') as 'url' | 'pixel' | 'redirect';
    if (!['url', 'pixel', 'redirect'].includes(t)) {
      res.status(400).json({ error: 'type invalide (url|pixel|redirect)' });
      return;
    }
    if (t === 'redirect' && !redirect_url) {
      res.status(400).json({ error: 'redirect_url requis pour le type redirect' });
      return;
    }
    const id = crypto.randomBytes(8).toString('hex');
    const created = canaries.insert({
      id,
      label: String(label).slice(0, 120),
      type: t,
      note: note ? String(note).slice(0, 500) : null,
      redirect_url: redirect_url ? String(redirect_url).slice(0, 500) : null,
      created_by: null,
    });
    res.json(created);
  });

  r.get('/canaries/:id', (req, res) => {
    const c = canaries.get(req.params.id);
    if (!c) { res.status(404).json({ error: 'not found' }); return; }
    res.json(c);
  });

  r.patch('/canaries/:id', (req, res) => {
    if (!canaries.get(req.params.id)) { res.status(404).json({ error: 'not found' }); return; }
    canaries.update(req.params.id, req.body ?? {});
    res.json(canaries.get(req.params.id));
  });

  r.delete('/canaries/:id', (req, res) => {
    canaries.remove(req.params.id);
    res.json({ ok: true });
  });

  r.get('/canaries/:id/events', (req, res) => {
    if (!canaries.get(req.params.id)) { res.status(404).json({ error: 'not found' }); return; }
    const limit = req.query.limit ? parseInt(String(req.query.limit), 10) : 100;
    res.json(canaries.events(req.params.id, limit));
  });

  r.get('/canary-events', (req, res) => {
    const limit = req.query.limit ? parseInt(String(req.query.limit), 10) : 50;
    res.json(canaries.recentEvents(null, limit));
  });

  // ── Events ────────────────────────────────────────────────────────────────
  r.get('/events', (req, res) => {
    const userId = req.query.user_id ? String(req.query.user_id) : undefined;
    const type   = req.query.type    ? String(req.query.type)    : undefined;
    const limit  = req.query.limit   ? parseInt(String(req.query.limit), 10) : 200;
    res.json(events.list({ userId, type, limit }));
  });

  return r;
}
