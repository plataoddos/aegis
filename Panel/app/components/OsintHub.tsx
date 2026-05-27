/**
 * Aegis Renseignement (ex-OSINT Hub + Seek fusionnés)
 *
 * Deux modes :
 *  - Cible unique : colle n'importe quelle valeur (IP, domaine, email, username,
 *    hash, snowflake Discord, téléphone) → auto-detection → fan-out parallèle
 *    sur sources publiques + Seek si applicable.
 *  - Multi-critères : recherche identité (nom, prénom, date/année naissance,
 *    ville, email, téléphone, username) → fan-out via /api/seek-multi.
 *
 * Backend : /api/ip-lookup, /api/seek/<key>, /api/seek-multi, /api/seek/catalog.
 */
import { useEffect, useMemo, useState } from 'react';
import {
  Search, Loader2, Globe, MapPin, Mail, AtSign, Hash, Phone,
  MessageSquare, ShieldAlert, Server, Network, Database, Sparkles,
  Copy, Check, ChevronRight, ExternalLink, Zap, Target, FileSearch,
  Radio, Lock, Unlock, Activity, User, Calendar, UserPlus,
} from 'lucide-react';
import { toast } from 'sonner';

// ── Backend ────────────────────────────────────────────────────────────────
const API_URL   = ((import.meta as any).env?.VITE_WATCHER_API_URL  as string) || 'http://localhost:8787';
const getApiToken = () => { try { return localStorage.getItem('aegis_session') || ''; } catch { return ''; } };

async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(API_URL + path, { headers: { Authorization: `Bearer ${getApiToken()}` } });
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try { msg = (await res.json()).error || msg; } catch {}
    throw new Error(msg);
  }
  return res.json() as Promise<T>;
}

async function apiPost<T>(path: string, body: any): Promise<T> {
  const res = await fetch(API_URL + path, {
    method: 'POST',
    headers: { Authorization: `Bearer ${getApiToken()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  // The /seek/* dispatcher returns 502 when upstream BrixHub fails but still
  // ships a structured body with `error` + `status` + `data`. Surface that.
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const j: any = await res.json();
      msg = j?.error
        || j?.data?.error?.message
        || j?.data?.message
        || (j?.status ? `BrixHub ${j.status}` : msg);
    } catch {}
    throw new Error(msg);
  }
  return res.json() as Promise<T>;
}

// ── Auto-detection ─────────────────────────────────────────────────────────
type Kind = 'ip' | 'domain' | 'email' | 'phone' | 'hash' | 'discord' | 'username';

interface Detection { kind: Kind; value: string; confidence: number; label: string; icon: any }

function detect(raw: string): Detection[] {
  const q = raw.trim();
  if (!q) return [];
  const out: Detection[] = [];

  if (/^(?:\d{1,3}\.){3}\d{1,3}$/.test(q)) {
    out.push({ kind: 'ip', value: q, confidence: 1, label: 'Adresse IPv4', icon: MapPin });
  }
  if (/^[0-9a-f:]+$/i.test(q) && q.includes(':')) {
    out.push({ kind: 'ip', value: q, confidence: 0.95, label: 'Adresse IPv6', icon: MapPin });
  }
  if (/^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/.test(q)) {
    out.push({ kind: 'email', value: q.toLowerCase(), confidence: 1, label: 'Email', icon: Mail });
  }
  if (/^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(q) && !/^(?:\d{1,3}\.){3}\d{1,3}$/.test(q)) {
    out.push({ kind: 'domain', value: q.toLowerCase(), confidence: 0.95, label: 'Domaine', icon: Globe });
  }
  if (/^\+?[\d\s().-]{8,18}$/.test(q) && /\d{6,}/.test(q.replace(/\D/g, ''))) {
    out.push({ kind: 'phone', value: q.replace(/[\s().-]/g, ''), confidence: 0.7, label: 'Numéro de téléphone', icon: Phone });
  }
  if (/^[a-f0-9]{32}$/i.test(q))   out.push({ kind: 'hash', value: q.toLowerCase(), confidence: 1, label: 'MD5', icon: Hash });
  if (/^[a-f0-9]{40}$/i.test(q))   out.push({ kind: 'hash', value: q.toLowerCase(), confidence: 1, label: 'SHA1', icon: Hash });
  if (/^[a-f0-9]{64}$/i.test(q))   out.push({ kind: 'hash', value: q.toLowerCase(), confidence: 1, label: 'SHA256', icon: Hash });
  if (/^\d{15,25}$/.test(q))       out.push({ kind: 'discord', value: q, confidence: 0.85, label: 'Discord Snowflake', icon: MessageSquare });
  if (/^[a-zA-Z0-9_]{3,32}$/.test(q) && !/^\d+$/.test(q)) {
    out.push({ kind: 'username', value: q, confidence: 0.4, label: 'Username (réseaux sociaux)', icon: AtSign });
  }
  out.sort((a, b) => b.confidence - a.confidence);
  return out;
}

// ── Finding types ──────────────────────────────────────────────────────────
interface Finding {
  id: string;
  source: string;            // Name shown to user
  category: 'geo' | 'network' | 'identity' | 'reputation' | 'social' | 'crypto' | 'breach';
  status: 'pending' | 'ok' | 'fail' | 'empty';
  severity?: 'info' | 'low' | 'medium' | 'high';
  title: string;
  detail?: string;
  rows?: { label: string; value: string; mono?: boolean; href?: string }[];
  /** Raw BrixHub profiles — rendered as detailed cards (richer than `rows`). */
  profiles?: any[];
  link?: { href: string; label: string };
  durationMs?: number;
}

// ── Source runners ─────────────────────────────────────────────────────────
type Runner = (target: Detection) => Promise<Finding>;

const SOURCES: { id: string; appliesTo: Kind[]; run: Runner }[] = [
  // ── IP geolocation (via backend proxy w/ fallback) ───────────────────────
  {
    id: 'ip-geo',
    appliesTo: ['ip'],
    run: async (t) => {
      const t0 = performance.now();
      try {
        const res = await apiGet<any>(`/api/ip-lookup/${encodeURIComponent(t.value)}`);
        const d = res.data;
        return {
          id: 'ip-geo', source: 'Géolocalisation IP', category: 'geo',
          status: 'ok', severity: 'info',
          title: `${d.flag_emoji ?? '🌐'} ${d.country ?? '—'} · ${d.city ?? '—'}`,
          detail: `${d.org ?? d.isp ?? ''}${d.asn ? ` · AS${d.asn}` : ''}`,
          rows: [
            { label: 'Pays',   value: `${d.country ?? '—'}${d.country_code ? ` (${d.country_code})` : ''}` },
            { label: 'Ville',  value: [d.city, d.region].filter(Boolean).join(', ') || '—' },
            { label: 'ASN',    value: d.asn ? `AS${d.asn}` : '—', mono: true },
            { label: 'Org',    value: d.org ?? '—' },
            { label: 'ISP',    value: d.isp ?? '—' },
            { label: 'Fuseau', value: d.timezone ?? '—', mono: true },
          ],
          link: d.latitude && d.longitude
            ? { href: `https://www.openstreetmap.org/?mlat=${d.latitude}&mlon=${d.longitude}#map=12/${d.latitude}/${d.longitude}`, label: 'OpenStreetMap' }
            : undefined,
          durationMs: performance.now() - t0,
        };
      } catch (e: any) {
        return errorFinding('ip-geo', 'Géolocalisation IP', 'geo', e.message, performance.now() - t0);
      }
    },
  },

  // ── Reverse DNS ──────────────────────────────────────────────────────────
  {
    id: 'rdns',
    appliesTo: ['ip'],
    run: async (t) => {
      const t0 = performance.now();
      try {
        const parts = t.value.split('.');
        if (parts.length !== 4) throw new Error('IPv4 only');
        const arpa = parts.reverse().join('.') + '.in-addr.arpa';
        const r = await fetch(`https://cloudflare-dns.com/dns-query?name=${arpa}&type=PTR`, { headers: { Accept: 'application/dns-json' } });
        const j: any = await r.json();
        const ans = (j.Answer || []).map((a: any) => a.data.replace(/\.$/, ''));
        return {
          id: 'rdns', source: 'Reverse DNS', category: 'network',
          status: ans.length ? 'ok' : 'empty',
          severity: 'info',
          title: ans[0] ?? 'Aucun PTR record',
          rows: ans.map((p: string) => ({ label: 'PTR', value: p, mono: true })),
          durationMs: performance.now() - t0,
        };
      } catch (e: any) {
        return errorFinding('rdns', 'Reverse DNS', 'network', e.message, performance.now() - t0);
      }
    },
  },

  // ── DNS records (domain) ─────────────────────────────────────────────────
  {
    id: 'dns',
    appliesTo: ['domain'],
    run: async (t) => {
      const t0 = performance.now();
      try {
        const types = ['A', 'AAAA', 'MX', 'NS', 'TXT'];
        const results = await Promise.all(types.map(async ty => {
          const r = await fetch(`https://cloudflare-dns.com/dns-query?name=${t.value}&type=${ty}`, { headers: { Accept: 'application/dns-json' } });
          const j: any = await r.json();
          return { ty, ans: (j.Answer || []) as { TTL: number; data: string }[] };
        }));
        const total = results.reduce((acc, x) => acc + x.ans.length, 0);
        const rows = results.flatMap(x => x.ans.slice(0, 4).map(a => ({ label: x.ty, value: a.data, mono: true })));
        return {
          id: 'dns', source: 'DNS Records', category: 'network',
          status: total ? 'ok' : 'empty', severity: 'info',
          title: `${total} enregistrement${total > 1 ? 's' : ''}`,
          detail: results.filter(x => x.ans.length).map(x => `${x.ty}:${x.ans.length}`).join(' · ') || '—',
          rows,
          durationMs: performance.now() - t0,
        };
      } catch (e: any) {
        return errorFinding('dns', 'DNS Records', 'network', e.message, performance.now() - t0);
      }
    },
  },

  // ── WHOIS / RDAP ─────────────────────────────────────────────────────────
  {
    id: 'rdap',
    appliesTo: ['domain'],
    run: async (t) => {
      const t0 = performance.now();
      try {
        const r = await fetch(`https://rdap.org/domain/${encodeURIComponent(t.value)}`);
        if (!r.ok) throw new Error(`RDAP HTTP ${r.status}`);
        const j: any = await r.json();
        const reg = (j.events || []).find((e: any) => e.eventAction === 'registration')?.eventDate;
        const exp = (j.events || []).find((e: any) => e.eventAction === 'expiration')?.eventDate;
        const ns  = (j.nameservers || []).map((n: any) => n.ldhName).filter(Boolean);
        return {
          id: 'rdap', source: 'WHOIS / RDAP', category: 'identity',
          status: 'ok', severity: 'info',
          title: j.ldhName || t.value,
          detail: reg ? `Enregistré le ${new Date(reg).toLocaleDateString('fr-FR')}` : '—',
          rows: [
            { label: 'Handle',     value: j.handle || '—', mono: true },
            { label: 'Statut',     value: (j.status || []).join(', ') || '—' },
            { label: 'Création',   value: reg ? new Date(reg).toLocaleString('fr-FR') : '—' },
            { label: 'Expiration', value: exp ? new Date(exp).toLocaleString('fr-FR') : '—' },
            ...ns.slice(0, 4).map((n: string) => ({ label: 'NS', value: n, mono: true })),
          ],
          durationMs: performance.now() - t0,
        };
      } catch (e: any) {
        return errorFinding('rdap', 'WHOIS / RDAP', 'identity', e.message, performance.now() - t0);
      }
    },
  },

  // ── Subdomains via crt.sh ────────────────────────────────────────────────
  {
    id: 'subdomains',
    appliesTo: ['domain'],
    run: async (t) => {
      const t0 = performance.now();
      try {
        const r = await fetch(`https://crt.sh/?q=${encodeURIComponent('%.' + t.value)}&output=json`);
        if (!r.ok) throw new Error(`crt.sh HTTP ${r.status}`);
        const j = await r.json() as { name_value: string }[];
        const set = new Set<string>();
        for (const row of j) for (const n of String(row.name_value).split(/\n/)) {
          const v = n.trim().toLowerCase();
          if (v && !v.startsWith('*') && v.endsWith(t.value.toLowerCase())) set.add(v);
        }
        const list = [...set].sort();
        return {
          id: 'subdomains', source: 'Sous-domaines (CT logs)', category: 'network',
          status: list.length ? 'ok' : 'empty',
          severity: list.length > 50 ? 'medium' : 'info',
          title: `${list.length} sous-domaine${list.length > 1 ? 's' : ''}`,
          detail: list.length > 50 ? 'Surface d\'attaque importante' : undefined,
          rows: list.slice(0, 20).map(s => ({ label: '·', value: s, mono: true })),
          durationMs: performance.now() - t0,
        };
      } catch (e: any) {
        return errorFinding('subdomains', 'Sous-domaines', 'network', e.message, performance.now() - t0);
      }
    },
  },

  // ── Email: validation + OSINT links ──────────────────────────────────────
  {
    id: 'email-mx',
    appliesTo: ['email'],
    run: async (t) => {
      const t0 = performance.now();
      try {
        const dom = t.value.split('@')[1];
        const r = await fetch(`https://cloudflare-dns.com/dns-query?name=${dom}&type=MX`, { headers: { Accept: 'application/dns-json' } });
        const j: any = await r.json();
        const mx = (j.Answer || []).map((a: any) => String(a.data).split(/\s+/).pop()).filter(Boolean);
        return {
          id: 'email-mx', source: 'Validité email (MX)', category: 'identity',
          status: mx.length ? 'ok' : 'fail',
          severity: mx.length ? 'info' : 'medium',
          title: mx.length ? `Domaine livrable (${mx.length} MX)` : 'Aucun MX — email non livrable',
          rows: mx.slice(0, 5).map((m: string) => ({ label: 'MX', value: m.replace(/\.$/, ''), mono: true })),
          durationMs: performance.now() - t0,
        };
      } catch (e: any) {
        return errorFinding('email-mx', 'Validité email', 'identity', e.message, performance.now() - t0);
      }
    },
  },

  // ── Email: Gravatar profil ────────────────────────────────────────────────
  {
    id: 'gravatar',
    appliesTo: ['email'],
    run: async (t) => {
      const t0 = performance.now();
      try {
        // MD5 of email for gravatar URL
        const enc = new TextEncoder().encode(t.value.trim().toLowerCase());
        const digest = await crypto.subtle.digest('SHA-1', enc); // SHA1 fallback (CORS-friendly via SubtleCrypto)
        const bytes = new Uint8Array(digest);
        const hex = Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 32);
        const url = `https://www.gravatar.com/avatar/${hex}?d=404`;
        const probe = await fetch(url, { method: 'HEAD' });
        const has = probe.ok;
        return {
          id: 'gravatar', source: 'Gravatar', category: 'identity',
          status: has ? 'ok' : 'empty', severity: 'info',
          title: has ? 'Profil Gravatar trouvé' : 'Aucun profil Gravatar',
          link: has ? { href: `https://gravatar.com/${hex}`, label: 'Voir profil' } : undefined,
          rows: has ? [{ label: 'Avatar', value: url, mono: true, href: url }] : undefined,
          durationMs: performance.now() - t0,
        };
      } catch (e: any) {
        return errorFinding('gravatar', 'Gravatar', 'identity', e.message, performance.now() - t0);
      }
    },
  },

  // ── Username: liens vers réseaux sociaux ────────────────────────────────
  {
    id: 'social-links',
    appliesTo: ['username'],
    run: async (t) => {
      const t0 = performance.now();
      const u = t.value;
      const sites = [
        { name: 'GitHub',    href: `https://github.com/${u}` },
        { name: 'Twitter/X', href: `https://x.com/${u}` },
        { name: 'Instagram', href: `https://instagram.com/${u}` },
        { name: 'Reddit',    href: `https://reddit.com/user/${u}` },
        { name: 'TikTok',    href: `https://tiktok.com/@${u}` },
        { name: 'YouTube',   href: `https://youtube.com/@${u}` },
        { name: 'Twitch',    href: `https://twitch.tv/${u}` },
      ];
      return {
        id: 'social-links', source: 'Réseaux sociaux', category: 'social',
        status: 'ok', severity: 'info',
        title: `${sites.length} plateformes à vérifier`,
        detail: 'Liens directs (vérification manuelle)',
        rows: sites.map(s => ({ label: s.name, value: s.href, mono: true, href: s.href })),
        durationMs: performance.now() - t0,
      };
    },
  },

  // ── Discord snowflake → timestamp ────────────────────────────────────────
  {
    id: 'discord-meta',
    appliesTo: ['discord'],
    run: async (t) => {
      const t0 = performance.now();
      try {
        const id = BigInt(t.value);
        const ts = Number((id >> 22n) + 1420070400000n);
        const date = new Date(ts);
        return {
          id: 'discord-meta', source: 'Discord Snowflake', category: 'identity',
          status: 'ok', severity: 'info',
          title: `Compte créé ${date.toLocaleString('fr-FR')}`,
          detail: `il y a ${Math.floor((Date.now() - ts) / 86_400_000)} jours`,
          rows: [
            { label: 'ID',         value: t.value, mono: true },
            { label: 'Création',   value: date.toISOString(), mono: true },
            { label: 'Worker ID',  value: String((id >> 17n) & 0x1Fn), mono: true },
            { label: 'Process ID', value: String((id >> 12n) & 0x1Fn), mono: true },
          ],
          link: { href: `https://discord.com/users/${t.value}`, label: 'Ouvrir Discord' },
          durationMs: performance.now() - t0,
        };
      } catch (e: any) {
        return errorFinding('discord-meta', 'Discord Snowflake', 'identity', e.message, performance.now() - t0);
      }
    },
  },

  // ── Hash: VirusTotal public link (no key on frontend) ────────────────────
  {
    id: 'hash-vt',
    appliesTo: ['hash'],
    run: async (t) => {
      const t0 = performance.now();
      const algo = t.value.length === 32 ? 'MD5' : t.value.length === 40 ? 'SHA1' : 'SHA256';
      return {
        id: 'hash-vt', source: 'Hash analysis', category: 'crypto',
        status: 'ok', severity: 'info',
        title: `${algo} · ${t.value.length} caractères`,
        detail: 'Lookup externe disponible',
        rows: [{ label: algo, value: t.value, mono: true }],
        link: { href: `https://www.virustotal.com/gui/file/${t.value}`, label: 'Vérifier sur VirusTotal' },
        durationMs: performance.now() - t0,
      };
    },
  },

  // ── BrixHub: reverse lookup by email ────────────────────────────────────
  {
    id: 'brix-lookup-email',
    appliesTo: ['email'],
    run: async (t) => {
      const t0 = performance.now();
      try {
        const res = await apiPost<any>('/api/seek/lookup_email', { email: t.value });
        const env = res?.data;
        const body = env?.data;
        const list: any[] = Array.isArray(body?.results) ? body.results
          : body && typeof body === 'object' && Object.keys(body).length ? [body]
          : [];
        return {
          id: 'brix-lookup-email', source: 'BrixHub · lookup email', category: 'identity',
          status: list.length ? 'ok' : 'empty',
          severity: list.length ? 'medium' : 'info',
          title: list.length ? `${list.length} profil${list.length > 1 ? 's' : ''}` : 'Aucun profil',
          detail: env?.meta?.took_ms != null ? `${env.meta.took_ms} ms` : undefined,
          profiles: list,
          durationMs: performance.now() - t0,
        };
      } catch (e: any) {
        return errorFinding('brix-lookup-email', 'BrixHub · lookup email', 'identity', e.message, performance.now() - t0);
      }
    },
  },

  // ── BrixHub: reverse lookup by phone ────────────────────────────────────
  {
    id: 'brix-lookup-phone',
    appliesTo: ['phone'],
    run: async (t) => {
      const t0 = performance.now();
      try {
        const res = await apiPost<any>('/api/seek/lookup_phone', { phone: t.value });
        const env = res?.data;
        const body = env?.data;
        const list: any[] = Array.isArray(body?.results) ? body.results
          : body && typeof body === 'object' && Object.keys(body).length ? [body]
          : [];
        return {
          id: 'brix-lookup-phone', source: 'BrixHub · lookup téléphone', category: 'identity',
          status: list.length ? 'ok' : 'empty',
          severity: list.length ? 'medium' : 'info',
          title: list.length ? `${list.length} profil${list.length > 1 ? 's' : ''}` : 'Aucun profil',
          detail: env?.meta?.took_ms != null ? `${env.meta.took_ms} ms` : undefined,
          profiles: list,
          durationMs: performance.now() - t0,
        };
      } catch (e: any) {
        return errorFinding('brix-lookup-phone', 'BrixHub · lookup téléphone', 'identity', e.message, performance.now() - t0);
      }
    },
  },
];

function errorFinding(id: string, source: string, category: Finding['category'], msg: string, ms: number): Finding {
  return { id, source, category, status: 'fail', severity: 'low', title: 'Échec', detail: msg, durationMs: ms };
}

// ── Multi-criteria identity form (BrixHub schema) ──────────────────────────
interface IdentityForm {
  // Identité
  nom_famille?: string; prenom?: string;
  date_naissance?: string;          // YYYY-MM-DD
  annee_naissance?: string;         // year only
  genre?: string;                   // 'M' | 'F'
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

interface MultiQuery {
  /** Provider → détermine la route backend (`/api/seek/*` vs `/api/seeknow/*`). */
  provider: 'brixhub' | 'seeknow';
  /** Catalog key (ex. 'search', 'lookup_email', 'network_email', 'discord_user'…). */
  key: string;
  label: string;
  payload: any;
}

function buildMultiQueries(f: IdentityForm): MultiQuery[] {
  const queries: MultiQuery[] = [];

  // ── BrixHub /search : fusionne toutes les sources internes en un appel ──
  const search: Record<string, any> = {};
  for (const k of [
    'nom_famille', 'prenom', 'date_naissance', 'annee_naissance', 'genre',
    'ville', 'code_postal', 'departement',
    'email', 'telephone', 'mobile',
    'nir', 'iban', 'siret', 'siren',
    'nom_utilisateur', 'societe', 'profession',
    'immatriculation',
  ] as const) {
    const v = f[k];
    if (v != null && String(v).trim() !== '') search[k] = String(v).trim();
  }
  if (Object.keys(search).length) {
    search.flexible = f.flexible ?? true;
    search.per_page = 100;
    const summary = [
      [f.prenom, f.nom_famille].filter(Boolean).join(' '),
      f.email, f.telephone || f.mobile,
      f.iban, f.siret, f.nir,
    ].filter(Boolean).join(' · ') || 'recherche multi-critères';
    queries.push({ provider: 'brixhub', key: 'search', label: `BrixHub /search (${summary})`, payload: search });
  }

  // ── SeekNow : fan-out par identifiant atomique (212M+ breach records, ───
  //    stealer logs, OSINT 70+ sources). Chaque appel = 1 crédit upstream.
  const email = f.email?.trim();
  const phone = (f.telephone || f.mobile)?.trim();
  const user  = f.nom_utilisateur?.trim();
  if (email) {
    queries.push({ provider: 'seeknow', key: 'search',         label: `SeekNow /search (${email})`,        payload: { query: email, type: 'email', limit: 100 } });
    queries.push({ provider: 'seeknow', key: 'network_email',  label: `SeekNow /network/email-check (${email})`, payload: { email } });
  }
  if (phone) {
    queries.push({ provider: 'seeknow', key: 'search',         label: `SeekNow /search (${phone})`,        payload: { query: phone, type: 'phone', limit: 100 } });
    queries.push({ provider: 'seeknow', key: 'network_phone',  label: `SeekNow /network/phone (${phone})`, payload: { phone } });
  }
  if (user) {
    queries.push({ provider: 'seeknow', key: 'username_social', label: `SeekNow /username/social (${user})`, payload: { username: user } });
    queries.push({ provider: 'seeknow', key: 'search',          label: `SeekNow /search (${user})`,         payload: { query: user, type: 'username', limit: 100 } });
  }

  return queries;
}

// ── Component ──────────────────────────────────────────────────────────────
type Mode = 'single' | 'multi';

export function OsintHub() {
  const [mode, setMode]       = useState<Mode>('single');
  const [input, setInput]     = useState('');
  const [running, setRunning] = useState(false);
  const [target, setTarget]   = useState<Detection | null>(null);
  const [findings, setFindings] = useState<Finding[]>([]);
  const [copied, setCopied]   = useState(false);
  const [credits, setCredits] = useState<number | null>(null);

  // Multi-criteria state
  const [identity, setIdentity] = useState<IdentityForm>({});
  const setField = (k: keyof IdentityForm) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setIdentity(prev => ({ ...prev, [k]: e.target.value }));

  const detections = useMemo(() => detect(input), [input]);
  const multiQueries = useMemo(() => buildMultiQueries(identity), [identity]);

  // Fetch credit balance once
  useEffect(() => {
    apiGet<{ credits_remaining: number | null }>('/api/seek/catalog')
      .then(r => setCredits(r.credits_remaining))
      .catch(() => {});
  }, []);

  // ── Multi-criteria scan ────────────────────────────────────────────────
  const runMulti = async () => {
    if (!multiQueries.length) {
      toast.error('Renseigne au moins un critère');
      return;
    }
    setTarget({ kind: 'username', value: [identity.prenom, identity.nom_famille].filter(Boolean).join(' ') || 'identité', confidence: 1, label: 'Identité multi-critères', icon: User });
    setRunning(true);

    const initial: Finding[] = multiQueries.map((q, i) => ({
      id: `multi-${i}`, source: q.label, category: 'identity',
      status: 'pending', title: 'En cours…',
    }));
    setFindings(initial);

    await Promise.all(multiQueries.map(async (q, i) => {
      const t0 = performance.now();
      try {
        // Routing par provider : BrixHub a une envelope { status, message,
        // data, meta } ; SeekNow renvoie { success, results|profile|…,
        // credits_remaining }. On normalise vers { list, total }.
        const route = q.provider === 'seeknow' ? `/api/seeknow/${q.key}` : `/api/seek/${q.key}`;
        const res: any = await apiPost(route, q.payload);

        let list: any[] = [];
        let total = 0;
        let took: number | undefined;

        if (q.provider === 'brixhub') {
          const env  = res?.data;
          const body = env?.data;
          list = Array.isArray(body?.results) ? body.results
               : body && typeof body === 'object' ? [body]
               : [];
          total = env?.meta?.total ?? list.length;
          took  = env?.meta?.took_ms;
        } else {
          // SeekNow envelope : `data` = body upstream { success, results?,
          // profile?, found_on?, history?, … }. On scanne les champs connus.
          const body = res?.data;
          if (body && typeof body === 'object') {
            if (Array.isArray(body.results))   list = body.results;
            else if (Array.isArray(body.found_on)) list = body.found_on;
            else if (Array.isArray(body.history))  list = body.history;
            else if (body.profile && typeof body.profile === 'object') list = [body.profile];
            else if (body.roblox  && typeof body.roblox  === 'object') list = [body.roblox];
            else if (Object.keys(body).filter(k => !['success','credits_remaining'].includes(k)).length) {
              list = [body];
            }
          }
          total = body?.total ?? list.length;
        }

        const f: Finding = {
          id: `multi-${i}`, source: q.label, category: 'identity',
          status: list.length ? 'ok' : 'empty',
          severity: list.length > 5 ? 'medium' : list.length > 0 ? 'medium' : 'info',
          title: `${total} résultat${total > 1 ? 's' : ''}${res?.cached ? ' (cache)' : ''}`,
          detail: took != null ? `${took} ms` : undefined,
          profiles: list,
          durationMs: performance.now() - t0,
        };
        if (q.provider === 'brixhub' && res?.credits_remaining != null) setCredits(res.credits_remaining);
        setFindings(prev => prev.map(x => x.id === `multi-${i}` ? f : x));
      } catch (e: any) {
        setFindings(prev => prev.map(x => x.id === `multi-${i}` ? errorFinding(`multi-${i}`, q.label, 'identity', e.message, performance.now() - t0) : x));
      }
    }));

    setRunning(false);
    toast.success(`Recherche identité terminée · ${multiQueries.length} requête${multiQueries.length > 1 ? 's' : ''}`);
  };

  const runScan = async (det: Detection) => {
    setTarget(det);
    setRunning(true);
    const sources = SOURCES.filter(s => s.appliesTo.includes(det.kind));
    setFindings(sources.map(s => ({
      id: s.id, source: s.id, category: 'network',
      status: 'pending', title: 'En cours…',
    })));

    // Fan out in parallel — update each finding as it resolves.
    await Promise.all(sources.map(async (s) => {
      try {
        const f = await s.run(det);
        setFindings(prev => prev.map(x => x.id === s.id ? f : x));
      } catch (e: any) {
        setFindings(prev => prev.map(x => x.id === s.id ? errorFinding(s.id, s.id, 'network', e.message, 0) : x));
      }
    }));

    setRunning(false);
    toast.success(`Analyse terminée · ${sources.length} sources`);
  };

  const score = useMemo(() => {
    if (!findings.length) return 0;
    const ok = findings.filter(f => f.status === 'ok').length;
    return Math.round((ok / findings.length) * 100);
  }, [findings]);

  const copy = () => {
    navigator.clipboard.writeText(JSON.stringify({ target, findings }, null, 2));
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
    toast.success('Rapport copié (JSON)');
  };

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-5">
      {/* Page header — style identique à "Mon compte" */}
      <div className="aegis-card aegis-card-edge p-6 relative overflow-hidden">
        <div className="absolute -top-12 -right-12 w-52 h-52 rounded-full bg-gradient-to-br from-indigo-500/20 to-violet-500/0 blur-3xl pointer-events-none" />
        <div className="flex items-start gap-4 relative">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-indigo-500/30 to-violet-500/10 ring-1 ring-indigo-500/40 flex items-center justify-center flex-shrink-0">
            <Target className="w-6 h-6 text-indigo-300" />
          </div>
          <div className="flex-1 min-w-0">
            <h1 className="text-2xl font-bold tracking-tight">Renseignement</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              Cible unique ou recherche multi-critères — fan-out parallèle vers les sources publiques et BrixHub.
            </p>
          </div>
          <div className="hidden sm:flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-emerald-400 font-semibold flex-shrink-0">
            <Activity className="w-3 h-3 aegis-pulse" />
            Online
          </div>
        </div>
      </div>

      {/* Mode toggle */}
      <div className="aegis-card aegis-card-edge p-1.5 flex items-center gap-1 overflow-x-auto">
        <button onClick={() => setMode('single')}
          className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold transition-all whitespace-nowrap ${
            mode === 'single'
              ? 'bg-primary/15 text-primary ring-1 ring-primary/30'
              : 'text-muted-foreground hover:text-foreground hover:bg-white/5'
          }`}>
          <Target className="w-3.5 h-3.5" /> Cible
        </button>
        <button onClick={() => setMode('multi')}
          className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold transition-all whitespace-nowrap ${
            mode === 'multi'
              ? 'bg-primary/15 text-primary ring-1 ring-primary/30'
              : 'text-muted-foreground hover:text-foreground hover:bg-white/5'
          }`}>
          <User className="w-3.5 h-3.5" /> Multi-critères
        </button>
      </div>

      {/* Search form */}
      <div className="aegis-card aegis-card-edge p-5">
          {mode === 'single' ? (
            <>
              <div className="relative">
                <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <input
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && detections[0] && runScan(detections[0])}
                  placeholder="IP, domaine, email, username, snowflake Discord, hash MD5/SHA1/SHA256, téléphone…"
                  className="w-full bg-black/30 border border-white/10 rounded-xl pl-11 pr-32 py-3.5 text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-500/40 font-mono"
                />
                <button
                  onClick={() => detections[0] && runScan(detections[0])}
                  disabled={!detections.length || running}
                  className="absolute right-2 top-1/2 -translate-y-1/2 aegis-btn-primary text-primary-foreground px-4 py-2 rounded-lg text-xs font-semibold flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed">
                  {running ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Zap className="w-3.5 h-3.5" />}
                  {running ? 'Scan…' : 'Analyser'}
                </button>
              </div>

              {!!detections.length && (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {detections.map((d, i) => {
                    const Icon = d.icon;
                    const active = target?.kind === d.kind && target?.value === d.value;
                    return (
                      <button key={`${d.kind}-${i}`} onClick={() => runScan(d)} disabled={running}
                        className={`group inline-flex items-center gap-1.5 text-[11px] px-2.5 py-1 rounded-full border transition-all disabled:opacity-50 ${
                          active ? 'border-indigo-500/50 bg-indigo-500/15 text-indigo-300'
                                 : 'border-white/10 bg-white/[0.03] text-muted-foreground hover:bg-white/[0.06] hover:text-foreground'
                        }`}>
                        <Icon className="w-3 h-3" />
                        <span className="font-semibold">{d.label}</span>
                        <span className="opacity-50 font-mono truncate max-w-[120px]">{d.value}</span>
                        <span className="text-[9px] opacity-60">{Math.round(d.confidence * 100)}%</span>
                      </button>
                    );
                  })}
                </div>
              )}

              {input && !detections.length && (
                <div className="mt-3 text-[11px] text-amber-400 flex items-center gap-1.5">
                  <ShieldAlert className="w-3 h-3" /> Format non reconnu — essayez une IP, un domaine, un email, un username…
                </div>
              )}
            </>
          ) : (
            <MultiCriteriaForm
              identity={identity}
              setField={setField}
              onRun={runMulti}
              running={running}
              queries={multiQueries}
            />
          )}
      </div>

      {/* Results */}
      {!!findings.length && (
        <div className="space-y-4">
          {/* Summary bar */}
          <div className="aegis-card aegis-card-edge aegis-scanlines flex items-center gap-4 px-5 py-3">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-emerald-500/20 to-emerald-500/0 ring-1 ring-emerald-500/30 flex items-center justify-center">
                <FileSearch className="w-4 h-4 text-emerald-400" />
              </div>
              <div>
                <p className="text-sm font-semibold text-foreground">Cible analysée</p>
                <p className="text-[11px] text-muted-foreground font-mono truncate max-w-[280px]">
                  {target?.label} · {target?.value}
                </p>
              </div>
            </div>

            <div className="h-9 w-px bg-white/5" />

            <Stat label="Sources" value={findings.length} />
            <Stat label="OK"      value={findings.filter(f => f.status === 'ok').length}    tone="emerald" />
            <Stat label="Vide"    value={findings.filter(f => f.status === 'empty').length} tone="zinc" />
            <Stat label="Échec"   value={findings.filter(f => f.status === 'fail').length}  tone="rose" />

            <div className="ml-auto flex items-center gap-3">
              {/* Coverage gauge */}
              <div className="flex items-center gap-2">
                <div className="relative w-12 h-12">
                  <svg viewBox="0 0 36 36" className="w-12 h-12 -rotate-90">
                    <circle cx="18" cy="18" r="14" fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth="3" />
                    <circle cx="18" cy="18" r="14" fill="none" stroke="url(#scoreGrad)" strokeWidth="3"
                      strokeLinecap="round" pathLength={100} strokeDasharray={`${score} 100`}
                      style={{ transition: 'stroke-dasharray 0.6s ease' }} />
                    <defs>
                      <linearGradient id="scoreGrad" x1="0" y1="0" x2="1" y2="1">
                        <stop offset="0%"  stopColor="#6366f1" />
                        <stop offset="100%" stopColor="#a855f7" />
                      </linearGradient>
                    </defs>
                  </svg>
                  <div className="absolute inset-0 flex items-center justify-center">
                    <span className="text-[11px] font-bold tabular-nums text-foreground">{score}</span>
                  </div>
                </div>
                <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Couverture</span>
              </div>

              <button onClick={copy}
                className="border border-white/10 hover:bg-white/5 hover:border-white/20 text-muted-foreground hover:text-foreground px-2.5 py-1.5 rounded-lg text-xs flex items-center gap-1.5 transition-all">
                {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                {copied ? 'Copié' : 'Rapport JSON'}
              </button>
            </div>
          </div>

          {/* Findings grid: full-width when carrying detailed BrixHub profiles. */}
          <div className="grid gap-3 md:grid-cols-2">
            {findings.map(f => (
              <div key={f.id} className={f.profiles && f.profiles.length > 0 ? 'md:col-span-2' : ''}>
                <FindingCard finding={f} />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Empty state */}
      {!findings.length && !input && (
        <div className="aegis-card aegis-card-edge p-10 text-center">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-indigo-500/20 to-violet-500/0 ring-1 ring-indigo-500/30 flex items-center justify-center mx-auto mb-4 shadow-lg shadow-indigo-500/10">
            <Sparkles className="w-7 h-7 text-indigo-300" />
          </div>
          <p className="text-foreground font-semibold mb-1">Prêt à scanner</p>
          <p className="text-xs text-muted-foreground max-w-md mx-auto">
            Colle n'importe quelle valeur — IP, domaine, email, username, ID Discord, hash, téléphone — et l'OSINT Hub fera le reste.
          </p>
          <div className="mt-5 flex items-center justify-center gap-2 flex-wrap">
            {[
              { v: '8.8.8.8',          k: 'IP'        },
              { v: 'github.com',       k: 'Domaine'   },
              { v: 'admin@example.com', k: 'Email'    },
              { v: '226942780520988672', k: 'Discord' },
              { v: 'd41d8cd98f00b204e9800998ecf8427e', k: 'Hash' },
            ].map((s, i) => (
              <button key={i} onClick={() => setInput(s.v)}
                className="text-[11px] border border-white/10 hover:border-indigo-500/40 hover:bg-indigo-500/10 text-muted-foreground hover:text-foreground rounded-full px-2.5 py-1 font-mono transition-all">
                {s.v}
                <span className="ml-1.5 opacity-60 text-[10px]">{s.k}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────
function Stat({ label, value, tone }: { label: string; value: number; tone?: 'emerald' | 'rose' | 'zinc' }) {
  const colour = tone === 'emerald' ? 'text-emerald-400' : tone === 'rose' ? 'text-rose-400' : tone === 'zinc' ? 'text-zinc-500' : 'text-foreground';
  return (
    <div className="flex flex-col">
      <span className={`text-sm font-bold tabular-nums leading-none ${colour}`}>{value}</span>
      <span className="text-[9px] uppercase tracking-wider text-muted-foreground/70 font-semibold mt-0.5">{label}</span>
    </div>
  );
}

const CATEGORY_TONE: Record<Finding['category'], { bg: string; ring: string; text: string; icon: any }> = {
  geo:        { bg: 'bg-cyan-500/10',    ring: 'ring-cyan-500/30',    text: 'text-cyan-400',    icon: MapPin },
  network:    { bg: 'bg-violet-500/10',  ring: 'ring-violet-500/30',  text: 'text-violet-400',  icon: Network },
  identity:   { bg: 'bg-indigo-500/10',  ring: 'ring-indigo-500/30',  text: 'text-indigo-400',  icon: Server },
  reputation: { bg: 'bg-amber-500/10',   ring: 'ring-amber-500/30',   text: 'text-amber-400',   icon: ShieldAlert },
  social:     { bg: 'bg-rose-500/10',    ring: 'ring-rose-500/30',    text: 'text-rose-400',    icon: Radio },
  crypto:     { bg: 'bg-emerald-500/10', ring: 'ring-emerald-500/30', text: 'text-emerald-400', icon: Lock },
  breach:     { bg: 'bg-red-500/10',     ring: 'ring-red-500/30',     text: 'text-red-400',     icon: Unlock },
};

function MultiCriteriaForm({ identity, setField, onRun, running, queries }: {
  identity: IdentityForm;
  setField: (k: keyof IdentityForm) => (e: React.ChangeEvent<HTMLInputElement>) => void;
  onRun: () => void;
  running: boolean;
  queries: MultiQuery[];
}) {
  type FieldKey = Exclude<keyof IdentityForm, 'flexible'>;
  const fields: { key: FieldKey; label: string; placeholder: string; icon: any; type?: string }[] = [
    { key: 'nom_famille',     label: 'Nom de famille',  placeholder: 'DUPONT',         icon: User },
    { key: 'prenom',          label: 'Prénom',          placeholder: 'Jean',           icon: User },
    { key: 'date_naissance',  label: 'Date de naissance', placeholder: '',             icon: Calendar, type: 'date' },
    { key: 'annee_naissance', label: 'Année (si pas de date)', placeholder: '1985',    icon: Calendar, type: 'number' },
    { key: 'genre',           label: 'Genre (M/F)',     placeholder: 'M',              icon: User },
    { key: 'ville',           label: 'Ville',           placeholder: 'Paris',          icon: MapPin },
    { key: 'code_postal',     label: 'Code postal',     placeholder: '75001',          icon: MapPin },
    { key: 'departement',     label: 'Département',     placeholder: '75',             icon: MapPin },
    { key: 'email',           label: 'Email',           placeholder: 'jean@email.com', icon: Mail },
    { key: 'telephone',       label: 'Téléphone',       placeholder: '+33612345678',   icon: Phone },
    { key: 'mobile',          label: 'Mobile',          placeholder: '0612345678',     icon: Phone },
    { key: 'nir',             label: 'NIR (sécu sociale)', placeholder: '13 ou 15 chiffres', icon: Hash },
    { key: 'iban',            label: 'IBAN',            placeholder: 'FR76…',          icon: Hash },
    { key: 'siret',           label: 'SIRET',           placeholder: '14 chiffres',    icon: Hash },
    { key: 'siren',           label: 'SIREN',           placeholder: '9 chiffres',     icon: Hash },
    { key: 'nom_utilisateur', label: 'Nom d\'utilisateur', placeholder: 'johndoe',     icon: AtSign },
    { key: 'societe',         label: 'Société',         placeholder: 'Acme Corp',      icon: User },
    { key: 'profession',      label: 'Profession',      placeholder: 'Développeur',    icon: User },
    { key: 'immatriculation', label: 'Immatriculation', placeholder: 'AB-123-CD',      icon: Hash },
  ];

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
        {fields.map(f => {
          const Icon = f.icon;
          return (
            <label key={f.key} className="block">
              <span className="block mb-1 text-[10px] uppercase tracking-wider text-muted-foreground/80 font-semibold flex items-center gap-1">
                <Icon className="w-2.5 h-2.5" /> {f.label}
              </span>
              <input
                type={f.type || 'text'}
                value={(identity[f.key] as string | undefined) || ''}
                onChange={setField(f.key)}
                onKeyDown={e => { if (e.key === 'Enter' && !running) onRun(); }}
                placeholder={f.placeholder}
                className="w-full bg-black/30 border border-white/10 rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-500/40"
              />
            </label>
          );
        })}
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <button onClick={onRun} disabled={running || !queries.length}
          className="aegis-btn-primary text-primary-foreground px-4 py-2 rounded-lg text-xs font-semibold flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed">
          {running ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Zap className="w-3.5 h-3.5" />}
          {running ? 'Recherche en cours…' : `Lancer la recherche${queries.length ? ` (${queries.length} requête${queries.length > 1 ? 's' : ''})` : ''}`}
        </button>

        {queries.length > 0 && (
          <div className="text-[11px] text-muted-foreground">
            {queries.map(q => q.label).join(' · ')}
          </div>
        )}
        {!queries.length && (
          <div className="text-[11px] text-amber-400 flex items-center gap-1.5">
            <ShieldAlert className="w-3 h-3" /> Renseigne au moins un critère (nom+prénom, email, téléphone ou username)
          </div>
        )}
      </div>
    </div>
  );
}

function FindingCard({ finding: f }: { finding: Finding }) {
  const t = CATEGORY_TONE[f.category];
  const Icon = t.icon;
  const statusDot =
    f.status === 'pending' ? 'bg-amber-400 aegis-pulse' :
    f.status === 'ok'      ? 'bg-emerald-400' :
    f.status === 'empty'   ? 'bg-zinc-500' :
                              'bg-rose-400';
  const [open, setOpen] = useState(true);

  return (
    <div className="aegis-card aegis-card-edge aegis-lift overflow-hidden">
      <button onClick={() => setOpen(!open)}
        className="w-full px-4 py-3 flex items-center gap-3 text-left">
        <div className={`w-9 h-9 rounded-lg ${t.bg} ring-1 ${t.ring} flex items-center justify-center flex-shrink-0`}>
          <Icon className={`w-4 h-4 ${t.text}`} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className={`w-1.5 h-1.5 rounded-full ${statusDot} flex-shrink-0`} />
            <p className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold truncate">{f.source}</p>
            {f.durationMs != null && (
              <span className="text-[9px] text-muted-foreground/50 font-mono ml-auto">{Math.round(f.durationMs)}ms</span>
            )}
          </div>
          <p className="text-sm text-foreground font-medium truncate mt-0.5">{f.title}</p>
          {f.detail && <p className="text-[11px] text-muted-foreground truncate">{f.detail}</p>}
        </div>
        <ChevronRight className={`w-4 h-4 text-muted-foreground/50 transition-transform ${open ? 'rotate-90' : ''}`} />
      </button>

      {open && f.profiles && f.profiles.length > 0 && (
        <div className="px-4 pb-4 pt-1 border-t border-white/5 space-y-3">
          {f.profiles.map((p, i) => (
            <BrixProfileCard key={i} profile={p} siblings={f.profiles} />
          ))}
        </div>
      )}

      {open && f.rows && f.rows.length > 0 && (
        <div className="px-4 pb-3 pt-1 border-t border-white/5">
          <div className="rounded-md bg-white/[0.02] border border-white/5 divide-y divide-white/5 max-h-64 overflow-y-auto">
            {f.rows.map((r, i) => (
              <div key={i} className="flex items-center gap-3 px-3 py-1.5">
                <span className="text-[10px] uppercase tracking-wider text-muted-foreground/70 font-semibold w-16 flex-shrink-0">{r.label}</span>
                {r.href ? (
                  <a href={r.href} target="_blank" rel="noopener noreferrer"
                    className={`text-xs flex-1 break-all text-indigo-300 hover:text-indigo-200 inline-flex items-center gap-1 ${r.mono ? 'font-mono' : ''}`}>
                    <span className="truncate">{r.value}</span>
                    <ExternalLink className="w-3 h-3 opacity-60 flex-shrink-0" />
                  </a>
                ) : (
                  <span className={`text-xs flex-1 break-all text-foreground ${r.mono ? 'font-mono' : ''}`}>{r.value}</span>
                )}
              </div>
            ))}
          </div>
          {f.link && (
            <a href={f.link.href} target="_blank" rel="noopener noreferrer"
              className="mt-2 inline-flex items-center gap-1.5 text-[11px] border border-white/10 hover:border-indigo-500/40 hover:bg-indigo-500/10 text-muted-foreground hover:text-foreground rounded-md px-2.5 py-1 transition-all">
              {f.link.label} <ExternalLink className="w-3 h-3 opacity-60" />
            </a>
          )}
        </div>
      )}
    </div>
  );
}

// ── BrixHub profile detailed card ──────────────────────────────────────────
// Renders a full profile (style proche de la page /search de brixhub.net) :
// header avec initiale + nom complet + sources + score, puis grid de tous les
// champs renseignés. Met l'accent sur les coordonnées avec des "pills".

const FIELD_LABELS: Record<string, string> = {
  nom_famille: 'Nom', prenom: 'Prénom', nom_naissance: 'Nom de naissance',
  nom_affichage: 'Pseudo', nom_utilisateur: 'Username',
  date_naissance: 'Naissance', annee_naissance: 'Année',
  jour_naissance: 'Jour', mois_naissance: 'Mois',
  genre: 'Genre', civilite: 'Civilité',
  email: 'Email', telephone: 'Téléphone', mobile: 'Mobile', adresse_ip: 'IP',
  adresse: 'Adresse', complement_adresse: 'Complément',
  code_postal: 'Code postal', ville: 'Ville', ville_naissance: 'Ville naissance',
  lieu_naissance: 'Lieu naissance', pays: 'Pays', region: 'Région', departement: 'Département',
  nir: 'NIR', iban: 'IBAN', bic: 'BIC', siret: 'SIRET', siren: 'SIREN',
  vin_plaque: 'VIN/Plaque', immatriculation: 'Immatriculation',
  numero_serie: 'N° série', marque: 'Marque', modele: 'Modèle',
  societe: 'Société', profession: 'Profession', fonction: 'Fonction',
};

const FIELD_GROUPS: { title: string; keys: string[] }[] = [
  { title: 'Identité', keys: ['nom_famille', 'prenom', 'nom_naissance', 'nom_affichage', 'nom_utilisateur', 'date_naissance', 'annee_naissance', 'jour_naissance', 'mois_naissance', 'genre', 'civilite'] },
  { title: 'Adresse',  keys: ['adresse', 'complement_adresse', 'code_postal', 'ville', 'departement', 'region', 'pays', 'lieu_naissance', 'ville_naissance'] },
  { title: 'Identifiants', keys: ['nir', 'iban', 'bic', 'siret', 'siren'] },
  { title: 'Véhicule', keys: ['vin_plaque', 'immatriculation', 'numero_serie', 'marque', 'modele'] },
  { title: 'Pro',      keys: ['societe', 'profession', 'fonction'] },
];

// Detect a "family-style" link between two profiles based on shared fields.
// Returns null when no link is detectable.
function detectRelation(a: any, b: any): { label: string; tone: string } | null {
  if (a === b) return null;
  const norm = (v: any) => (v == null ? '' : String(v).trim().toLowerCase());

  if (a.adresse && norm(a.adresse) === norm(b.adresse)
      && norm(a.code_postal) === norm(b.code_postal)
      && norm(a.ville) === norm(b.ville)) {
    return { label: 'Même foyer', tone: 'text-emerald-300 bg-emerald-500/10 ring-emerald-500/30' };
  }
  const aPhones = [a.telephone, a.mobile].filter(Boolean).map(norm);
  const bPhones = [b.telephone, b.mobile].filter(Boolean).map(norm);
  if (aPhones.some(p => bPhones.includes(p))) {
    return { label: 'Même téléphone', tone: 'text-cyan-300 bg-cyan-500/10 ring-cyan-500/30' };
  }
  if (a.email && norm(a.email) === norm(b.email)) {
    return { label: 'Même email', tone: 'text-violet-300 bg-violet-500/10 ring-violet-500/30' };
  }
  if (a.iban && norm(a.iban) === norm(b.iban)) {
    return { label: 'Même IBAN', tone: 'text-amber-300 bg-amber-500/10 ring-amber-500/30' };
  }
  if (a.nom_famille && norm(a.nom_famille) === norm(b.nom_famille)
      && norm(a.ville) === norm(b.ville)) {
    return { label: 'Même nom · même ville', tone: 'text-indigo-300 bg-indigo-500/10 ring-indigo-500/30' };
  }
  return null;
}

// Map a BrixHub profile to the persons-table payload (PersonInput).
function brixToFiche(p: any): Record<string, any> | { error: string } {
  if (!p.nom_famille || !p.prenom || !p.date_naissance) {
    return { error: 'Champs requis manquants : nom, prénom, date de naissance.' };
  }
  return {
    nom:            String(p.nom_famille).toUpperCase().slice(0, 80),
    prenom:         String(p.prenom).slice(0, 80),
    genre:          p.genre || (p.civilite === 'Mme' || p.civilite === 'Mlle' ? 'F' : null),
    date_naissance: String(p.date_naissance).slice(0, 10), // YYYY-MM-DD
    adresse:        p.adresse || null,
    complement:     p.complement_adresse || null,
    code_postal:    p.code_postal ? String(p.code_postal).split('.')[0] : null,
    ville:          p.ville || null,
    email_alloc:    p.email || null,
    tel_alloc:      p.mobile || p.telephone || null,
    iban:           p.iban || null,
    bic:            p.bic  || null,
    categorie:      p.profession || p.fonction || null,
    notes:          [
      Array.isArray(p._sources) ? `Sources : ${p._sources.join(', ')}` : null,
      p._confidence != null ? `Confiance : ${p._confidence}%` : null,
      p.lieu_naissance ? `Lieu de naissance : ${p.lieu_naissance}` : null,
      p.nom_naissance && p.nom_naissance !== p.nom_famille ? `Nom de naissance : ${p.nom_naissance}` : null,
      p.nir ? `NIR : ${p.nir}` : null,
      p.siret ? `SIRET : ${p.siret}` : null,
      p.societe ? `Société : ${p.societe}` : null,
    ].filter(Boolean).join('\n') || null,
  };
}

function BrixProfileCard({ profile: p, siblings, compact = false }: { profile: any; siblings?: any[]; compact?: boolean }) {
  const [copied, setCopied]   = useState<string | null>(null);
  const [adding, setAdding]   = useState(false);
  const [added, setAdded]     = useState(false);
  const [extra, setExtra]     = useState<any[]>([]);
  const [enriching, setEnriching] = useState(false);
  const [enriched, setEnriched]   = useState(false);

  const fullName = [p.prenom, p.nom_famille].filter(Boolean).join(' ').trim()
    || p.nom_affichage || p.nom_utilisateur || 'Profil';
  const initials = (fullName || '?').slice(0, 1).toUpperCase();
  const sources: string[]    = Array.isArray(p._sources) ? p._sources : [];
  const confidence: number   = typeof p._confidence === 'number' ? p._confidence : 0;

  // ── Foyer / family enrichment ────────────────────────────────────────────
  // Volontairement frugal côté quota : 1 à 2 appels /search max (jamais de
  // reverse-lookup payant en plus). On privilégie l'adresse pour le foyer ;
  // on retombe sur "nom de famille + ville" si pas d'adresse exploitable.
  const enrich = async () => {
    if (enriching) return;

    // Build the planned tasks (at most 2 calls).
    type Task = { label: string; params: any };
    const planned: Task[] = [];
    if (p.adresse && p.ville) {
      planned.push({
        label: `foyer @ ${p.adresse}, ${p.ville}`,
        params: { adresse: p.adresse, ville: p.ville, code_postal: p.code_postal },
      });
    }
    if (p.nom_famille && p.ville) {
      planned.push({
        label: `nom ${p.nom_famille} @ ${p.ville}`,
        params: { nom_famille: p.nom_famille, ville: p.ville },
      });
    }

    if (!planned.length) {
      toast.info('Aucun identifiant exploitable pour approfondir (ni adresse, ni nom + ville).');
      setEnriched(true);
      return;
    }

    // Confirm quota cost when we can't tell if it'll hit the cache.
    const cost = planned.length;
    if (!confirm(
      `Approfondir le foyer ?\n\n` +
      `Cela lancera ${cost} requête${cost > 1 ? 's' : ''} BrixHub ` +
      `(une par critère partagé). Les résultats déjà connus depuis 24h ` +
      `seront servis depuis le cache (gratuit).\n\n` +
      planned.map(t => '• ' + t.label).join('\n')
    )) {
      return;
    }

    setEnriching(true);
    const arrays = await Promise.all(planned.map(async t => {
      try {
        const r = await apiPost<any>('/api/seek/search', { ...t.params, flexible: true, per_page: 100 });
        return r?.data?.data?.results || [];
      } catch (e: any) {
        toast.error(`Échec ${t.label}`, { description: e.message });
        return [];
      }
    }));
    const all = arrays.flat();

    // Dedupe by (prenom + nom_famille + date_naissance) and drop the current profile.
    const sig = (x: any) => `${(x.prenom || '').toLowerCase()}|${(x.nom_famille || '').toLowerCase()}|${x.date_naissance || ''}`;
    const selfSig = sig(p);
    const seen = new Set<string>([selfSig]);
    const deduped = all.filter(x => {
      const s = sig(x);
      if (seen.has(s)) return false;
      seen.add(s);
      return detectRelation(p, x) != null;
    });

    setExtra(deduped);
    setEnriching(false);
    setEnriched(true);
    toast.success(`Foyer : ${deduped.length} profil${deduped.length > 1 ? 's' : ''} lié${deduped.length > 1 ? 's' : ''}`);
  };

  // Detect related profiles in the same result set + enrichment results.
  const relations = useMemo(() => {
    const pool = [...(siblings || []), ...extra];
    return pool
      .map(s => {
        const link = detectRelation(p, s);
        return link ? { profile: s, link } : null;
      })
      .filter((x): x is { profile: any; link: { label: string; tone: string } } => x != null);
  }, [siblings, extra, p]);

  const addToFiches = async () => {
    const payload = brixToFiche(p);
    if ('error' in payload) {
      toast.error('Impossible d\'ajouter aux fiches', { description: payload.error });
      return;
    }
    setAdding(true);
    try {
      await fetch(API_URL + '/api/persons', {
        method: 'POST',
        headers: { Authorization: `Bearer ${getApiToken()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }).then(async r => {
        if (!r.ok) {
          let msg = `HTTP ${r.status}`;
          try { msg = (await r.json()).error || msg; } catch {}
          throw new Error(msg);
        }
      });
      setAdded(true);
      toast.success(`Fiche créée · ${fullName}`);
    } catch (e: any) {
      toast.error('Erreur lors de la création', { description: e.message });
    } finally {
      setAdding(false);
    }
  };
  const confTone =
    confidence >= 80 ? 'text-emerald-400 ring-emerald-500/40 bg-emerald-500/10' :
    confidence >= 50 ? 'text-amber-400   ring-amber-500/40   bg-amber-500/10'   :
                       'text-rose-400    ring-rose-500/40    bg-rose-500/10';

  const copy = (k: string, v: string) => {
    navigator.clipboard.writeText(v);
    setCopied(k);
    setTimeout(() => setCopied(null), 1200);
    toast.success(`${FIELD_LABELS[k] || k} copié`);
  };

  // All keys present in the profile that we want to display, in canonical
  // group order. Keys not in any group go into "Autres".
  const knownKeys = new Set(FIELD_GROUPS.flatMap(g => g.keys));
  const otherKeys = Object.keys(p)
    .filter(k => !knownKeys.has(k) && !k.startsWith('_') && p[k] != null && p[k] !== '');

  // Quick contact pills (most important: phone/email/ip).
  const pills: { icon: any; label: string; value: string; tone: string }[] = [];
  if (p.email)       pills.push({ icon: Mail,   label: p.email,       value: p.email,       tone: 'text-violet-300 bg-violet-500/10 ring-violet-500/30' });
  if (p.telephone)   pills.push({ icon: Phone,  label: p.telephone,   value: p.telephone,   tone: 'text-cyan-300 bg-cyan-500/10 ring-cyan-500/30' });
  if (p.mobile && p.mobile !== p.telephone)
                     pills.push({ icon: Phone,  label: p.mobile,      value: p.mobile,      tone: 'text-cyan-300 bg-cyan-500/10 ring-cyan-500/30' });
  if (p.adresse_ip)  pills.push({ icon: Globe,  label: p.adresse_ip,  value: p.adresse_ip,  tone: 'text-emerald-300 bg-emerald-500/10 ring-emerald-500/30' });

  return (
    <div className="rounded-xl bg-white/[0.02] border border-white/10 overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 bg-gradient-to-r from-indigo-500/[0.08] to-transparent border-b border-white/5">
        <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-indigo-500/30 to-violet-500/10 ring-1 ring-indigo-500/40 flex items-center justify-center font-bold text-indigo-200 text-lg flex-shrink-0">
          {initials}
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-base font-bold text-foreground tracking-tight truncate">{fullName}</h3>
          {sources.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-0.5">
              {sources.map((s, i) => (
                <span key={i} className="text-[10px] px-1.5 py-0.5 rounded-md bg-white/5 text-muted-foreground border border-white/5 font-mono">
                  {s}
                </span>
              ))}
            </div>
          )}
        </div>
        {confidence > 0 && (
          <div className={`flex flex-col items-center gap-0.5 px-3 py-1.5 rounded-lg ring-1 ${confTone}`}>
            <span className="text-base font-bold tabular-nums leading-none">{confidence}%</span>
            <span className="text-[9px] uppercase tracking-wider opacity-80">Confiance</span>
          </div>
        )}

        <button onClick={addToFiches} disabled={adding || added}
          title={added ? 'Déjà ajoutée' : 'Créer une fiche à partir de ce profil'}
          className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold transition-all flex-shrink-0 ${
            added
              ? 'bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/30 cursor-default'
              : 'aegis-btn-primary text-primary-foreground hover:scale-105 disabled:opacity-50 disabled:cursor-not-allowed'
          }`}>
          {adding ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
            : added ? <Check className="w-3.5 h-3.5" />
                   : <UserPlus className="w-3.5 h-3.5" />}
          {added ? 'Ajoutée' : adding ? 'Ajout…' : 'Ajouter aux fiches'}
        </button>
      </div>

      {/* Quick contact pills */}
      {pills.length > 0 && (
        <div className="flex flex-wrap gap-1.5 px-4 py-3 border-b border-white/5">
          {pills.map((pi, i) => {
            const Icon = pi.icon;
            return (
              <button key={i} onClick={() => { navigator.clipboard.writeText(pi.value); toast.success('Copié'); }}
                className={`inline-flex items-center gap-1.5 text-[11px] px-2 py-1 rounded-md ring-1 ${pi.tone} font-mono hover:opacity-80 transition-opacity`}>
                <Icon className="w-3 h-3" />
                {pi.label}
              </button>
            );
          })}
        </div>
      )}

      {/* Field groups */}
      <div className="p-4 space-y-3">
        {FIELD_GROUPS.map(group => {
          const present = group.keys.filter(k => p[k] != null && p[k] !== '');
          if (!present.length) return null;
          return (
            <div key={group.title}>
              <h4 className="text-[10px] uppercase tracking-wider text-muted-foreground/70 font-semibold mb-1.5">{group.title}</h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-4 gap-y-1.5 bg-black/30 rounded-lg border border-white/5 p-3">
                {present.map(k => (
                  <button key={k} onClick={() => copy(k, String(p[k]))}
                    className="flex items-baseline gap-2 text-left group">
                    <span className="text-[10px] uppercase tracking-wider text-muted-foreground/70 font-semibold w-24 flex-shrink-0">{FIELD_LABELS[k] || k}</span>
                    <span className="text-xs text-foreground font-mono break-all flex-1">{String(p[k])}</span>
                    {copied === k
                      ? <Check className="w-3 h-3 text-emerald-400 flex-shrink-0" />
                      : <Copy className="w-3 h-3 text-muted-foreground/0 group-hover:text-muted-foreground flex-shrink-0 transition-colors" />}
                  </button>
                ))}
              </div>
            </div>
          );
        })}

        {otherKeys.length > 0 && (
          <div>
            <h4 className="text-[10px] uppercase tracking-wider text-muted-foreground/70 font-semibold mb-1.5">Autres</h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-4 gap-y-1.5 bg-black/30 rounded-lg border border-white/5 p-3">
              {otherKeys.map(k => (
                <div key={k} className="flex items-baseline gap-2">
                  <span className="text-[10px] uppercase tracking-wider text-muted-foreground/70 font-semibold w-24 flex-shrink-0">{k}</span>
                  <span className="text-xs text-foreground font-mono break-all flex-1">{String(p[k])}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Family-style relations: shown when we have any link or once enriched */}
      {!compact && (
      <div className="px-4 pb-4 border-t border-white/5 pt-3">
        <div className="flex items-center justify-between mb-2 gap-2">
          <h4 className="text-[10px] uppercase tracking-wider text-muted-foreground/70 font-semibold flex items-center gap-1.5">
            <Network className="w-3 h-3" /> Liens familiaux ({relations.length})
          </h4>
          <button onClick={enrich} disabled={enriching || enriched}
            title="Recherche les profils partageant adresse, téléphone, email, IBAN ou nom + ville"
            className={`text-[10px] uppercase tracking-wider px-2 py-1 rounded-md font-semibold transition-all ${
              enriched
                ? 'bg-emerald-500/10 text-emerald-400 ring-1 ring-emerald-500/30 cursor-default'
                : 'bg-indigo-500/10 text-indigo-300 ring-1 ring-indigo-500/30 hover:bg-indigo-500/20 disabled:opacity-50 disabled:cursor-wait'
            }`}>
            {enriching
              ? <span className="flex items-center gap-1"><Loader2 className="w-2.5 h-2.5 animate-spin" /> Analyse…</span>
              : enriched ? '✓ Foyer scanné' : 'Approfondir le foyer'}
          </button>
        </div>

        {relations.length === 0 && !enriching && (
          <p className="text-[11px] text-muted-foreground/70 italic">
            {enriched
              ? 'Aucun profil lié trouvé via adresse/téléphone/email/IBAN/nom.'
              : 'Clique sur « Approfondir le foyer » pour chercher les profils liés (adresse, téléphone, email, IBAN, nom + ville).'}
          </p>
        )}

        {relations.length > 0 && (
          <div className="space-y-1.5">
            {relations.map((rel, i) => (
              <RelationRow key={i} relation={rel} />
            ))}
          </div>
        )}
      </div>
      )}
    </div>
  );
}

// Expandable family-link row: header summary + click-to-expand detailed card.
function RelationRow({ relation }: { relation: { profile: any; link: { label: string; tone: string } } }) {
  const [open, setOpen] = useState(false);
  const r = relation.profile;
  const rName = [r.prenom, r.nom_famille].filter(Boolean).join(' ').trim() || 'Profil';
  const rInit = (rName || '?').slice(0, 1).toUpperCase();
  const rConf = typeof r._confidence === 'number' ? r._confidence : null;
  const subtitle = [
    r.date_naissance,
    r.adresse,
    r.ville,
    r.email,
    r.telephone || r.mobile,
  ].filter(Boolean).slice(0, 3).join(' · ');

  return (
    <div className="rounded-lg bg-black/30 border border-white/5 hover:border-white/10 transition-colors overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-2.5 px-3 py-2 text-left">
        <div className="w-7 h-7 rounded-md bg-white/5 ring-1 ring-white/10 flex items-center justify-center text-xs font-bold text-muted-foreground flex-shrink-0">
          {rInit}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-semibold text-foreground truncate">{rName}</span>
            <span className={`text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded ring-1 ${relation.link.tone} font-semibold`}>
              {relation.link.label}
            </span>
            {rConf != null && (
              <span className="text-[10px] text-muted-foreground/70 tabular-nums">{rConf}%</span>
            )}
          </div>
          {subtitle && (
            <p className="text-[10px] text-muted-foreground truncate font-mono mt-0.5">{subtitle}</p>
          )}
        </div>
        <ChevronRight className={`w-3.5 h-3.5 text-muted-foreground/50 transition-transform flex-shrink-0 ${open ? 'rotate-90' : ''}`} />
      </button>
      {open && (
        <div className="px-2 pb-2 pt-1 border-t border-white/5">
          <BrixProfileCard profile={r} compact />
        </div>
      )}
    </div>
  );
}
