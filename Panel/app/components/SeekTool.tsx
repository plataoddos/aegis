/**
 * Seek (see-know.eu) UI.
 *
 * - Toutes les requêtes passent par notre backend qui détient la clé API.
 * - Le backend cache 24h les réponses identiques (0 crédit pour duplicate).
 * - L'utilisateur clique pour lancer une recherche, jamais d'auto-trigger.
 * - Les résultats "personne" peuvent être ajoutés directement aux Fiches.
 */
import { useEffect, useMemo, useState } from 'react';
import {
  Search, Loader2, AlertCircle, Database, Zap, Clock, X, UserPlus, Eye,
  Mail, Phone, MapPin, Hash, Globe, MessageSquare, Github, AtSign,
  Music, Server, ShieldAlert, Wifi, Gamepad2, RefreshCw, Trash2, Copy,
} from 'lucide-react';
import { toast } from 'sonner';

const API_URL   = ((import.meta as any).env?.VITE_WATCHER_API_URL  as string) || 'http://localhost:8787';
const API_TOKEN = ((import.meta as any).env?.VITE_WATCHER_API_TOKEN as string) || '';

// ── Types ───────────────────────────────────────────────────────────────────
interface SeekResult {
  ok: boolean;
  cached: boolean;
  endpoint: string;
  cost: number;
  credits_remaining: number | null;
  data: any;
  status: number;
  fetched_at: number;
}

type CategoryId = 'universal' | 'discord' | 'username' | 'network' | 'domain' | 'gaming';

interface CatItem {
  id: string;
  key: string;       // backend key (ex: search, discord_user)
  label: string;
  cost: number;
  /** GET or POST */
  method: 'GET' | 'POST';
  /** Form fields */
  fields: { name: string; label: string; placeholder?: string; required?: boolean; type?: string }[];
  /** Lucide icon */
  Icon: any;
  description?: string;
}

const CATEGORIES: { id: CategoryId; label: string; Icon: any; items: CatItem[] }[] = [
  {
    id: 'universal', label: 'Universel', Icon: Search,
    items: [
      { id: 'search',  key: 'search',  label: 'Recherche universelle', cost: 1, method: 'POST', Icon: Search,
        description: 'Email, téléphone, username, IP, hash — fan-out sur 70+ sources.',
        fields: [
          { name: 'query', label: 'Recherche', placeholder: 'email / phone / user / ip / hash', required: true },
          { name: 'type',  label: 'Forcer le type', placeholder: '(auto)' },
          { name: 'limit', label: 'Limite', placeholder: '100', type: 'number' },
        ] },
      { id: 'stealer', key: 'stealer', label: 'Stealer logs', cost: 2, method: 'POST', Icon: ShieldAlert,
        description: 'Logs RedLine/Raccoon/Vidar — credentials + machine.',
        fields: [
          { name: 'query', label: 'Recherche', placeholder: 'email / username / domaine', required: true },
          { name: 'limit', label: 'Limite', placeholder: '100', type: 'number' },
        ] },
    ],
  },
  {
    id: 'discord', label: 'Discord', Icon: MessageSquare,
    items: [
      { id: 'discord_user',   key: 'discord_user',   label: 'Discord User',     cost: 1, method: 'GET', Icon: MessageSquare,
        fields: [{ name: 'discord_id', label: 'Discord ID', placeholder: '1234567890123456789', required: true }] },
      { id: 'discord_roblox', key: 'discord_roblox', label: 'Discord → Roblox', cost: 1, method: 'GET', Icon: Gamepad2,
        fields: [{ name: 'discord_id', label: 'Discord ID', placeholder: '1234567890123456789', required: true }] },
    ],
  },
  {
    id: 'username', label: 'Username', Icon: AtSign,
    items: [
      { id: 'username_social',  key: 'username_social',  label: 'Social (70+)', cost: 1, method: 'GET', Icon: Globe,
        description: 'Fan-out sur toutes les plateformes en un appel.',
        fields: [
          { name: 'username',  label: 'Handle', placeholder: 'johndoe', required: true },
          { name: 'platforms', label: 'Limiter aux plateformes', placeholder: 'github,twitter (optionnel)' },
        ] },
      { id: 'username_history', key: 'username_history', label: 'Historique',  cost: 1, method: 'GET', Icon: Clock,
        fields: [{ name: 'username', label: 'Handle', placeholder: 'johndoe', required: true }] },
      { id: 'username_github',  key: 'username_github',  label: 'GitHub',      cost: 1, method: 'GET', Icon: Github,
        fields: [{ name: 'username', label: 'Handle', placeholder: 'octocat', required: true }] },
      { id: 'username_twitter', key: 'username_twitter', label: 'Twitter / X', cost: 1, method: 'GET', Icon: AtSign,
        fields: [{ name: 'username', label: 'Handle', placeholder: 'elonmusk', required: true }] },
      { id: 'username_tiktok',  key: 'username_tiktok',  label: 'TikTok',      cost: 1, method: 'GET', Icon: Music,
        fields: [{ name: 'username', label: 'Handle', placeholder: 'tiktokuser', required: true }] },
      { id: 'username_reddit',  key: 'username_reddit',  label: 'Reddit',      cost: 1, method: 'GET', Icon: AtSign,
        fields: [{ name: 'username', label: 'Handle', placeholder: 'spez', required: true }] },
    ],
  },
  {
    id: 'network', label: 'Réseau', Icon: Wifi,
    items: [
      { id: 'network_ip',    key: 'network_ip',    label: 'IP intel',     cost: 1, method: 'GET', Icon: Wifi,
        fields: [{ name: 'ip', label: 'IP', placeholder: '192.0.2.1', required: true }] },
      { id: 'network_email', key: 'network_email', label: 'Email check',  cost: 1, method: 'GET', Icon: Mail,
        fields: [{ name: 'email', label: 'Email', placeholder: 'test@gmail.com', required: true }] },
      { id: 'network_phone', key: 'network_phone', label: 'Téléphone',    cost: 1, method: 'GET', Icon: Phone,
        fields: [{ name: 'phone', label: 'Téléphone (E.164)', placeholder: '+33612345678', required: true }] },
    ],
  },
  {
    id: 'domain', label: 'Domaine', Icon: Globe,
    items: [
      { id: 'domain_intel', key: 'domain_intel', label: 'Domain intel', cost: 1, method: 'GET', Icon: Globe,
        fields: [{ name: 'domain', label: 'Domaine', placeholder: 'example.com', required: true }] },
      { id: 'domain_whois', key: 'domain_whois', label: 'WHOIS',        cost: 1, method: 'GET', Icon: Server,
        fields: [{ name: 'domain', label: 'Domaine', placeholder: 'example.com', required: true }] },
    ],
  },
  {
    id: 'gaming', label: 'Gaming', Icon: Gamepad2,
    items: [
      { id: 'gaming_xbox',      key: 'gaming_xbox',      label: 'Xbox',      cost: 1, method: 'GET', Icon: Gamepad2,
        fields: [{ name: 'gamertag', label: 'Gamertag', placeholder: 'Major Nelson', required: true }] },
      { id: 'gaming_roblox',    key: 'gaming_roblox',    label: 'Roblox',    cost: 1, method: 'GET', Icon: Gamepad2,
        fields: [
          { name: 'username', label: 'Username',   placeholder: 'Player1' },
          { name: 'user_id',  label: 'User ID',    placeholder: '123456', type: 'number' },
        ] },
      { id: 'gaming_minecraft', key: 'gaming_minecraft', label: 'Minecraft', cost: 1, method: 'GET', Icon: Gamepad2,
        fields: [{ name: 'username', label: 'Username', placeholder: 'Notch', required: true }] },
    ],
  },
];

// ── Helpers ─────────────────────────────────────────────────────────────────
async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(API_URL + path, {
    ...init,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${API_TOKEN}`, ...(init?.headers || {}) },
  });
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try { msg = (await res.json()).error || msg; } catch {}
    throw new Error(msg);
  }
  return res.json() as Promise<T>;
}

function fmtTime(ts: number) {
  return new Date(ts).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'medium' });
}

/** Try to extract person-like fields from a raw seek result for "ajouter aux fiches". */
function extractPersonInput(raw: any): null | Record<string, any> {
  if (!raw || typeof raw !== 'object') return null;
  const name = raw.name || [raw.first_name, raw.last_name].filter(Boolean).join(' ') || raw.full_name;
  if (!name && !raw.email && !raw.phone) return null;

  // Need at least nom/prenom/dob for a full fiche; otherwise return partial draft
  const parts = String(name || '').trim().split(/\s+/);
  const prenom = raw.first_name || parts[0] || '';
  const nom    = raw.last_name  || parts.slice(1).join(' ') || '';

  return {
    nom:            nom.toUpperCase(),
    prenom:         prenom.toUpperCase(),
    date_naissance: raw.birthdate || raw.birth_date || raw.dob || '',
    adresse:        raw.address || raw.adresse || '',
    code_postal:    raw.postal_code || raw.zip || '',
    ville:          raw.city || raw.ville || '',
    email_alloc:    Array.isArray(raw.email) ? raw.email.join(' | ') : (raw.email || ''),
    tel_alloc:      Array.isArray(raw.phone) ? raw.phone.join(' | ') : (raw.phone || ''),
    notes:          raw.source || raw.url || '',
    categorie:      raw.source ? `seek:${raw.source}` : '',
    ext_id:         raw.id || raw.username || '',
  };
}

/** Render upstream `success` boolean / total flag with a friendly status. */
function getResults(data: any): any[] {
  if (!data) return [];
  if (Array.isArray(data.results))   return data.results;
  if (Array.isArray(data.found_on))  return data.found_on;
  if (Array.isArray(data.history))   return data.history;
  if (data.profile)                  return [data.profile];
  // Single-object responses (ip, email-check, phone, domain…)
  return [data];
}

// ── Component ───────────────────────────────────────────────────────────────
export function SeekTool() {
  const [activeCat, setActiveCat]   = useState<CategoryId>('universal');
  const [activeItem, setActiveItem] = useState<string>(CATEGORIES[0].items[0].id);
  const [form, setForm]             = useState<Record<string, string>>({});
  const [loading, setLoading]       = useState(false);
  const [result, setResult]         = useState<SeekResult | null>(null);
  const [error, setError]           = useState<string | null>(null);
  const [credits, setCredits]       = useState<number | null>(null);
  const [history, setHistory]       = useState<{ key: string; query: string; ts: number; cached: boolean; results: number }[]>([]);
  const [dismissed, setDismissed]   = useState<Set<string>>(new Set());

  const cat   = CATEGORIES.find(c => c.id === activeCat)!;
  const item  = cat.items.find(i => i.id === activeItem) || cat.items[0];

  // Reset form when item changes
  useEffect(() => {
    setForm({});
    setResult(null);
    setError(null);
    setDismissed(new Set());
  }, [activeItem]);

  // When category changes, set active item to first of that cat
  useEffect(() => {
    const c = CATEGORIES.find(x => x.id === activeCat)!;
    setActiveItem(c.items[0].id);
  }, [activeCat]);

  // Initial credit fetch
  useEffect(() => {
    apiFetch<{ credits_remaining: number | null }>('/api/seek/catalog')
      .then(r => setCredits(r.credits_remaining))
      .catch(() => {});
  }, []);

  const launch = async (fresh = false) => {
    // Validate required fields
    for (const f of item.fields) {
      if (f.required && !form[f.name]?.trim()) {
        toast.error(`Champ requis : ${f.label}`);
        return;
      }
    }

    setLoading(true);
    setError(null);
    setResult(null);

    try {
      // Build payload (drop empty values)
      const params: Record<string, any> = {};
      for (const f of item.fields) {
        const v = form[f.name];
        if (v && v.trim()) params[f.name] = f.type === 'number' ? Number(v) : v.trim();
      }

      const path = `/api/seek/${item.key}${fresh ? '?fresh=1' : ''}`;
      const init: RequestInit = item.method === 'POST'
        ? { method: 'POST', body: JSON.stringify(params) }
        : { method: 'GET' };

      // For GET, append query params to the URL
      let url = path;
      if (item.method === 'GET' && Object.keys(params).length) {
        const qs = new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)]));
        url += (path.includes('?') ? '&' : '?') + qs.toString();
      }

      const r = await apiFetch<SeekResult>(url, init);
      setResult(r);
      if (r.credits_remaining != null) setCredits(r.credits_remaining);

      const queryStr = item.fields.map(f => form[f.name]).filter(Boolean).join(' / ');
      setHistory(h => [{
        key: item.key, query: queryStr, ts: Date.now(),
        cached: r.cached, results: getResults(r.data).length,
      }, ...h].slice(0, 20));

      if (r.cached)        toast.success('Résultat depuis le cache (0 crédit)');
      else if (r.ok)       toast.success(`Requête réussie (${item.cost} crédit${item.cost > 1 ? 's' : ''})`);
      else                 toast.error('Erreur upstream', { description: `HTTP ${r.status}` });
    } catch (e: any) {
      setError(e.message);
      toast.error('Erreur', { description: e.message });
    } finally {
      setLoading(false);
    }
  };

  const addAsPerson = async (raw: any) => {
    const draft = extractPersonInput(raw);
    if (!draft) { toast.error('Pas assez de données pour créer une fiche'); return; }
    if (!draft.nom || !draft.prenom || !draft.date_naissance) {
      toast.error('Champs requis manquants', {
        description: 'Cette entrée n\'a pas de nom, prénom ou date de naissance complets.',
      });
      return;
    }
    try {
      await apiFetch('/api/persons', { method: 'POST', body: JSON.stringify(draft) });
      toast.success('Fiche créée', { description: `${draft.prenom} ${draft.nom}` });
    } catch (e: any) {
      toast.error('Erreur création fiche', { description: e.message });
    }
  };

  const dismiss = (idx: number) => {
    const next = new Set(dismissed);
    next.add(`${activeItem}-${idx}`);
    setDismissed(next);
  };

  const results = result ? getResults(result.data) : [];

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="bg-card border border-border rounded-xl px-5 py-3 flex items-center gap-4 flex-wrap">
        <div className="flex items-center gap-2">
          <ShieldAlert className="w-4 h-4 text-muted-foreground" />
          <span className="text-sm font-medium text-foreground">Seek</span>
          <span className="text-xs text-muted-foreground">see-know.eu</span>
        </div>
        <div className="h-5 w-px bg-border" />
        <Stat label="Crédits restants" value={credits != null ? credits : '—'} icon={Zap}
          highlight={credits != null && credits < 50 ? 'warn' : undefined} />
        <Stat label="Cache" value="24h" icon={Database} />
        <div className="ml-auto text-[11px] text-muted-foreground">
          Toute requête identique dans les 24h = <strong className="text-emerald-400">0 crédit</strong>
        </div>
      </div>

      {/* Tabs */}
      <div className="bg-card border border-border rounded-xl p-1.5 flex flex-wrap gap-1">
        {CATEGORIES.map(c => {
          const Icon = c.Icon;
          return (
            <button key={c.id} onClick={() => setActiveCat(c.id)}
              className={`px-3 py-1.5 text-sm rounded-md flex items-center gap-2 transition-colors ${
                activeCat === c.id ? 'bg-primary text-primary-foreground font-medium' : 'text-muted-foreground hover:bg-muted'
              }`}>
              <Icon className="w-3.5 h-3.5" />
              {c.label}
            </button>
          );
        })}
      </div>

      <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
        {/* Left: items list */}
        <aside className="bg-card border border-border rounded-xl overflow-hidden">
          <div className="px-3 py-2 border-b border-border text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
            {cat.label}
          </div>
          {cat.items.map(it => {
            const ItemIcon = it.Icon;
            return (
              <button key={it.id} onClick={() => setActiveItem(it.id)}
                className={`w-full px-3 py-2.5 text-left border-b border-border last:border-0 flex items-center gap-3 transition-colors ${
                  activeItem === it.id ? 'bg-muted' : 'hover:bg-muted/40'
                }`}>
                <div className="w-8 h-8 rounded-md bg-primary/10 flex items-center justify-center flex-shrink-0">
                  <ItemIcon className="w-4 h-4 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-foreground font-medium truncate">{it.label}</p>
                  {it.description && <p className="text-[11px] text-muted-foreground truncate">{it.description}</p>}
                </div>
                <span className="text-[10px] tabular-nums px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-400 font-semibold flex-shrink-0">
                  {it.cost}cr
                </span>
              </button>
            );
          })}
        </aside>

        {/* Right: form + result */}
        <section className="space-y-4">
          {/* Form */}
          <div className="bg-card border border-border rounded-xl p-5">
            <div className="flex items-center gap-2 mb-3">
              <item.Icon className="w-5 h-5 text-primary" />
              <h2 className="text-foreground font-semibold">{item.label}</h2>
              <span className="text-xs px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-400 font-semibold ml-auto">
                {item.cost} crédit{item.cost > 1 ? 's' : ''}
              </span>
            </div>
            {item.description && <p className="text-xs text-muted-foreground mb-4">{item.description}</p>}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
              {item.fields.map(f => (
                <div key={f.name} className={item.fields.length === 1 ? 'md:col-span-2' : ''}>
                  <label className="block mb-1 text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">
                    {f.label}{f.required && ' *'}
                  </label>
                  <input type={f.type || 'text'} value={form[f.name] || ''}
                    onChange={e => setForm({ ...form, [f.name]: e.target.value })}
                    placeholder={f.placeholder}
                    onKeyDown={e => { if (e.key === 'Enter' && !loading) launch(); }}
                    className="w-full bg-input border border-border rounded-md px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-1 focus:ring-ring" />
                </div>
              ))}
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              <button onClick={() => launch(false)} disabled={loading}
                className="bg-primary hover:bg-primary/90 disabled:opacity-50 text-primary-foreground px-4 py-2 rounded-md text-sm font-medium flex items-center gap-2 transition-colors">
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                Rechercher
              </button>
              <button onClick={() => launch(true)} disabled={loading}
                title="Forcer une requête fraîche (ignore le cache, coûte des crédits)"
                className="border border-border hover:bg-muted disabled:opacity-50 text-foreground px-3 py-2 rounded-md text-xs flex items-center gap-1.5 transition-colors">
                <RefreshCw className="w-3.5 h-3.5" /> Forcer (sans cache)
              </button>
              <p className="text-[11px] text-muted-foreground ml-auto">
                Astuce : presse <kbd className="px-1.5 py-0.5 rounded bg-muted text-foreground text-[10px] font-mono">Entrée</kbd> dans n'importe quel champ.
              </p>
            </div>
          </div>

          {/* Error */}
          {error && (
            <div className="bg-card border border-destructive/40 rounded-xl p-4 flex items-start gap-3 text-sm">
              <AlertCircle className="w-5 h-5 text-destructive flex-shrink-0" />
              <div className="flex-1">
                <p className="text-foreground font-medium">Erreur</p>
                <p className="text-xs text-muted-foreground font-mono break-all">{error}</p>
              </div>
            </div>
          )}

          {/* Result */}
          {result && (
            <div className="bg-card border border-border rounded-xl overflow-hidden">
              <div className="px-5 py-3 border-b border-border flex items-center gap-3 flex-wrap">
                <span className="text-sm font-medium text-foreground">Résultats</span>
                <span className="text-xs text-muted-foreground tabular-nums">{results.length}</span>
                {result.cached ? (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-400/15 text-emerald-400 font-medium flex items-center gap-1">
                    <Database className="w-2.5 h-2.5" /> CACHE · {fmtTime(result.fetched_at)}
                  </span>
                ) : (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-400/15 text-amber-400 font-medium">
                    LIVE · {item.cost} cr
                  </span>
                )}
                {result.credits_remaining != null && (
                  <span className="text-[11px] text-muted-foreground ml-auto">
                    {result.credits_remaining} crédits restants
                  </span>
                )}
                <button onClick={() => navigator.clipboard.writeText(JSON.stringify(result.data, null, 2))}
                  className="text-xs border border-border hover:bg-muted text-foreground px-2 py-1 rounded flex items-center gap-1">
                  <Copy className="w-3 h-3" /> JSON
                </button>
              </div>

              {results.length === 0 ? (
                <div className="px-5 py-8 text-center text-sm text-muted-foreground">
                  <Eye className="w-8 h-8 mx-auto mb-2 opacity-40" />
                  Aucun résultat pour cette requête.
                </div>
              ) : (
                <div className="divide-y divide-border">
                  {results.map((r, i) => (
                    !dismissed.has(`${activeItem}-${i}`) && (
                      <ResultCard key={i} index={i + 1} raw={r}
                        onAdd={() => addAsPerson(r)}
                        onDismiss={() => dismiss(i)} />
                    )
                  ))}
                </div>
              )}
            </div>
          )}

          {/* History */}
          {history.length > 0 && (
            <div className="bg-card border border-border rounded-xl overflow-hidden">
              <div className="px-5 py-2 border-b border-border flex items-center gap-2">
                <Clock className="w-3.5 h-3.5 text-muted-foreground" />
                <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
                  Historique session
                </span>
              </div>
              <ul className="max-h-40 overflow-y-auto">
                {history.map((h, i) => (
                  <li key={i} className="px-5 py-1.5 text-xs flex items-center gap-3 border-b border-border last:border-0">
                    <span className="text-muted-foreground tabular-nums w-12">{new Date(h.ts).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</span>
                    <span className="text-foreground font-medium">{h.key}</span>
                    <span className="text-muted-foreground truncate flex-1">{h.query}</span>
                    {h.cached && <span className="text-[10px] text-emerald-400">cache</span>}
                    <span className="text-muted-foreground tabular-nums">{h.results} rés.</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

// ── Subcomponents ───────────────────────────────────────────────────────────
function Stat({ label, value, icon: Icon, highlight }: { label: string; value: any; icon: any; highlight?: 'warn' }) {
  return (
    <div className="flex items-center gap-1.5 text-sm">
      <Icon className={`w-3.5 h-3.5 ${highlight === 'warn' ? 'text-amber-400' : 'text-muted-foreground'}`} />
      <span className="text-muted-foreground">{label}</span>
      <span className={`font-semibold tabular-nums ${highlight === 'warn' ? 'text-amber-400' : 'text-foreground'}`}>{value}</span>
    </div>
  );
}

function ResultCard({ index, raw, onAdd, onDismiss }: {
  index: number; raw: any; onAdd: () => void; onDismiss: () => void;
}) {
  const draft = extractPersonInput(raw);
  const isPerson = draft && draft.nom && draft.prenom;

  // Render fields generically
  const entries = useMemo(() => {
    if (!raw || typeof raw !== 'object') return [{ k: 'value', v: String(raw) }];
    return Object.entries(raw)
      .filter(([_, v]) => v != null && v !== '' && (Array.isArray(v) ? v.length : true))
      .map(([k, v]) => ({ k, v }));
  }, [raw]);

  return (
    <div className="px-5 py-4 hover:bg-muted/20 transition-colors">
      <div className="flex items-center gap-3 mb-3">
        <div className="w-8 h-8 rounded-md bg-primary/15 text-primary font-semibold flex items-center justify-center text-xs flex-shrink-0">
          {index}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm text-foreground font-medium truncate">
            {raw.name || [raw.first_name, raw.last_name].filter(Boolean).join(' ')
              || raw.username || raw.email || raw.url || raw.platform || raw.ip || raw.domain || 'Entrée'}
          </p>
          {raw.source && <p className="text-[11px] text-muted-foreground truncate">source: {raw.source}</p>}
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {isPerson && (
            <button onClick={onAdd}
              title="Ajouter cette entrée comme une fiche"
              className="border border-emerald-400/30 bg-emerald-400/10 hover:bg-emerald-400/20 text-emerald-400 px-2.5 py-1 rounded-md text-xs flex items-center gap-1.5 transition-colors">
              <UserPlus className="w-3.5 h-3.5" /> Ajouter fiche
            </button>
          )}
          <button onClick={onDismiss} title="Masquer ce résultat"
            className="border border-border hover:bg-muted text-muted-foreground hover:text-foreground p-1 rounded transition-colors">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-4 gap-y-1.5 text-xs">
        {entries.map(({ k, v }) => (
          <div key={k} className="flex items-baseline gap-2 min-w-0">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold flex-shrink-0">
              {k}
            </span>
            <span className="text-foreground font-medium truncate font-mono text-[11px]">
              {Array.isArray(v) ? v.join(', ')
                : typeof v === 'object' ? JSON.stringify(v)
                : String(v)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
