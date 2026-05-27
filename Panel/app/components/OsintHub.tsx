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
  Radio, Lock, Unlock, Activity, User, Calendar, UserPlus, KeyRound,
  X, GitBranch, Table2, Filter,
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
type Kind = 'ip' | 'domain' | 'email' | 'phone' | 'hash' | 'discord' | 'username' | 'name';

interface Detection { kind: Kind; value: string; confidence: number; label: string; icon: any }

function detect(raw: string): Detection[] {
  const q = raw.trim();
  if (!q) return [];
  // Strip leading "@" pour les handles type @user — on la rajoutera côté
  // affichage seulement.
  const stripped = q.replace(/^@+/, '');
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

  // Username — accepte aussi `.` (TikTok, Instagram) et `-` ; strip le `@`
  // initial. Confidence haute si l'input commence par `@`.
  if (/^[a-zA-Z0-9_.-]{3,32}$/.test(stripped) && !/^\d+$/.test(stripped) && !/^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(stripped)) {
    const conf = q.startsWith('@') ? 0.85 : 0.5;
    out.push({ kind: 'username', value: stripped, confidence: conf, label: q.startsWith('@') ? 'Username (@handle)' : 'Username (réseaux sociaux)', icon: AtSign });
  }

  // Nom + prénom (ou identité libre). Détection : 2+ mots de lettres
  // (majuscules/minuscules, accents, traits d'union), 3-80 caractères au
  // total, pas un domaine/email/etc.
  if (
    out.every(d => d.kind !== 'email' && d.kind !== 'domain') &&
    /^[\p{L}][\p{L}\s'.-]{2,79}$/u.test(q) &&
    /\s/.test(q) &&
    q.split(/\s+/).filter(Boolean).length >= 2 &&
    q.split(/\s+/).filter(Boolean).length <= 4
  ) {
    out.push({ kind: 'name', value: q, confidence: 0.7, label: 'Nom & prénom', icon: User });
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
  /** Raw profiles — rendered as detailed cards. Shape dépend du provider. */
  profiles?: any[];
  /** Provider d'origine pour router vers le bon renderer. */
  provider?: 'brixhub' | 'seeknow';
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
          provider: 'brixhub',
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
          provider: 'brixhub',
          durationMs: performance.now() - t0,
        };
      } catch (e: any) {
        return errorFinding('brix-lookup-phone', 'BrixHub · lookup téléphone', 'identity', e.message, performance.now() - t0);
      }
    },
  },

  // ── SeekNow runners (mode unique) ───────────────────────────────────────
  // Chaque kind reçoit ses endpoints SeekNow pertinents. Le rendu utilise
  // SeeknowProfileCard via le routing par `provider`.
  ...((): { id: string; appliesTo: Kind[]; run: Runner }[] => {
    type SkSpec = {
      id: string;
      kind: Kind;
      label: string;
      key: string;        // SEEKNOW_CATALOG key
      category: Finding['category'];
      build: (v: string) => any;
      list: (data: any) => any[];
    };
    const specs: SkSpec[] = [
      // Email
      { id: 'sk-search-email',  kind: 'email', key: 'search',         label: 'SeekNow · breach search',  category: 'breach',
        build: v => ({ query: v, type: 'email', limit: 100 }), list: d => d?.results || [] },
      { id: 'sk-email-check',   kind: 'email', key: 'network_email',  label: 'SeekNow · email check',    category: 'reputation',
        build: v => ({ email: v }), list: d => d ? [d] : [] },
      // Phone
      { id: 'sk-search-phone',  kind: 'phone', key: 'search',         label: 'SeekNow · breach search',  category: 'breach',
        build: v => ({ query: v, type: 'phone', limit: 100 }), list: d => d?.results || [] },
      { id: 'sk-phone',         kind: 'phone', key: 'network_phone',  label: 'SeekNow · phone OSINT',    category: 'identity',
        build: v => ({ phone: v }), list: d => d ? [d] : [] },
      // Username
      { id: 'sk-search-user',   kind: 'username', key: 'search',          label: 'SeekNow · breach search',  category: 'breach',
        build: v => ({ query: v, type: 'username', limit: 100 }), list: d => d?.results || [] },
      { id: 'sk-username-soc',  kind: 'username', key: 'username_social',  label: 'SeekNow · réseaux sociaux', category: 'social',
        build: v => ({ username: v }), list: d => d?.found_on || [] },
      { id: 'sk-username-hist', kind: 'username', key: 'username_history', label: 'SeekNow · historique',      category: 'identity',
        build: v => ({ username: v }), list: d => d?.history || [] },
      // IP
      { id: 'sk-network-ip',    kind: 'ip', key: 'network_ip',        label: 'SeekNow · IP intel',       category: 'network',
        build: v => ({ ip: v }), list: d => d ? [d] : [] },
      { id: 'sk-search-ip',     kind: 'ip', key: 'search',            label: 'SeekNow · breach search',  category: 'breach',
        build: v => ({ query: v, type: 'ip', limit: 100 }), list: d => d?.results || [] },
      // Domain
      { id: 'sk-domain-intel',  kind: 'domain', key: 'domain_intel',  label: 'SeekNow · domain intel',   category: 'network',
        build: v => ({ domain: v }), list: d => d ? [d] : [] },
      { id: 'sk-domain-whois',  kind: 'domain', key: 'domain_whois',  label: 'SeekNow · WHOIS',          category: 'network',
        build: v => ({ domain: v }), list: d => d ? [d] : [] },
      // Discord
      { id: 'sk-discord-user',  kind: 'discord', key: 'discord_user',   label: 'SeekNow · Discord user',  category: 'identity',
        build: v => ({ discord_id: v }), list: d => d ? [d] : [] },
      { id: 'sk-discord-roblox',kind: 'discord', key: 'discord_roblox', label: 'SeekNow · Discord→Roblox', category: 'social',
        build: v => ({ discord_id: v }), list: d => d?.roblox ? [d.roblox] : (d ? [d] : []) },
      // Hash
      { id: 'sk-search-hash',   kind: 'hash', key: 'search',         label: 'SeekNow · breach search',  category: 'breach',
        build: v => ({ query: v, type: 'hash', limit: 100 }), list: d => d?.results || [] },
    ];

    return specs.map(s => ({
      id: s.id,
      appliesTo: [s.kind],
      run: async (t) => {
        const t0 = performance.now();
        try {
          const spec = SEEKNOW_HTTP[s.key] || { method: 'POST' };
          const route = `/api/seeknow/${s.key}`;
          const res: any = spec.method === 'GET'
            ? await apiGet(`${route}?${new URLSearchParams(s.build(t.value)).toString()}`)
            : await apiPost(route, s.build(t.value));
          const list = s.list(res?.data);
          const cached = res?.cached === true;
          return {
            id: s.id, source: s.label, category: s.category,
            status: list.length ? 'ok' : 'empty',
            severity: list.length ? 'medium' : 'info',
            title: list.length
              ? `${list.length} résultat${list.length > 1 ? 's' : ''}${cached ? ' (cache)' : ''}`
              : 'Aucun résultat',
            profiles: list,
            provider: 'seeknow',
            durationMs: performance.now() - t0,
          };
        } catch (e: any) {
          return errorFinding(s.id, s.label, s.category, e.message, performance.now() - t0);
        }
      },
    }));
  })(),
];

// Cache local des methods HTTP par key SEEKNOW_CATALOG (évite un GET /catalog
// par appel). Mis à jour côté backend dans seeknow.ts ; on duplique ici les
// quelques entrées qui sont en GET pour router correctement.
const SEEKNOW_HTTP: Record<string, { method: 'GET' | 'POST' }> = {
  search:           { method: 'POST' },
  stealer:          { method: 'POST' },
  discord_user:     { method: 'GET'  },
  discord_roblox:   { method: 'GET'  },
  username_github:  { method: 'GET'  },
  username_twitter: { method: 'GET'  },
  username_tiktok:  { method: 'GET'  },
  username_reddit:  { method: 'GET'  },
  username_social:  { method: 'GET'  },
  username_history: { method: 'GET'  },
  network_ip:       { method: 'GET'  },
  network_email:    { method: 'GET'  },
  network_phone:    { method: 'GET'  },
  domain_intel:     { method: 'GET'  },
  domain_whois:     { method: 'GET'  },
  gaming_xbox:      { method: 'GET'  },
  gaming_roblox:    { method: 'GET'  },
  gaming_minecraft: { method: 'GET'  },
};

function errorFinding(id: string, source: string, category: Finding['category'], msg: string, ms: number): Finding {
  return { id, source, category, status: 'fail', severity: 'low', title: 'Échec', detail: msg, durationMs: ms };
}

/** Construit un lien Google Maps à partir d'une adresse libre. */
function gmapsUrl(...parts: (string | undefined | null)[]): string {
  const q = parts.filter(Boolean).join(', ').trim();
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
}

/** Concatène les fragments d'adresse en string utilisable. */
function joinAddress(...parts: (string | undefined | null)[]): string {
  return parts.filter(Boolean).join(', ').trim();
}

/**
 * Mini-carte d'adresse — embed Google Maps sans clé API (URL `?output=embed`).
 * Fonctionne avec n'importe quelle adresse texte ; Google se charge du géocodage.
 * Fallback : si l'iframe est bloquée (X-Frame-Options), on affiche un placeholder
 * cliquable.
 */
function OsintMap({ address, height = 220, label }: { address: string; height?: number; label?: string }) {
  if (!address.trim()) return null;
  const url     = `https://maps.google.com/maps?q=${encodeURIComponent(address)}&z=15&output=embed`;
  const fullUrl = gmapsUrl(address);
  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.02] overflow-hidden">
      <div className="px-3 py-2 flex items-center gap-2 border-b border-white/5">
        <MapPin className="w-3.5 h-3.5 text-rose-300 flex-shrink-0" />
        <span className="text-[11px] text-foreground font-mono truncate flex-1">{label || address}</span>
        <a href={fullUrl} target="_blank" rel="noopener noreferrer"
          className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded font-semibold text-indigo-300 hover:text-indigo-200 bg-indigo-500/10 hover:bg-indigo-500/20 ring-1 ring-indigo-500/30 inline-flex items-center gap-1 flex-shrink-0">
          Maps <ExternalLink className="w-3 h-3" />
        </a>
      </div>
      <iframe
        src={url}
        width="100%"
        height={height}
        loading="lazy"
        referrerPolicy="no-referrer-when-downgrade"
        style={{ border: 0, display: 'block' }}
        title={`Carte ${address}`}
      />
    </div>
  );
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

// ── Aggregated OSINT report (mirror du schema backend `osint.ts`) ──────────
interface ProviderStats {
  calls: number;
  cached: number;
  errors: number;
  credits_remaining: number | null;
  daily_limit: number | null;
}
interface AggregatedPerson {
  id: string;
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
  providers: ('brixhub' | 'seeknow')[];
  confidence: number;
  raw: { provider: 'brixhub' | 'seeknow'; profile: any }[];
}
interface BreachRecord {
  source: string;
  email?: string;
  username?: string;
  password?: string;
  ip_address?: string;
  name?: string;
  url?: string;
  extra: Record<string, any>;
}
interface SocialHit { platform: string; url?: string; profile?: Record<string, any> }
interface NetworkCheck {
  email?: { value: string; valid?: boolean; deliverable?: boolean; disposable?: boolean; breach_count?: number; raw: any };
  phone?: { value: string; country?: string; carrier?: string; line_type?: string; breach_count?: number; raw: any };
}
interface OsintTaskLog {
  provider: 'brixhub' | 'seeknow';
  endpoint: string;
  ok: boolean;
  cached: boolean;
  status: number | null;
  error?: string | null;
  duration_ms: number;
  cost: number;
}
interface OsintReport {
  query: IdentityForm;
  identities: AggregatedPerson[];
  breaches: BreachRecord[];
  social: SocialHit[];
  network: NetworkCheck;
  providers: { brixhub: ProviderStats; seeknow: ProviderStats };
  tasks: OsintTaskLog[];
  user_quota: { used: number; limit: number; tier: 'free' | 'premium' };
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
  const [osintReport, setOsintReport] = useState<OsintReport | null>(null);

  const detections = useMemo(() => detect(input), [input]);
  const multiQueries = useMemo(() => buildMultiQueries(identity), [identity]);

  // Fetch credit balance once
  useEffect(() => {
    apiGet<{ credits_remaining: number | null }>('/api/seek/catalog')
      .then(r => setCredits(r.credits_remaining))
      .catch(() => {});
  }, []);

  // ── Multi-criteria scan (agrégateur backend BrixHub + SeekNow) ─────────
  // Le backend `/api/osint/identity` fan-out les deux providers, normalise
  // les enveloppes et corrèle les profils par identifiants forts.
  const runMulti = async () => {
    if (!multiQueries.length) {
      toast.error('Renseigne au moins un critère');
      return;
    }
    setTarget({ kind: 'username', value: [identity.prenom, identity.nom_famille].filter(Boolean).join(' ') || 'identité', confidence: 1, label: 'Identité multi-critères', icon: User });
    setRunning(true);
    setFindings([]);
    setOsintReport(null);

    const t0 = performance.now();
    try {
      const report = await apiPost<OsintReport>('/api/osint/identity', identity);
      setOsintReport(report);
      if (report.providers?.brixhub?.credits_remaining != null) {
        setCredits(report.providers.brixhub.credits_remaining);
      }
      const took = Math.round(performance.now() - t0);
      const idn  = report.identities.length;
      const brc  = report.breaches.length;
      const soc  = report.social.length;
      toast.success(
        `Rapport prêt · ${idn} identité${idn > 1 ? 's' : ''} · ${brc} brèche${brc > 1 ? 's' : ''} · ${soc} social · ${took} ms`
      );
    } catch (e: any) {
      toast.error('Recherche échouée', { description: e.message });
    } finally {
      setRunning(false);
    }
  };

  const runScan = async (det: Detection) => {
    setTarget(det);
    setRunning(true);
    setFindings([]);
    setOsintReport(null);

    // ── Cas "Nom & prénom" ──────────────────────────────────────────────
    // On délègue à l'agrégateur backend qui sait construire le bon plan
    // d'appels (BrixHub /search structuré + SeekNow /search texte libre).
    // Le rendu utilise la même vue unifiée que le mode multi-critères.
    if (det.kind === 'name') {
      const parts = det.value.trim().split(/\s+/);
      // Heuristique simple : 1er token = prénom, le reste = nom de famille.
      // (BrixHub reste tolérant grâce à `flexible: true` côté serveur.)
      const prenom      = parts[0];
      const nom_famille = parts.slice(1).join(' ');
      try {
        const report = await apiPost<OsintReport>('/api/osint/identity', { prenom, nom_famille, flexible: true });
        setOsintReport(report);
        if (report.providers?.brixhub?.credits_remaining != null) {
          setCredits(report.providers.brixhub.credits_remaining);
        }
        const idn = report.identities.length;
        const brc = report.breaches.length;
        toast.success(`Recherche identité · ${idn} identité${idn > 1 ? 's' : ''} · ${brc} brèche${brc > 1 ? 's' : ''}`);
      } catch (e: any) {
        toast.error('Recherche échouée', { description: e.message });
      } finally {
        setRunning(false);
      }
      return;
    }

    // ── Autres kinds : runners parallèles classiques ────────────────────
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

          {/* Synthesis row: provider breakdown + category counts + total profiles */}
          <FindingsSummary findings={findings} />

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

      {/* Aggregated OSINT report (multi-criteria mode) */}
      {osintReport && (
        <OsintReportView report={osintReport} />
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

// ── Single-mode summary row : récapitule les findings par provider et ─────
//    catégorie. Le détail reste dans les cartes en-dessous.
function FindingsSummary({ findings }: { findings: Finding[] }) {
  if (!findings.length) return null;
  const totalProfiles = findings.reduce((acc, f) => acc + (f.profiles?.length || 0), 0);
  const cached = findings.filter(f => f.detail?.includes('cache')).length;

  const byProvider = {
    brixhub: findings.filter(f => f.provider === 'brixhub'),
    seeknow: findings.filter(f => f.provider === 'seeknow'),
    other:   findings.filter(f => !f.provider),
  };
  const okOf = (arr: Finding[]) => arr.filter(f => f.status === 'ok').length;
  const profOf = (arr: Finding[]) => arr.reduce((a, f) => a + (f.profiles?.length || 0), 0);

  const cats: Record<string, number> = {};
  for (const f of findings) {
    if (f.status !== 'ok') continue;
    cats[f.category] = (cats[f.category] || 0) + 1;
  }

  const Pill = ({ tone, label, value }: { tone: string; label: string; value: React.ReactNode }) => (
    <span className={`inline-flex items-center gap-1.5 text-[11px] px-2 py-1 rounded-md ring-1 ${tone}`}>
      <span className="opacity-70 uppercase tracking-wider text-[9px] font-bold">{label}</span>
      <span className="font-semibold tabular-nums">{value}</span>
    </span>
  );

  return (
    <div className="rounded-lg border border-white/5 bg-white/[0.02] p-3 flex flex-wrap items-center gap-2">
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground/70 font-semibold mr-1">Synthèse</span>
      <Pill tone="bg-white/[0.03] text-foreground ring-white/10"        label="Profils"  value={totalProfiles} />
      {cached > 0 && (
        <Pill tone="bg-emerald-500/10 text-emerald-300 ring-emerald-500/30" label="Cache" value={`${cached}/${findings.length}`} />
      )}
      {byProvider.brixhub.length > 0 && (
        <Pill tone="bg-indigo-500/10 text-indigo-300 ring-indigo-500/30"
          label="BrixHub" value={`${okOf(byProvider.brixhub)}/${byProvider.brixhub.length} · ${profOf(byProvider.brixhub)} profil${profOf(byProvider.brixhub) > 1 ? 's' : ''}`} />
      )}
      {byProvider.seeknow.length > 0 && (
        <Pill tone="bg-emerald-500/10 text-emerald-300 ring-emerald-500/30"
          label="SeekNow" value={`${okOf(byProvider.seeknow)}/${byProvider.seeknow.length} · ${profOf(byProvider.seeknow)} résultat${profOf(byProvider.seeknow) > 1 ? 's' : ''}`} />
      )}
      {byProvider.other.length > 0 && (
        <Pill tone="bg-violet-500/10 text-violet-300 ring-violet-500/30"
          label="OSINT public" value={`${okOf(byProvider.other)}/${byProvider.other.length}`} />
      )}
      {Object.keys(cats).length > 0 && (
        <span className="text-[10px] text-muted-foreground/70 ml-auto flex flex-wrap gap-1.5">
          {Object.entries(cats).map(([k, v]) => (
            <span key={k} className="px-1.5 py-0.5 rounded bg-white/[0.03] ring-1 ring-white/5">
              <span className="opacity-60">{k}</span>
              <span className="ml-1 font-semibold text-foreground">{v}</span>
            </span>
          ))}
        </span>
      )}
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
            f.provider === 'seeknow'
              ? <SeeknowProfileCard key={i} profile={p} />
              : <BrixProfileCard key={i} profile={p} siblings={f.profiles} />
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

// ── OSINT report view (mode multi-critères, agrégation BrixHub + SeekNow) ──
// Cette vue est l'unique consommateur de l'enveloppe `OsintReport` produite
// par le backend (`backend/src/osint.ts`). Elle remplace les N cartes par-
// provider d'avant et regroupe par sections fonctionnelles :
//   1. Synthèse (compteurs, providers, quotas)
//   2. Identités corrélées (BrixHub + hints SeekNow)
//   3. Brèches (SeekNow /search)
//   4. Réseaux sociaux (SeekNow /username/social)
//   5. Vérifications email/téléphone (SeekNow /network/*)
//   6. Audit des appels (debug, repliable)
function OsintReportView({ report }: { report: OsintReport }) {
  const [showTasks, setShowTasks] = useState(false);
  // Data Explorer state : { query, type } ou null si fermé. La modale est
  // montée à la racine du report → un seul lieu, plusieurs entrées (boutons
  // sur la section Brèches + sur les Vérifications email/phone).
  const [explorer, setExplorer] = useState<{ query: string; type?: 'email' | 'phone' | 'username' | 'ip' | 'hash' } | null>(null);
  // Identifiant principal pour le Data Explorer global (priorité : email >
  // phone > username > nom complet). Sert au bouton dans l'entête Brèches.
  const primaryQuery: { value: string; type?: 'email' | 'phone' | 'username' } | null = (() => {
    const q = report.query;
    if (q.email)             return { value: q.email,         type: 'email' };
    if (q.telephone)         return { value: q.telephone,     type: 'phone' };
    if (q.mobile)            return { value: q.mobile,        type: 'phone' };
    if (q.nom_utilisateur)   return { value: q.nom_utilisateur, type: 'username' };
    const fullName = [q.prenom, q.nom_famille].filter(Boolean).join(' ').trim();
    if (fullName) return { value: fullName };
    return null;
  })();

  const totalCalls    = report.providers.brixhub.calls + report.providers.seeknow.calls;
  const totalCached   = report.providers.brixhub.cached + report.providers.seeknow.cached;
  const totalErrors   = report.providers.brixhub.errors + report.providers.seeknow.errors;
  const cachePct      = totalCalls > 0 ? Math.round((totalCached / totalCalls) * 100) : 0;

  const Stat = ({ label, value, tone = 'neutral' }: { label: string; value: React.ReactNode; tone?: 'neutral' | 'good' | 'warn' | 'danger' }) => {
    const cls = tone === 'good'  ? 'text-emerald-300'
              : tone === 'warn'  ? 'text-amber-300'
              : tone === 'danger'? 'text-rose-300'
              : 'text-foreground';
    return (
      <div className="rounded-lg border border-white/5 bg-white/[0.02] p-3">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground/70 font-semibold">{label}</div>
        <div className={`text-lg font-semibold mt-0.5 ${cls}`}>{value}</div>
      </div>
    );
  };

  const ProviderBadge = ({ p }: { p: 'brixhub' | 'seeknow' }) => (
    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] uppercase tracking-wider font-bold ${
      p === 'brixhub' ? 'bg-indigo-500/15 text-indigo-300 ring-1 ring-indigo-500/30'
                      : 'bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/30'
    }`}>{p}</span>
  );

  return (
    <div className="aegis-card aegis-card-edge p-5 space-y-5">
      {/* ── Synthèse ───────────────────────────────────────────────── */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <FileSearch className="w-4 h-4 text-indigo-300" />
          <h3 className="text-sm font-semibold tracking-tight">Synthèse multi-providers</h3>
          <span className="ml-auto text-[10px] text-muted-foreground">
            {totalCalls} appel{totalCalls > 1 ? 's' : ''} · {cachePct}% cache · {totalErrors} erreur{totalErrors > 1 ? 's' : ''}
          </span>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
          <Stat label="Identités"  value={report.identities.length} />
          <Stat label="Brèches"    value={report.breaches.length} tone={report.breaches.length > 0 ? 'danger' : 'neutral'} />
          <Stat label="Social"     value={report.social.length} />
          <Stat label="BrixHub"    value={`${report.providers.brixhub.calls} appel${report.providers.brixhub.calls > 1 ? 's' : ''}`} />
          <Stat label="SeekNow"    value={`${report.providers.seeknow.calls} appel${report.providers.seeknow.calls > 1 ? 's' : ''}`} />
        </div>
        <div className="mt-2 flex items-center gap-3 text-[11px] text-muted-foreground">
          <span>Quota Aegis : <strong className="text-foreground">{report.user_quota.used}/{report.user_quota.limit}</strong> ({report.user_quota.tier})</span>
          {report.providers.brixhub.credits_remaining != null && (
            <span>· BrixHub : <strong className="text-foreground">{report.providers.brixhub.credits_remaining}</strong> crédits</span>
          )}
          {report.providers.seeknow.credits_remaining != null && (
            <span>· SeekNow : <strong className="text-foreground">{report.providers.seeknow.credits_remaining}</strong> crédits</span>
          )}
        </div>
      </div>

      {/* ── Identités ─────────────────────────────────────────────── */}
      {report.identities.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-2">
            <User className="w-4 h-4 text-indigo-300" />
            <h3 className="text-sm font-semibold tracking-tight">Identités corrélées</h3>
            <span className="text-[10px] text-muted-foreground">({report.identities.length})</span>
          </div>
          <div className="space-y-3">
            {report.identities.map(p => <AggregatedPersonCard key={p.id} person={p} />)}
          </div>
        </div>
      )}

      {/* ── Brèches ───────────────────────────────────────────────── */}
      {report.breaches.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-2">
            <ShieldAlert className="w-4 h-4 text-rose-300" />
            <h3 className="text-sm font-semibold tracking-tight">Brèches & stealer logs</h3>
            <span className="text-[10px] text-muted-foreground">({report.breaches.length})</span>
            <ProviderBadge p="seeknow" />
            {primaryQuery && (
              <button
                onClick={() => setExplorer({ query: primaryQuery.value, type: primaryQuery.type })}
                className="ml-auto inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider px-2 py-1 rounded-md border border-amber-400/30 bg-amber-400/10 text-amber-200 hover:bg-amber-400/20 transition-colors"
                title="Ouvrir le Data Explorer SeekNow"
              >
                <Database className="w-3 h-3" /> Data Explorer
              </button>
            )}
          </div>
          <div className="rounded-lg border border-white/5 bg-white/[0.02] divide-y divide-white/5 max-h-96 overflow-y-auto">
            {report.breaches.map((b, i) => <BreachRow key={i} b={b} />)}
          </div>
        </div>
      )}

      {/* Data Explorer modal — monté à la racine pour pouvoir overlay l'écran. */}
      {explorer && (
        <DataExplorer
          query={explorer.query}
          type={explorer.type}
          onClose={() => setExplorer(null)}
        />
      )}

      {/* ── Vérifications ─────────────────────────────────────────── */}
      {(report.network.email || report.network.phone) && (
        <div>
          <div className="flex items-center gap-2 mb-2">
            <Network className="w-4 h-4 text-emerald-300" />
            <h3 className="text-sm font-semibold tracking-tight">Vérifications</h3>
            <ProviderBadge p="seeknow" />
          </div>
          <div className="grid gap-2 md:grid-cols-2">
            {report.network.email && (
              <div className="rounded-lg border border-white/5 bg-white/[0.02] p-3">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground/70 font-semibold mb-1">Email</div>
                <div className="font-mono text-xs text-foreground break-all">{report.network.email.value}</div>
                <div className="mt-2 flex flex-wrap gap-1.5 text-[10px]">
                  <Tag ok={report.network.email.valid}        label="valide" />
                  <Tag ok={report.network.email.deliverable}  label="livrable" />
                  <Tag bad={report.network.email.disposable}  label="jetable" />
                  {report.network.email.breach_count != null && (
                    <span className="px-1.5 py-0.5 rounded bg-rose-500/15 text-rose-300 ring-1 ring-rose-500/30">
                      {report.network.email.breach_count} brèche{report.network.email.breach_count > 1 ? 's' : ''}
                    </span>
                  )}
                </div>
              </div>
            )}
            {report.network.phone && (
              <div className="rounded-lg border border-white/5 bg-white/[0.02] p-3">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground/70 font-semibold mb-1">Téléphone</div>
                <div className="font-mono text-xs text-foreground">{report.network.phone.value}</div>
                <div className="mt-2 flex flex-wrap gap-1.5 text-[10px] text-muted-foreground">
                  {report.network.phone.country && <span>{report.network.phone.country}</span>}
                  {report.network.phone.carrier && <span>· {report.network.phone.carrier}</span>}
                  {report.network.phone.line_type && <span>· {report.network.phone.line_type}</span>}
                  {report.network.phone.breach_count != null && (
                    <span className="px-1.5 py-0.5 rounded bg-rose-500/15 text-rose-300 ring-1 ring-rose-500/30">
                      {report.network.phone.breach_count} brèche{report.network.phone.breach_count > 1 ? 's' : ''}
                    </span>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Social ─────────────────────────────────────────────────── */}
      {report.social.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-2">
            <Globe className="w-4 h-4 text-violet-300" />
            <h3 className="text-sm font-semibold tracking-tight">Réseaux sociaux</h3>
            <span className="text-[10px] text-muted-foreground">({report.social.length})</span>
            <ProviderBadge p="seeknow" />
          </div>
          <div className="flex flex-wrap gap-2">
            {report.social.map((s, i) => (
              s.url ? (
                <a key={i} href={s.url} target="_blank" rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border border-white/10 hover:border-violet-500/40 hover:bg-violet-500/10 text-foreground transition-all">
                  <span className="font-semibold">{s.platform}</span>
                  <ExternalLink className="w-3 h-3 opacity-60" />
                </a>
              ) : (
                <span key={i} className="inline-flex items-center text-xs px-2.5 py-1.5 rounded-lg border border-white/10 text-muted-foreground">
                  {s.platform}
                </span>
              )
            ))}
          </div>
        </div>
      )}

      {/* ── Empty (rien trouvé) ───────────────────────────────────── */}
      {report.identities.length === 0 && report.breaches.length === 0
       && report.social.length === 0 && !report.network.email && !report.network.phone && (
        <div className="rounded-lg border border-white/5 bg-white/[0.02] p-6 text-center text-xs text-muted-foreground">
          Aucun résultat sur les critères saisis.
          {totalErrors > 0 && <span className="text-amber-300"> · {totalErrors} appel(s) en erreur côté provider</span>}
        </div>
      )}

      {/* ── Audit des tâches (repliable) ──────────────────────────── */}
      <div>
        <button onClick={() => setShowTasks(s => !s)}
          className="text-[10px] uppercase tracking-wider text-muted-foreground hover:text-foreground font-semibold inline-flex items-center gap-1">
          <ChevronRight className={`w-3 h-3 transition-transform ${showTasks ? 'rotate-90' : ''}`} />
          Audit des appels ({report.tasks.length})
        </button>
        {showTasks && (
          <div className="mt-2 rounded-lg border border-white/5 bg-white/[0.02] divide-y divide-white/5">
            {report.tasks.map((t, i) => (
              <div key={i} className="flex items-center gap-2 px-3 py-1.5 text-[11px]">
                <ProviderBadge p={t.provider} />
                <span className="font-mono text-muted-foreground truncate flex-1">{t.endpoint}</span>
                <span className={`px-1.5 py-0.5 rounded text-[9px] ${t.cached ? 'bg-emerald-500/15 text-emerald-300' : 'bg-white/5 text-muted-foreground'}`}>
                  {t.cached ? 'cache' : 'live'}
                </span>
                <span className={`text-[9px] ${t.ok ? 'text-emerald-300' : 'text-rose-300'}`}>
                  {t.ok ? 'ok' : t.error || 'fail'}
                </span>
                <span className="text-muted-foreground/60 font-mono">{t.duration_ms}ms</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Tag({ ok, bad, label }: { ok?: boolean; bad?: boolean; label: string }) {
  if (ok === true)  return <span className="px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/30">{label}</span>;
  if (ok === false) return <span className="px-1.5 py-0.5 rounded bg-rose-500/15 text-rose-300 ring-1 ring-rose-500/30">non {label}</span>;
  if (bad === true) return <span className="px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-300 ring-1 ring-amber-500/30">{label}</span>;
  return null;
}

function AggregatedPersonCard({ person: p }: { person: AggregatedPerson }) {
  const [open, setOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<'merged' | 'brixhub' | 'seeknow'>('merged');
  const fullName = [p.prenom, p.nom_famille].filter(Boolean).join(' ').trim() || p.email || 'Profil';
  const initials = (fullName || '?').slice(0, 1).toUpperCase();
  const address  = joinAddress(p.adresse, p.code_postal, p.ville);

  const Field = ({ label, value, mono = false }: { label: string; value?: string | string[]; mono?: boolean }) => {
    if (!value || (Array.isArray(value) && !value.length)) return null;
    const display = Array.isArray(value) ? value.join(', ') : value;
    return (
      <div className="flex items-baseline gap-2 text-xs">
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground/70 font-semibold w-24 flex-shrink-0">{label}</span>
        <span className={`text-foreground break-all ${mono ? 'font-mono' : ''}`}>{display}</span>
      </div>
    );
  };

  const brixRaw = p.raw.filter(r => r.provider === 'brixhub');
  const seekRaw = p.raw.filter(r => r.provider === 'seeknow');

  return (
    <div className="rounded-lg border border-white/5 bg-white/[0.02] overflow-hidden">
      <button onClick={() => setOpen(!open)} className="w-full px-3 py-2.5 flex items-center gap-3 text-left hover:bg-white/[0.02]">
        <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-indigo-500/30 to-violet-500/10 ring-1 ring-indigo-500/40 flex items-center justify-center flex-shrink-0">
          <span className="text-sm font-bold text-indigo-200">{initials}</span>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm text-foreground font-semibold truncate">{fullName}</span>
            {p.providers.map(pr => (
              <span key={pr} className={`text-[9px] uppercase tracking-wider font-bold px-1.5 py-0.5 rounded ${
                pr === 'brixhub' ? 'bg-indigo-500/15 text-indigo-300' : 'bg-emerald-500/15 text-emerald-300'
              }`}>{pr}</span>
            ))}
            {p.confidence > 0 && (
              <span className="text-[10px] text-muted-foreground">{p.confidence}%</span>
            )}
          </div>
          <div className="text-[11px] text-muted-foreground truncate">
            {[p.email, p.telephone, p.ville].filter(Boolean).join(' · ') || '—'}
          </div>
        </div>
        <ChevronRight className={`w-4 h-4 text-muted-foreground/50 transition-transform ${open ? 'rotate-90' : ''}`} />
      </button>

      {open && (
        <div className="border-t border-white/5">
          {/* Tabs : merged / brixhub / seeknow */}
          <div className="flex items-center gap-1 px-3 pt-2 pb-1 border-b border-white/5">
            {[
              { k: 'merged' as const,  label: 'Fusion',   tone: 'bg-violet-500/15 text-violet-300 ring-violet-500/30',   count: undefined },
              { k: 'brixhub' as const, label: 'BrixHub',  tone: 'bg-indigo-500/15 text-indigo-300 ring-indigo-500/30',   count: brixRaw.length },
              { k: 'seeknow' as const, label: 'SeekNow',  tone: 'bg-emerald-500/15 text-emerald-300 ring-emerald-500/30', count: seekRaw.length },
            ].map(t => {
              const active = activeTab === t.k;
              const disabled = (t.k === 'brixhub' && brixRaw.length === 0) || (t.k === 'seeknow' && seekRaw.length === 0);
              return (
                <button key={t.k}
                  disabled={disabled}
                  onClick={() => setActiveTab(t.k)}
                  className={`text-[11px] uppercase tracking-wider font-semibold px-2 py-1 rounded transition-all disabled:opacity-30 ${
                    active ? `${t.tone} ring-1` : 'text-muted-foreground hover:text-foreground hover:bg-white/5'
                  }`}>
                  {t.label}{t.count != null && <span className="ml-1 opacity-70">({t.count})</span>}
                </button>
              );
            })}
          </div>

          {activeTab === 'merged' && (() => {
            // On synthétise un "profile BrixHub-like" à partir des champs
            // mergés pour que la fusion réutilise exactement le même look
            // que BrixProfileCard (groupes, copy, badge Maps…).
            const synthProfile: any = {
              prenom:         p.prenom,
              nom_famille:    p.nom_famille,
              date_naissance: p.date_naissance,
              genre:          p.genre,
              email:          p.email,
              telephone:      p.telephone,
              adresse:        p.adresse,
              ville:          p.ville,
              code_postal:    p.code_postal,
              iban:           p.iban,
              nir:            p.nir,
              siret:          p.siret,
              societe:        p.societe,
              _confidence:    p.confidence,
              _emails:        p.emails && p.emails.length > 1 ? p.emails.join(', ') : undefined,
              _phones:        p.phones && p.phones.length > 1 ? p.phones.join(', ') : undefined,
            };
            // On nettoie les undefined.
            for (const k of Object.keys(synthProfile)) if (synthProfile[k] == null) delete synthProfile[k];
            return (
              <div className="p-3 space-y-3">
                {address && <OsintMap address={address} label={fullName} height={260} />}
                <BrixProfileCard profile={synthProfile} compact />
                <div className="text-[10px] text-muted-foreground/60">
                  {p.raw.length} source{p.raw.length > 1 ? 's' : ''} · {brixRaw.length} BrixHub · {seekRaw.length} SeekNow · ID {p.id.slice(0, 16)}…
                </div>
              </div>
            );
          })()}

          {activeTab === 'brixhub' && (
            <div className="p-3 space-y-2">
              {brixRaw.length === 0 ? (
                <div className="text-[11px] text-muted-foreground italic">Aucune source BrixHub.</div>
              ) : (
                brixRaw.map((r, i) => <BrixProfileCard key={i} profile={r.profile} compact />)
              )}
            </div>
          )}

          {activeTab === 'seeknow' && (
            <div className="p-3 space-y-2">
              {seekRaw.length === 0 ? (
                <div className="text-[11px] text-muted-foreground italic">Aucune source SeekNow.</div>
              ) : (
                seekRaw.map((r, i) => <SeeknowProfileCard key={i} profile={r.profile} />)
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function BreachRow({ b }: { b: BreachRecord }) {
  const [open, setOpen] = useState(false);
  // SeekNow expose `_origin` ∈ {breach, stealer, external} dans `extra`
  // pour distinguer une fuite classique d'un log infostealer (RedLine,
  // Vidar...) ou d'une mention externe. On le rend visible d'un coup d'œil.
  const origin = String(b.extra?._origin || '').toLowerCase();
  const originStyle =
    origin === 'stealer'  ? 'text-amber-300 bg-amber-500/15 ring-amber-500/30' :
    origin === 'breach'   ? 'text-rose-300  bg-rose-500/15  ring-rose-500/30'  :
    origin === 'external' ? 'text-sky-300   bg-sky-500/15   ring-sky-500/30'   :
    '';
  const Icon = origin === 'stealer' ? KeyRound : ShieldAlert;
  return (
    <div>
      <button onClick={() => setOpen(!open)} className="w-full px-3 py-2 flex items-center gap-2 text-left hover:bg-white/[0.02]">
        <Icon className={`w-3.5 h-3.5 flex-shrink-0 ${origin === 'stealer' ? 'text-amber-300' : 'text-rose-300'}`} />
        <span className="text-xs font-semibold text-foreground truncate">{b.source}</span>
        {origin && <span className={`text-[9px] uppercase font-bold ring-1 px-1.5 py-0.5 rounded ${originStyle}`}>{origin}</span>}
        <span className="text-[11px] text-muted-foreground truncate flex-1">
          {[b.email, b.username, b.name].filter(Boolean).join(' · ') || '—'}
        </span>
        {b.password && <span className="text-[9px] uppercase font-bold text-rose-300 bg-rose-500/15 ring-1 ring-rose-500/30 px-1.5 py-0.5 rounded">password</span>}
        <ChevronRight className={`w-3 h-3 text-muted-foreground/50 transition-transform ${open ? 'rotate-90' : ''}`} />
      </button>
      {open && (
        <div className="px-3 pb-2 pt-0 space-y-0.5 text-[11px]">
          {b.email      && <KV label="email"      value={b.email}      mono />}
          {b.username   && <KV label="username"   value={b.username}   mono />}
          {b.name       && <KV label="name"       value={b.name} />}
          {b.password   && <KV label="password"   value={b.password}   mono tone="danger" />}
          {b.ip_address && <KV label="ip"         value={b.ip_address} mono />}
          {b.url        && <KV label="url"        value={b.url}        mono />}
          {Object.entries(b.extra || {}).map(([k, v]) => (
            <KV key={k} label={k} value={typeof v === 'object' ? JSON.stringify(v) : String(v)} mono />
          ))}
        </div>
      )}
    </div>
  );
}

function KV({ label, value, mono = false, tone = 'neutral' }: { label: string; value: string; mono?: boolean; tone?: 'neutral' | 'danger' }) {
  const cls = tone === 'danger' ? 'text-rose-300' : 'text-foreground';
  return (
    <div className="flex items-baseline gap-2">
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground/70 font-semibold w-20 flex-shrink-0">{label}</span>
      <span className={`break-all ${cls} ${mono ? 'font-mono' : ''}`}>{value}</span>
    </div>
  );
}

// ── SeekNow profile card ───────────────────────────────────────────────────
// Les profils SeekNow ont une forme tr\u00e8s variable selon l'endpoint :
//  - /search/stealer : { source, email, username, password, ip_address, name, url, machine_id, os, browser, country, ... }
//  - /username/<plat> : { profile: { ... fields plateforme ... } }
//  - /username/social : { platform, url } (d\u00e9j\u00e0 unwrap dans `found_on`)
//  - /network/email   : { valid, deliverable, disposable, breach_count, ... }
//  - /network/phone   : { country, carrier, line_type, breach_count }
//  - /network/ip      : { country, city, asn, isp, is_vpn, abuse_score, breach_count }
//  - /domain/whois    : { registrar, created, expires }
//  - /gaming/*        : { gamertag|name|uuid, gamerscore, joined, ... }
// On rend la dict en cl\u00e9/valeur, avec mise en avant des champs sensibles
// (password, breach_count, abuse_score) et fallback JSON brut au pire.
function SeeknowProfileCard({ profile: p }: { profile: any }) {
  const [copied, setCopied] = useState<string | null>(null);
  const [showRaw, setShowRaw] = useState(false);

  const copy = (val: string, label: string) => {
    navigator.clipboard.writeText(val).then(() => {
      setCopied(label);
      setTimeout(() => setCopied(null), 1500);
    });
  };

  // Flatten: si le profil a un sous-objet `profile` (ex. /username/github),
  // on le hisse au top-level. M\u00eame chose pour `roblox`.
  const flat: Record<string, any> = (() => {
    if (!p || typeof p !== 'object') return { value: String(p) };
    let f: Record<string, any>;
    if (p.profile && typeof p.profile === 'object') f = { ...p, ...p.profile };
    else f = { ...p };
    // Hisser le contenu d'`extra` au top-level (cas BreachRecord SeekNow :
    // les champs métier sortent du blob JSON et redeviennent inspectables).
    if (f.extra && typeof f.extra === 'object' && !Array.isArray(f.extra)) {
      const { extra, ...rest } = f;
      f = { ...rest, ...extra };
    }
    return f;
  })();

  // Champs prioritaires \u00e0 afficher en premier s'ils existent.
  const PRIORITY = [
    'source', 'platform', 'url',
    'name', 'display_name', 'username', 'gamertag', 'login',
    'email', 'linked_emails',
    'password', 'machine_id',
    'phone', 'carrier', 'line_type',
    'ip', 'ip_address', 'country', 'country_code', 'city',
    'asn', 'isp', 'org', 'is_vpn',
    'abuse_score', 'breach_count', 'breach_mentions',
    'valid', 'deliverable', 'disposable',
    'registrar', 'created', 'expires',
    'uuid', 'id', 'user_id', 'discord_id',
    'os', 'browser',
    'verified', 'followers', 'public_repos', 'karma', 'gamerscore',
    'joined',
  ];
  const hidden = new Set(['success', 'credits_remaining', 'profile', '_raw']);
  const sortedKeys = [
    ...PRIORITY.filter(k => k in flat),
    ...Object.keys(flat).filter(k => !PRIORITY.includes(k) && !hidden.has(k)),
  ];

  const sensitiveKeys = new Set(['password', 'machine_id']);
  const warningKeys   = new Set(['breach_count', 'breach_mentions', 'abuse_score', 'is_vpn', 'disposable']);

  const renderValue = (k: string, v: any): { display: string; mono: boolean; copy: string | null } => {
    if (v == null) return { display: '\u2014', mono: false, copy: null };
    if (typeof v === 'boolean') return { display: v ? 'oui' : 'non', mono: true, copy: null };
    if (Array.isArray(v)) return { display: v.join(', ') || '[]', mono: false, copy: v.join(', ') };
    if (typeof v === 'object') return { display: JSON.stringify(v), mono: true, copy: JSON.stringify(v) };
    const s = String(v);
    const mono = sensitiveKeys.has(k) || /^[0-9a-f-]{8,}$/i.test(s) || /^https?:\/\//.test(s) || /^\d+$/.test(s);
    return { display: s, mono, copy: s };
  };

  const headline = flat.source || flat.platform || flat.name || flat.username || flat.email || flat.ip || flat.domain || 'R\u00e9sultat';

  return (
    <div className="rounded-lg border border-white/5 bg-white/[0.02] overflow-hidden">
      <div className="px-3 py-2 flex items-center gap-2 bg-white/[0.02]">
        <span className="text-[10px] uppercase tracking-wider font-semibold text-emerald-300">SeekNow</span>
        <span className="text-sm text-foreground font-medium truncate flex-1">{headline}</span>
        <button onClick={() => setShowRaw(s => !s)}
          className="text-[10px] text-muted-foreground hover:text-foreground px-2 py-0.5 rounded border border-white/10">
          {showRaw ? 'vue tableau' : 'JSON brut'}
        </button>
      </div>

      {showRaw ? (
        <pre className="text-[11px] font-mono p-3 max-h-72 overflow-auto whitespace-pre-wrap break-all text-muted-foreground">
{JSON.stringify(p, null, 2)}
        </pre>
      ) : (
        <div className="divide-y divide-white/5">
          {sortedKeys.length === 0 && (
            <div className="px-3 py-2 text-[11px] text-muted-foreground">Profil vide.</div>
          )}
          {sortedKeys.map(k => {
            const r = renderValue(k, flat[k]);
            const tone = sensitiveKeys.has(k) ? 'text-rose-300'
                       : warningKeys.has(k)   ? 'text-amber-300'
                       : 'text-foreground';
            return (
              <div key={k} className="flex items-center gap-3 px-3 py-1.5">
                <span className="text-[10px] uppercase tracking-wider text-muted-foreground/70 font-semibold w-28 flex-shrink-0">{k}</span>
                {/^https?:\/\//.test(r.display) ? (
                  <a href={r.display} target="_blank" rel="noopener noreferrer"
                    className="text-xs flex-1 break-all text-indigo-300 hover:text-indigo-200 inline-flex items-center gap-1 font-mono">
                    <span className="truncate">{r.display}</span>
                    <ExternalLink className="w-3 h-3 opacity-60 flex-shrink-0" />
                  </a>
                ) : (
                  <span className={`text-xs flex-1 break-all ${tone} ${r.mono ? 'font-mono' : ''}`}>{r.display}</span>
                )}
                {r.copy && (
                  <button onClick={() => copy(r.copy!, k)}
                    className="text-[10px] text-muted-foreground hover:text-foreground p-1 rounded">
                    {copied === k ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
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
          const isAddrGroup = group.title === 'Adresse';
          const gmaps = isAddrGroup ? gmapsUrl(p.adresse, p.complement_adresse, p.code_postal, p.ville, p.departement, p.pays) : null;
          return (
            <div key={group.title}>
              <div className="flex items-center justify-between mb-1.5">
                <h4 className="text-[10px] uppercase tracking-wider text-muted-foreground/70 font-semibold">{group.title}</h4>
                {gmaps && (p.adresse || p.ville) && (
                  <a href={gmaps} target="_blank" rel="noopener noreferrer"
                    className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-md font-semibold text-indigo-300 hover:text-indigo-200 bg-indigo-500/10 hover:bg-indigo-500/20 ring-1 ring-indigo-500/30 inline-flex items-center gap-1">
                    <MapPin className="w-3 h-3" /> Google Maps
                  </a>
                )}
              </div>
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

// ── Data Explorer ──────────────────────────────────────────────────────────
// Modal full-screen attaché à un identifiant (email / téléphone / username /
// IP / hash / nom). On appelle directement `/api/seeknow/search` (POST) avec
// limit=500 pour récupérer un dump exhaustif, puis on déduplique côté client
// par signature (email|username|password|url) — comme le service "Dedup
// Engine" de SeekNow. Deux vues :
//   - Treeview        : graphe SVG du pipeline (Dedup → Unique/Dupes → Table).
//   - Credential Exposure : table # / URL / USER / PASSWORD / DATE / SOURCE.
type SeeknowRecord = {
  source?:     string;
  email?:      string;
  username?:   string;
  password?:   string;
  ip_address?: string;
  url?:        string;
  date?:       string;
  added?:      string;
  created_at?: string;
  name?:       string;
  _origin?:    string;
  [k: string]: any;
};

interface DataExplorerProps {
  query: string;
  type?: 'email' | 'phone' | 'username' | 'ip' | 'hash';
  onClose: () => void;
}

function DataExplorer({ query, type, onClose }: DataExplorerProps) {
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);
  const [records, setRecords] = useState<SeeknowRecord[]>([]);
  const [tab,     setTab]     = useState<'tree' | 'creds'>('creds');
  const [filter,  setFilter]  = useState('');

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const body: any = { query, limit: 500 };
        if (type) body.type = type;
        const res: any = await apiPost('/api/seeknow/search', body);
        // Réponse upstream : `{ ok, data: { success, results, total, ... } }`
        // ou directement `{ ok, data: [...] }` selon les versions du proxy.
        const data = res?.data || res;
        const list: SeeknowRecord[] =
          (Array.isArray(data?.results) && data.results) ||
          (Array.isArray(data?.data?.results) && data.data.results) ||
          (Array.isArray(data) && data) ||
          (Array.isArray(data?.data) && data.data) ||
          [];
        if (alive) setRecords(list);
      } catch (e: any) {
        if (alive) setError(e?.message || 'Erreur SeekNow');
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [query, type]);

  // Stats — calculées une fois sur la liste brute.
  const stats = useMemo(() => {
    const sources = new Set<string>();
    const credSig = new Map<string, number>();   // sig → count
    const fields  = { url: 0, user: 0, password: 0, date: 0 };
    for (const r of records) {
      if (r.source) sources.add(String(r.source));
      const sig = [
        (r.email || '').toLowerCase(),
        (r.username || '').toLowerCase(),
        r.password || '',
        r.url || '',
      ].join('|');
      if (sig.replace(/\|/g, '')) credSig.set(sig, (credSig.get(sig) || 0) + 1);
      if (r.url)                       fields.url++;
      if (r.email || r.username)       fields.user++;
      if (r.password)                  fields.password++;
      if (r.date || r.added || r.created_at) fields.date++;
    }
    let unique = 0, dupes = 0;
    for (const v of credSig.values()) { if (v === 1) unique++; else dupes += v; }
    return {
      total:   records.length,
      sources: sources.size,
      unique,
      dupes,
      fields,
    };
  }, [records]);

  // Liste filtrée pour la table.
  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return records;
    return records.filter(r =>
      [r.url, r.email, r.username, r.password, r.source, r.date, r.name, r.ip_address]
        .filter(Boolean)
        .some(v => String(v).toLowerCase().includes(q))
    );
  }, [records, filter]);

  return (
    <div className="fixed inset-0 z-50 bg-background/95 backdrop-blur-sm flex flex-col" onKeyDown={(e) => e.key === 'Escape' && onClose()}>
      {/* Header */}
      <header className="flex items-center gap-3 px-5 py-3 border-b border-white/10 bg-white/[0.02]">
        <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-amber-400/20 to-rose-500/20 ring-1 ring-amber-400/30 flex items-center justify-center">
          <Database className="w-4 h-4 text-amber-300" />
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="text-sm font-semibold tracking-tight">Data Explorer</h2>
          <p className="text-[11px] text-muted-foreground truncate font-mono">— {query}{type ? ` (${type})` : ''}</p>
        </div>
        <button
          onClick={onClose}
          className="w-8 h-8 rounded-lg border border-white/10 bg-white/[0.02] hover:bg-white/[0.06] flex items-center justify-center"
          aria-label="Fermer"
        >
          <X className="w-4 h-4" />
        </button>
      </header>

      {/* Stats bar */}
      <div className="px-5 py-3 border-b border-white/5 flex flex-wrap items-center gap-x-6 gap-y-2 text-[11px]">
        <ExplorerStat icon={<FileSearch className="w-3.5 h-3.5 text-sky-300" />}    label="Results"      value={stats.total}    tone="sky" />
        <ExplorerStat icon={<Server     className="w-3.5 h-3.5 text-emerald-300"/>} label="Sources"      value={stats.sources}  tone="emerald" />
        <ExplorerStat icon={<KeyRound   className="w-3.5 h-3.5 text-amber-300"/>}   label="Unique Creds" value={stats.unique}   tone="amber" />
        <ExplorerStat icon={<Copy       className="w-3.5 h-3.5 text-rose-300"/>}    label="Dupes"        value={stats.dupes}    tone="rose" />
      </div>

      {/* Tabs */}
      <div className="px-5 pt-3 flex items-center gap-1 border-b border-white/5">
        <TabButton active={tab === 'tree'}  onClick={() => setTab('tree')}  icon={<GitBranch className="w-3.5 h-3.5" />} label="Treeview" />
        <TabButton active={tab === 'creds'} onClick={() => setTab('creds')} icon={<Table2    className="w-3.5 h-3.5" />} label="Credential Exposure" />
      </div>

      {/* Body */}
      <div className="flex-1 overflow-auto">
        {loading && (
          <div className="flex items-center justify-center h-full text-muted-foreground text-xs gap-2">
            <Loader2 className="w-4 h-4 animate-spin" /> Chargement SeekNow…
          </div>
        )}
        {error && !loading && (
          <div className="flex items-center justify-center h-full text-rose-300 text-xs">
            Erreur : {error}
          </div>
        )}
        {!loading && !error && tab === 'tree'  && <DataExplorerTree  stats={stats} />}
        {!loading && !error && tab === 'creds' && (
          <DataExplorerTable rows={filtered} filter={filter} onFilter={setFilter} totalCount={records.length} />
        )}
      </div>
    </div>
  );
}

function ExplorerStat({ icon, label, value, tone }: { icon: React.ReactNode; label: string; value: number; tone: 'sky' | 'emerald' | 'amber' | 'rose' }) {
  const toneCls = {
    sky:     'text-sky-300',
    emerald: 'text-emerald-300',
    amber:   'text-amber-300',
    rose:    'text-rose-300',
  }[tone];
  return (
    <div className="flex items-center gap-1.5">
      {icon}
      <span className={`font-semibold tabular-nums ${toneCls}`}>{value}</span>
      <span className="text-muted-foreground">{label}</span>
    </div>
  );
}

function TabButton({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1.5 text-xs font-semibold flex items-center gap-1.5 border-b-2 -mb-px transition-colors ${
        active ? 'border-amber-400 text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'
      }`}
    >
      {icon}{label}
    </button>
  );
}

// ── Treeview : pipeline de déduplication SeekNow ──────────────────────────
function DataExplorerTree({ stats }: { stats: { total: number; sources: number; unique: number; dupes: number; fields: { url: number; user: number; password: number; date: number } } }) {
  // SVG layout fixe : Dedup Engine au sommet → 2 enfants (Unique, Dupes) →
  // Clean Results Table en bas → 4 leaf nodes (URL, User, Password, Date).
  return (
    <div className="p-6 flex justify-center">
      <svg viewBox="0 0 720 460" className="w-full max-w-3xl text-foreground">
        {/* Edges */}
        <g stroke="rgba(255,255,255,0.15)" strokeWidth="1" fill="none">
          <path d="M 360 60 L 220 130" />
          <path d="M 360 60 L 500 130" />
          <path d="M 220 170 L 360 240" />
          <path d="M 500 170 L 360 240" />
          <path d="M 360 280 L 120 360" />
          <path d="M 360 280 L 280 360" />
          <path d="M 360 280 L 440 360" />
          <path d="M 360 280 L 600 360" />
        </g>
        {/* Dedup Engine */}
        <TreeNode x={290} y={30}  w={140} h={50} title="Deduplication Engine" subtitle={`${stats.total} entries`} tone="amber" icon="◎" />
        {/* Unique / Dupes */}
        <TreeNode x={150} y={130} w={140} h={50} title={`${stats.unique} Uniques`}    subtitle="Credentials" tone="emerald" icon="✓" />
        <TreeNode x={430} y={130} w={140} h={50} title={`${stats.dupes} Duplicates`}  subtitle="Removed"     tone="rose"    icon="✕" />
        {/* Clean table */}
        <TreeNode x={285} y={240} w={150} h={50} title="Clean Results Table" subtitle={`${stats.unique} entries`} tone="sky" icon="▦" />
        {/* Leaves */}
        <TreeLeaf x={50}   y={360} label="URL"      count={stats.fields.url}      tone="sky" />
        <TreeLeaf x={210}  y={360} label="User"     count={stats.fields.user}     tone="indigo" />
        <TreeLeaf x={370}  y={360} label="Password" count={stats.fields.password} tone="rose" />
        <TreeLeaf x={530}  y={360} label="Date"     count={stats.fields.date}     tone="violet" />
      </svg>
    </div>
  );
}

function TreeNode({ x, y, w, h, title, subtitle, tone, icon }: { x: number; y: number; w: number; h: number; title: string; subtitle: string; tone: 'amber' | 'emerald' | 'rose' | 'sky'; icon: string }) {
  const fill = {
    amber:   'rgba(251,191,36,0.10)',
    emerald: 'rgba(52,211,153,0.10)',
    rose:    'rgba(251,113,133,0.10)',
    sky:     'rgba(125,211,252,0.10)',
  }[tone];
  const stroke = {
    amber:   'rgba(251,191,36,0.45)',
    emerald: 'rgba(52,211,153,0.45)',
    rose:    'rgba(251,113,133,0.45)',
    sky:     'rgba(125,211,252,0.45)',
  }[tone];
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} rx="8" fill={fill} stroke={stroke} strokeWidth="1" />
      <text x={x + 12} y={y + 22} fontSize="11" fontWeight="700" fill="currentColor">{icon} {title}</text>
      <text x={x + 12} y={y + 38} fontSize="9.5" fill="rgba(255,255,255,0.5)">{subtitle}</text>
    </g>
  );
}

function TreeLeaf({ x, y, label, count, tone }: { x: number; y: number; label: string; count: number; tone: 'sky' | 'indigo' | 'rose' | 'violet' }) {
  const fill = {
    sky:    'rgba(125,211,252,0.10)',
    indigo: 'rgba(165,180,252,0.10)',
    rose:   'rgba(251,113,133,0.10)',
    violet: 'rgba(196,181,253,0.10)',
  }[tone];
  const stroke = {
    sky:    'rgba(125,211,252,0.45)',
    indigo: 'rgba(165,180,252,0.45)',
    rose:   'rgba(251,113,133,0.45)',
    violet: 'rgba(196,181,253,0.45)',
  }[tone];
  return (
    <g>
      <rect x={x} y={y} width={120} height={50} rx="8" fill={fill} stroke={stroke} strokeWidth="1" />
      <text x={x + 12} y={y + 22} fontSize="11" fontWeight="700" fill="currentColor">⛓ {label}</text>
      <text x={x + 12} y={y + 38} fontSize="9.5" fill="rgba(255,255,255,0.5)">{count} entries</text>
    </g>
  );
}

// ── Credential Exposure table ─────────────────────────────────────────────
function DataExplorerTable({ rows, filter, onFilter, totalCount }: {
  rows: SeeknowRecord[]; filter: string; onFilter: (v: string) => void; totalCount: number;
}) {
  const fmtDate = (r: SeeknowRecord) => {
    const v = r.date || r.added || r.created_at;
    if (!v) return '—';
    return String(v).slice(0, 19).replace('T', ' ');
  };
  const userCol = (r: SeeknowRecord) => r.email || r.username || r.name || '—';
  return (
    <div className="px-5 py-4">
      <div className="flex items-center gap-2 mb-3">
        <Filter className="w-3.5 h-3.5 text-muted-foreground" />
        <input
          value={filter}
          onChange={(e) => onFilter(e.target.value)}
          placeholder="Filtrer (URL, user, password, source…)"
          className="flex-1 max-w-xs bg-white/[0.04] border border-white/10 rounded px-2 py-1 text-xs outline-none focus:border-amber-400/40"
        />
        <span className="text-[10px] text-muted-foreground tabular-nums">
          {rows.length} / {totalCount} lignes
        </span>
      </div>
      <div className="rounded-lg border border-white/10 overflow-hidden">
        <table className="w-full text-[11px]">
          <thead className="bg-white/[0.03] text-[9.5px] uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="text-left px-3 py-2 w-10">#</th>
              <th className="text-left px-3 py-2"><span className="inline-flex items-center gap-1"><Globe className="w-3 h-3 text-sky-300" /> URL</span></th>
              <th className="text-left px-3 py-2"><span className="inline-flex items-center gap-1"><User className="w-3 h-3 text-indigo-300" /> User</span></th>
              <th className="text-left px-3 py-2"><span className="inline-flex items-center gap-1"><Lock className="w-3 h-3 text-rose-300" /> Password</span></th>
              <th className="text-left px-3 py-2"><span className="inline-flex items-center gap-1"><Calendar className="w-3 h-3 text-violet-300" /> Date</span></th>
              <th className="text-left px-3 py-2"><span className="inline-flex items-center gap-1"><Server className="w-3 h-3 text-amber-300" /> Source</span></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {rows.length === 0 && (
              <tr><td colSpan={6} className="text-center py-8 text-muted-foreground">Aucun résultat.</td></tr>
            )}
            {rows.map((r, i) => (
              <tr key={i} className="hover:bg-white/[0.02]">
                <td className="px-3 py-1.5 text-muted-foreground tabular-nums">{i + 1}</td>
                <td className="px-3 py-1.5 font-mono text-sky-200/90 truncate max-w-[260px]">{r.url || '—'}</td>
                <td className="px-3 py-1.5 font-mono">{userCol(r)}</td>
                <td className="px-3 py-1.5 font-mono text-rose-200/90">{r.password || '—'}</td>
                <td className="px-3 py-1.5 font-mono text-muted-foreground">{fmtDate(r)}</td>
                <td className="px-3 py-1.5 text-amber-200/90">{r.source || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
