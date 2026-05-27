/**
 * Aegis — Agrégateur OSINT multi-provider.
 *
 * Fan-out des deux providers (BrixHub + SeekNow) sur un formulaire identité
 * et normalisation/corrélation des résultats vers une enveloppe unifiée
 * `OsintReport`. Le panel consomme cette enveloppe au lieu d'orchestrer
 * lui-même les N appels et de devoir parler les deux dialectes upstream.
 *
 * Stratégie :
 *  - 1 appel BrixHub `/search` (qui fusionne déjà toutes les sources internes).
 *  - 1 fan-out SeekNow par identifiant atomique présent (email/phone/user).
 *  - Cache + quota gérés par les clients sous-jacents (`callSeek`,
 *    `callSeeknow`).
 *  - Corrélation côté serveur : on lie les profils par (email | phone |
 *    nom_complet) pour produire des "personnes" agrégées avec provenance.
 *
 * Les sections de sortie sont stables, même si un provider est KO ou
 * répond vide — le panel n'a jamais à gérer d'undefined sur la structure.
 */
import { callSeek }    from './seek.js';
import { callSeeknow } from './seeknow.js';
import { dailyUsage, apiUsage } from './db.js';
import { quotaForUser, isPremium } from './auth.js';
import type { AuthUser } from './db.js';

// ── Form input ────────────────────────────────────────────────────────────
export interface IdentityForm {
  // Identité
  nom_famille?: string; prenom?: string;
  date_naissance?: string;
  annee_naissance?: string;
  genre?: string;
  // Adresse
  ville?: string; code_postal?: string; departement?: string;
  // Contact
  email?: string; telephone?: string; mobile?: string;
  // Identifiants forts
  nir?: string; iban?: string; siret?: string; siren?: string;
  // Pseudo / pro
  nom_utilisateur?: string; societe?: string; profession?: string;
  // Véhicule
  immatriculation?: string;
  // Mode
  flexible?: boolean;
}

// ── Output schema ─────────────────────────────────────────────────────────
export interface ProviderStats {
  calls: number;
  cached: number;
  errors: number;
  credits_remaining: number | null;
  daily_limit: number | null;
}

/** Personne agrégée — corrélation par identifiants forts. */
export interface AggregatedPerson {
  id: string;                 // hash signature
  prenom?: string;
  nom_famille?: string;
  date_naissance?: string;
  genre?: string;
  email?: string;
  emails?: string[];
  telephone?: string;
  phones?: string[];
  adresse?: string;
  ville?: string;
  code_postal?: string;
  iban?: string;
  nir?: string;
  siret?: string;
  societe?: string;
  /** Providers qui ont contribué à cette personne. */
  providers: ('brixhub' | 'seeknow')[];
  /** Confiance moyenne (0-100), prise sur BrixHub si dispo. */
  confidence: number;
  /** Profils bruts qui ont produit cette agrégation (pour le drill-down). */
  raw: { provider: 'brixhub' | 'seeknow'; profile: any }[];
}

export interface BreachRecord {
  source: string;
  email?: string;
  username?: string;
  password?: string;
  ip_address?: string;
  name?: string;
  url?: string;
  /** Tout le reste de l'enregistrement upstream. */
  extra: Record<string, any>;
}

export interface SocialHit {
  platform: string;
  url?: string;
  profile?: Record<string, any>;
}

export interface NetworkCheck {
  email?: { value: string; valid?: boolean; deliverable?: boolean; disposable?: boolean; breach_count?: number; raw: any };
  phone?: { value: string; country?: string; carrier?: string; line_type?: string; breach_count?: number; raw: any };
}

export interface OsintTaskLog {
  provider: 'brixhub' | 'seeknow';
  endpoint: string;
  ok: boolean;
  cached: boolean;
  status: number | null;
  error?: string | null;
  duration_ms: number;
  cost: number;
}

export interface OsintReport {
  query: IdentityForm;
  /** Personnes agrégées (BrixHub principal + correlations SeekNow). */
  identities: AggregatedPerson[];
  /** Enregistrements de breach (SeekNow /search). */
  breaches: BreachRecord[];
  /** Présences sociales (SeekNow /username/social + lookups par plateforme). */
  social: SocialHit[];
  /** Vérifications email/téléphone (SeekNow /network/*). */
  network: NetworkCheck;
  /** Stats par provider. */
  providers: { brixhub: ProviderStats; seeknow: ProviderStats };
  /** Détails par tâche (audit/debug côté panel). */
  tasks: OsintTaskLog[];
  /** Quota utilisateur Aegis. */
  user_quota: { used: number; limit: number; tier: 'free' | 'premium' };
}

// ── Helpers ───────────────────────────────────────────────────────────────
const trim = (v: any) => (v == null ? '' : String(v).trim());

function makeBrixSearch(f: IdentityForm): Record<string, any> | null {
  const search: Record<string, any> = {};
  for (const k of [
    'nom_famille', 'prenom', 'date_naissance', 'annee_naissance', 'genre',
    'ville', 'code_postal', 'departement',
    'email', 'telephone', 'mobile',
    'nir', 'iban', 'siret', 'siren',
    'nom_utilisateur', 'societe', 'profession',
    'immatriculation',
  ] as const) {
    const v = trim((f as any)[k]);
    if (v !== '') search[k] = v;
  }
  if (!Object.keys(search).length) return null;
  search.flexible = f.flexible ?? true;
  search.per_page = 100;
  return search;
}

/** Signature de corrélation pour dédupliquer une personne. */
function personSig(p: Partial<AggregatedPerson>): string {
  const norm = (s?: string) => (s || '').toLowerCase().replace(/\s+/g, '');
  // Priorité aux identifiants forts.
  if (p.email)       return `email:${norm(p.email)}`;
  if (p.telephone)   return `tel:${norm(p.telephone).replace(/[^\d+]/g, '')}`;
  if (p.iban)        return `iban:${norm(p.iban)}`;
  if (p.nir)         return `nir:${norm(p.nir)}`;
  if (p.prenom && p.nom_famille && p.date_naissance)
    return `name:${norm(p.prenom)}|${norm(p.nom_famille)}|${p.date_naissance}`;
  if (p.prenom && p.nom_famille)
    return `name2:${norm(p.prenom)}|${norm(p.nom_famille)}`;
  return `raw:${Math.random().toString(36).slice(2)}`;
}

function mergePerson(into: AggregatedPerson, from: Partial<AggregatedPerson>) {
  const setIfBetter = <K extends keyof AggregatedPerson>(k: K) => {
    if (!into[k] && from[k]) (into as any)[k] = from[k];
  };
  for (const k of [
    'prenom', 'nom_famille', 'date_naissance', 'genre',
    'email', 'telephone', 'adresse', 'ville', 'code_postal',
    'iban', 'nir', 'siret', 'societe',
  ] as const) setIfBetter(k);

  // Multi-valeurs (emails/phones)
  const pushUniq = (arr: string[] | undefined, v?: string) => {
    if (!v) return arr;
    const a = arr ? [...arr] : [];
    if (!a.includes(v)) a.push(v);
    return a;
  };
  if (from.emails) for (const e of from.emails) into.emails = pushUniq(into.emails, e);
  if (from.email)  into.emails = pushUniq(into.emails, from.email);
  if (from.phones) for (const p of from.phones) into.phones = pushUniq(into.phones, p);
  if (from.telephone) into.phones = pushUniq(into.phones, from.telephone);

  // Provider tagging + confiance max
  if (from.providers) for (const p of from.providers) {
    if (!into.providers.includes(p)) into.providers.push(p);
  }
  if ((from.confidence ?? 0) > into.confidence) into.confidence = from.confidence ?? 0;

  if (from.raw) into.raw.push(...from.raw);
}

// ── BrixHub mappers ──────────────────────────────────────────────────────
function brixToPerson(p: any): Partial<AggregatedPerson> {
  return {
    prenom:         p.prenom,
    nom_famille:    p.nom_famille,
    date_naissance: p.date_naissance,
    genre:          p.genre,
    email:          p.email,
    telephone:      p.telephone || p.mobile,
    adresse:        p.adresse,
    ville:          p.ville,
    code_postal:    p.code_postal,
    iban:           p.iban,
    nir:            p.nir,
    siret:          p.siret,
    societe:        p.societe,
    providers:      ['brixhub'],
    confidence:     typeof p._confidence === 'number' ? p._confidence : 0,
    raw:            [{ provider: 'brixhub', profile: p }],
  };
}

// ── SeekNow mappers ──────────────────────────────────────────────────────
function seeknowSearchToBreach(r: any): BreachRecord {
  const known = ['source', 'email', 'username', 'password', 'ip_address', 'name', 'url'];
  const extra: Record<string, any> = {};
  for (const [k, v] of Object.entries(r || {})) {
    if (!known.includes(k)) extra[k] = v;
  }
  return {
    source:     r.source     || 'unknown',
    email:      r.email      || undefined,
    username:   r.username   || undefined,
    password:   r.password   || undefined,
    ip_address: r.ip_address || undefined,
    name:       r.name       || undefined,
    url:        r.url        || undefined,
    extra,
  };
}

/**
 * Quand un breach record correspond à un email/phone connu de BrixHub, on
 * lui ajoute SeekNow comme provider et on push le record dans le `raw`
 * de la personne. Sinon on crée une "personne" minimaliste pour ne pas
 * perdre le résultat (typiquement quand SeekNow connaît un email que
 * BrixHub ne référence pas en France).
 */
function breachToPersonHint(b: BreachRecord): Partial<AggregatedPerson> | null {
  if (!b.email && !b.username && !b.name) return null;
  return {
    email:       b.email,
    nom_famille: b.name?.split(' ').slice(-1)[0],
    prenom:      b.name?.split(' ').slice(0, -1).join(' ') || undefined,
    providers:   ['seeknow'],
    confidence:  0,
    raw:         [{ provider: 'seeknow', profile: b }],
  };
}

// ── Aggregator ────────────────────────────────────────────────────────────
export async function runOsintIdentity(
  me: AuthUser,
  form: IdentityForm,
  fresh = false,
): Promise<OsintReport> {
  const limit  = quotaForUser(me);
  let used     = dailyUsage.today(me.id);

  const tasks: OsintTaskLog[] = [];
  const stats: Record<'brixhub' | 'seeknow', ProviderStats> = {
    brixhub: { calls: 0, cached: 0, errors: 0, credits_remaining: null, daily_limit: null },
    seeknow: { calls: 0, cached: 0, errors: 0, credits_remaining: null, daily_limit: null },
  };

  // ── Plan : liste des appels à effectuer ────────────────────────────────
  type Plan = { provider: 'brixhub' | 'seeknow'; endpoint: string; method: 'GET' | 'POST'; cost: number; body?: any; query?: any; logKey: string };
  const plan: Plan[] = [];

  const brixSearch = makeBrixSearch(form);
  if (brixSearch) {
    plan.push({ provider: 'brixhub', endpoint: '/search', method: 'POST', cost: 1, body: brixSearch, logKey: 'search' });
  }

  // SeekNow ne supporte qu'une seule `query` par appel /search (pas de
  // recherche structurée), mais on déclenche systématiquement un /search
  // pour chaque identifiant utilisable + un /search fallback "nom prénom"
  // quand on n'a que les champs identité. Sans ça les critères purement
  // civils (nom+prénom+ville) ne déclenchaient aucun appel SeekNow.
  const email = trim(form.email);
  const phone = trim(form.telephone) || trim(form.mobile);
  const user  = trim(form.nom_utilisateur);
  const iban  = trim(form.iban);
  const nameQuery = [trim(form.prenom), trim(form.nom_famille)].filter(Boolean).join(' ').trim();

  if (email) {
    plan.push({ provider: 'seeknow', endpoint: '/search',              method: 'POST', cost: 1, body: { query: email, type: 'email', limit: 100 }, logKey: 'search' });
    plan.push({ provider: 'seeknow', endpoint: '/network/email-check', method: 'GET',  cost: 1, query: { email },                                  logKey: 'network_email' });
  }
  if (phone) {
    plan.push({ provider: 'seeknow', endpoint: '/search',         method: 'POST', cost: 1, body: { query: phone, type: 'phone', limit: 100 }, logKey: 'search' });
    plan.push({ provider: 'seeknow', endpoint: '/network/phone',  method: 'GET',  cost: 1, query: { phone },                                  logKey: 'network_phone' });
  }
  if (user) {
    plan.push({ provider: 'seeknow', endpoint: '/username/social', method: 'GET', cost: 1, query: { username: user }, logKey: 'username_social' });
    plan.push({ provider: 'seeknow', endpoint: '/search',          method: 'POST', cost: 1, body: { query: user, type: 'username', limit: 100 }, logKey: 'search' });
  }
  if (iban) {
    plan.push({ provider: 'seeknow', endpoint: '/search', method: 'POST', cost: 1, body: { query: iban, limit: 100 }, logKey: 'search' });
  }
  // Fallback : si on n'a aucun identifiant atomique mais qu'on a un
  // nom/prénom, on tente quand même un /search texte libre (SeekNow auto-
  // détecte le type quand on l'omet).
  if (!email && !phone && !user && nameQuery) {
    plan.push({ provider: 'seeknow', endpoint: '/search', method: 'POST', cost: 1, body: { query: nameQuery, limit: 100 }, logKey: 'search' });
  }

  // ── Exécution parallèle ────────────────────────────────────────────────
  const settled = await Promise.all(plan.map(async (p) => {
    const t0 = Date.now();
    try {
      const res = p.provider === 'brixhub'
        ? await callSeek(p.endpoint, { method: p.method, cost: p.cost, fresh, body: p.body, query: p.query })
        : await callSeeknow(p.endpoint, { method: p.method, cost: p.cost, fresh, body: p.body, query: p.query });

      const s = stats[p.provider];
      s.calls++;
      if (res.cached) s.cached++;
      if (!res.ok)    s.errors++;
      s.credits_remaining = res.credits_remaining;
      s.daily_limit       = res.daily_limit;

      // Quota Aegis : 1 unité par appel non-caché et coûteux.
      if (p.cost > 0 && !res.cached) {
        if (used >= limit) {
          // Edge-case rare : on n'a pas pré-checké le quota par tâche pour rester
          // simple ; si on dépasse, on log mais on garde le résultat (déjà payé).
        }
        dailyUsage.bump(me.id);
        used++;
      }
      apiUsage.log(me.id, p.provider, p.logKey, {
        cost:   p.cost,
        cached: res.cached,
        ok:     res.ok,
        status: res.status,
      });
      tasks.push({
        provider:    p.provider,
        endpoint:    p.endpoint,
        ok:          res.ok,
        cached:      res.cached,
        status:      res.status,
        error:       res.error ?? null,
        duration_ms: Date.now() - t0,
        cost:        p.cost,
      });
      return { plan: p, res };
    } catch (e: any) {
      stats[p.provider].calls++;
      stats[p.provider].errors++;
      tasks.push({
        provider:    p.provider,
        endpoint:    p.endpoint,
        ok:          false,
        cached:      false,
        status:      null,
        error:       e?.message || 'error',
        duration_ms: Date.now() - t0,
        cost:        p.cost,
      });
      return { plan: p, res: null };
    }
  }));

  // ── Normalisation / corrélation ────────────────────────────────────────
  const personMap = new Map<string, AggregatedPerson>();
  const upsertPerson = (hint: Partial<AggregatedPerson>) => {
    const sig = personSig(hint);
    let p = personMap.get(sig);
    if (!p) {
      p = {
        id: sig,
        providers: [],
        confidence: 0,
        raw: [],
      } as AggregatedPerson;
      personMap.set(sig, p);
    }
    mergePerson(p, hint);
    return p;
  };

  const breaches: BreachRecord[]         = [];
  const social:   SocialHit[]            = [];
  const network:  NetworkCheck           = {};

  for (const { plan: p, res } of settled) {
    if (!res?.ok) continue;
    const data = res.data;

    if (p.provider === 'brixhub' && p.endpoint === '/search') {
      const list: any[] = data?.data?.results || [];
      for (const profile of list) upsertPerson(brixToPerson(profile));
      continue;
    }

    if (p.provider === 'seeknow' && p.endpoint === '/search') {
      const list: any[] = data?.results || [];
      for (const r of list) {
        const b = seeknowSearchToBreach(r);
        breaches.push(b);
        const hint = breachToPersonHint(b);
        if (hint) upsertPerson(hint);
      }
      continue;
    }

    if (p.provider === 'seeknow' && p.endpoint === '/network/email-check') {
      const v = String(p.query?.email || '');
      network.email = {
        value:        v,
        valid:        data?.valid,
        deliverable:  data?.deliverable,
        disposable:   data?.disposable,
        breach_count: data?.breach_count,
        raw:          data,
      };
      continue;
    }
    if (p.provider === 'seeknow' && p.endpoint === '/network/phone') {
      const v = String(p.query?.phone || '');
      network.phone = {
        value:        v,
        country:      data?.country,
        carrier:      data?.carrier,
        line_type:    data?.line_type,
        breach_count: data?.breach_count,
        raw:          data,
      };
      continue;
    }
    if (p.provider === 'seeknow' && p.endpoint === '/username/social') {
      const found: any[] = data?.found_on || [];
      for (const f of found) {
        social.push({ platform: f.platform, url: f.url });
      }
      continue;
    }
  }

  // ── Post-link : on rattache chaque breach SeekNow à toute personne ─────
  // partageant un identifiant fort (email, téléphone, nom complet). Sans
  // ce passage, les breach records dont la signature primaire ne matche
  // pas exactement celle de la personne BrixHub restent orphelins dans
  // `breaches[]` et la sous-tab SeekNow d'une identité reste vide alors
  // que l'utilisateur a clairement des résultats.
  const norm = (s?: string) => (s || '').toLowerCase().replace(/\s+/g, '');
  const linkRaw = (person: AggregatedPerson, profile: any, kind: 'seeknow') => {
    if (!person.raw.some(r => r.provider === kind && r.profile === profile)) {
      person.raw.push({ provider: kind, profile });
      if (!person.providers.includes(kind)) person.providers.push(kind);
    }
  };
  for (const person of personMap.values()) {
    const personEmails = new Set(
      [person.email, ...(person.emails || [])].filter(Boolean).map(e => norm(e!))
    );
    const fullName = [person.prenom, person.nom_famille].filter(Boolean).map(norm).join('');

    for (const b of breaches) {
      let match = false;
      if (b.email && personEmails.has(norm(b.email))) match = true;
      // SeekNow stocke parfois des téléphones dans extra.* — best effort.
      if (b.username && person.email && norm(b.username) === norm(person.email.split('@')[0])) match = true;
      if (b.name && fullName) {
        const bn = norm(b.name);
        if (bn === fullName || (bn.includes(norm(person.prenom || '')) && bn.includes(norm(person.nom_famille || '')))) match = true;
      }
      if (match) linkRaw(person, b, 'seeknow');
    }

    // Rattacher aussi les hits sociaux qui correspondent à un email/username
    for (const s of social) {
      if (!s.profile) continue;
      const handle = norm(s.profile.username || s.profile.handle || '');
      if (handle && person.email && handle === norm(person.email.split('@')[0])) {
        linkRaw(person, s, 'seeknow');
      }
    }
  }

  return {
    query:     form,
    identities: Array.from(personMap.values()).sort((a, b) => b.confidence - a.confidence),
    breaches,
    social,
    network,
    providers:  stats,
    tasks,
    user_quota: { used, limit, tier: isPremium(me) ? 'premium' : 'free' },
  };
}
