import { Router, type Request, type Response, type NextFunction } from 'express';
import { watches, events, persons, type PersonInput } from './db.js';
import {
  refreshWatchedIds, listAccounts, fetchProfile, totalGuildCount,
  addToken, removeAccount, setEnabled, setLabel, startAccount, stopAccount, restartAll,
} from './bots.js';
import { callSeek, callSeekDryRun, SEEK_CATALOG, getKnownCredits, type SeekKey } from './seek.js';

export function buildApi(apiToken: string) {
  const r = Router();

  // Auth middleware
  r.use((req: Request, res: Response, next: NextFunction) => {
    const auth = req.header('authorization') || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    if (token !== apiToken) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }
    next();
  });

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
    await removeAccount(parseInt(req.params.id, 10));
    res.json({ ok: true });
  });

  r.patch('/accounts/:id', async (req, res) => {
    const id = parseInt(req.params.id, 10);
    const { enabled, label } = req.body ?? {};
    if (typeof enabled === 'boolean') await setEnabled(id, enabled);
    if (label !== undefined)         await setLabel(id, label ? String(label).slice(0, 80) : null);
    res.json({ ok: true });
  });

  r.post('/accounts/:id/start', async (req, res) => {
    await startAccount(parseInt(req.params.id, 10));
    res.json({ ok: true });
  });

  r.post('/accounts/:id/stop', async (req, res) => {
    await stopAccount(parseInt(req.params.id, 10));
    res.json({ ok: true });
  });

  r.post('/control/restart', async (_req, res) => {
    await restartAll();
    res.json({ ok: true });
  });

  // ── Watches ───────────────────────────────────────────────────────────────
  r.get('/watches', (_req, res) => {
    res.json(watches.list());
  });

  r.post('/watches', async (req, res) => {
    const { user_id, label } = req.body ?? {};
    if (!user_id || !/^\d{15,25}$/.test(String(user_id))) {
      res.status(400).json({ error: 'invalid user_id (must be a Discord snowflake)' });
      return;
    }
    watches.add(String(user_id), label ? String(label).slice(0, 80) : null);
    refreshWatchedIds();
    const profile = await fetchProfile(String(user_id));
    res.json({ ok: true, watch: watches.get(String(user_id)), profile });
  });

  r.delete('/watches/:id', (req, res) => {
    watches.remove(req.params.id);
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

  r.get('/persons', (_req, res) => {
    res.json(persons.list());
  });

  r.get('/persons/:id', (req, res) => {
    const p = persons.get(parseInt(req.params.id, 10));
    if (!p) { res.status(404).json({ error: 'not found' }); return; }
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
      const id = persons.insert(p as PersonInput);
      res.json(persons.get(id));
    } catch (e: any) {
      res.status(400).json({ error: e?.message || 'erreur' });
    }
  });

  r.patch('/persons/:id', (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (!persons.get(id)) { res.status(404).json({ error: 'not found' }); return; }
    const p = sanitizePerson(req.body ?? {});
    persons.update(id, p);
    res.json(persons.get(id));
  });

  r.delete('/persons/:id', (req, res) => {
    persons.remove(parseInt(req.params.id, 10));
    res.json({ ok: true });
  });

  // ── Seek API (see-know.eu proxy) ─────────────────────────────────────────
  // Generic dispatcher: panel calls /api/seek/<key> with JSON body or query.
  // Each call:
  //  - is rate-limited by 24h cache (same input → 0 credit cost)
  //  - keeps the upstream API key on the server side
  //  - returns { cached, credits_remaining, data, cost }
  r.get('/seek/catalog', (_req, res) => {
    res.json({ catalog: SEEK_CATALOG, credits_remaining: getKnownCredits() });
  });

  const handleSeek = async (key: SeekKey, req: Request, res: Response) => {
    const spec = SEEK_CATALOG[key];
    if (!spec) { res.status(404).json({ error: 'unknown endpoint' }); return; }
    const fresh = req.query.fresh === '1' || req.body?.fresh === true;
    try {
      const result = await callSeek(spec.path, {
        method: spec.method,
        cost:   spec.cost,
        fresh,
        body:   spec.method === 'POST' ? req.body : undefined,
        query:  spec.method === 'GET'  ? req.query as any : undefined,
      });
      res.status(result.ok ? 200 : 502).json(result);
    } catch (e: any) {
      res.status(500).json({ error: e?.message || 'seek error' });
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
  r.post('/seek-multi', async (req, res) => {
    const tasks = Array.isArray(req.body?.tasks) ? req.body.tasks : [];
    const fresh = req.body?.fresh === true;
    const results = await Promise.all(tasks.map(async (t: any) => {
      const spec = SEEK_CATALOG[t?.key as SeekKey];
      if (!spec) return { key: t?.key, ok: false, error: 'unknown endpoint' };
      try {
        const result = await callSeek(spec.path, {
          method: spec.method,
          cost:   spec.cost,
          fresh,
          body:   spec.method === 'POST' ? t.params : undefined,
          query:  spec.method === 'GET'  ? t.params : undefined,
        });
        return { key: t.key, params: t.params, ...result };
      } catch (e: any) {
        return { key: t.key, ok: false, error: e?.message || 'error' };
      }
    }));
    res.json({ results, credits_remaining: getKnownCredits() });
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
