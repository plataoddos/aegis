/**
 * Canaris / Triggers d'Alerte (Honeytokens)
 *
 * Tu crées un "canari" (URL invisible, pixel 1×1, ou redirection),
 * tu le places quelque part (email, fichier, README privé, etc.).
 * Dès que quelqu'un le déclenche → on enregistre IP, UA, géoloc,
 * referer, méthode HTTP. Tu vois le tout en temps réel ici.
 */
import { useEffect, useMemo, useState } from 'react';
import {
  Plus, Eye, Trash2, Copy, Check, Bell, BellOff, Activity,
  Globe, Image as ImageIcon, ExternalLink, RefreshCw, Loader2,
  AlertTriangle, MapPin, Clock, X, ShieldAlert, Sparkles, Flame,
} from 'lucide-react';
import { toast } from 'sonner';

const API_URL   = ((import.meta as any).env?.VITE_WATCHER_API_URL  as string) || 'http://localhost:8787';
const API_TOKEN = ((import.meta as any).env?.VITE_WATCHER_API_TOKEN as string) || '';
const PUBLIC_BASE = API_URL.replace(/\/$/, ''); // base for /h/:id

interface CanaryToken {
  id: string;
  label: string;
  type: 'url' | 'pixel' | 'redirect';
  note: string | null;
  redirect_url: string | null;
  enabled: number;
  created_at: number;
  last_hit_at: number | null;
  hit_count: number;
}

interface CanaryEvent {
  id: number;
  token_id: string;
  ip: string | null;
  user_agent: string | null;
  referer: string | null;
  method: string | null;
  path: string | null;
  country: string | null;
  country_code: string | null;
  city: string | null;
  org: string | null;
  created_at: number;
  token_label?: string;
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
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

const TYPE_META: Record<CanaryToken['type'], { label: string; icon: any; description: string; tone: string }> = {
  url:      { label: 'URL', icon: Globe, description: 'Lien invisible — colle-le n\'importe où (README, doc, mail texte).', tone: 'text-indigo-400 bg-indigo-500/10 ring-indigo-500/30' },
  pixel:    { label: 'Pixel 1×1', icon: ImageIcon, description: 'Image transparente — embed dans un email HTML pour tracker l\'ouverture.', tone: 'text-rose-400 bg-rose-500/10 ring-rose-500/30' },
  redirect: { label: 'Redirection', icon: ExternalLink, description: 'Redirige vers une URL légitime après alerte — invisible côté cible.', tone: 'text-amber-400 bg-amber-500/10 ring-amber-500/30' },
};

export function CanaryTool() {
  const [tokens, setTokens]     = useState<CanaryToken[]>([]);
  const [events, setEvents]     = useState<CanaryEvent[]>([]);
  const [loading, setLoading]   = useState(true);
  const [selected, setSelected] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  const refresh = async () => {
    try {
      const [toks, evs] = await Promise.all([
        api<CanaryToken[]>('/api/canaries'),
        api<CanaryEvent[]>('/api/canary-events?limit=100'),
      ]);
      setTokens(toks);
      setEvents(evs);
    } catch (e: any) {
      toast.error('Impossible de charger les canaris', { description: e.message });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { refresh(); }, []);
  useEffect(() => {
    const t = setInterval(refresh, 8000); // poll every 8s
    return () => clearInterval(t);
  }, []);

  const selectedToken = tokens.find(t => t.id === selected) || null;
  const selectedEvents = useMemo(
    () => events.filter(e => !selected || e.token_id === selected),
    [events, selected],
  );

  const totalHits = tokens.reduce((s, t) => s + t.hit_count, 0);
  const activeCount = tokens.filter(t => t.enabled).length;

  const removeToken = async (id: string) => {
    if (!confirm('Supprimer ce canari ? Les événements seront aussi supprimés.')) return;
    try {
      await api(`/api/canaries/${id}`, { method: 'DELETE' });
      toast.success('Canari supprimé');
      if (selected === id) setSelected(null);
      refresh();
    } catch (e: any) {
      toast.error('Erreur', { description: e.message });
    }
  };

  const toggleEnabled = async (t: CanaryToken) => {
    try {
      await api(`/api/canaries/${t.id}`, { method: 'PATCH', body: JSON.stringify({ enabled: !t.enabled }) });
      refresh();
    } catch (e: any) {
      toast.error('Erreur', { description: e.message });
    }
  };

  return (
    <div className="space-y-5">
      {/* Hero */}
      <div className="relative aegis-card aegis-card-edge aegis-card-holo overflow-hidden px-6 py-7">
        <div className="aegis-orb aegis-orb--rose"   style={{ top: -80, left: -60, width: 280, height: 280 }} />
        <div className="aegis-orb aegis-orb--amber"  style={{ top: -40, right: -60, width: 240, height: 240, animationDelay: '4s' }} />

        <div className="relative flex items-center gap-3">
          <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-rose-500/30 to-amber-500/10 ring-1 ring-rose-500/40 flex items-center justify-center shadow-lg shadow-rose-500/20">
            <Flame className="w-5 h-5 text-rose-300" />
          </div>
          <div className="flex-1">
            <h1 className="text-xl font-bold tracking-tight">
              <span className="aegis-iridescent">Canaris</span>
              <span className="text-foreground"> · Triggers d'Alerte</span>
            </h1>
            <p className="text-[11px] text-muted-foreground leading-tight">
              Honeytokens — détection d'intrusion par appâts. URL / pixel email / redirection.
            </p>
          </div>

          <div className="flex items-center gap-4">
            <Stat label="Actifs"   value={`${activeCount}/${tokens.length}`} />
            <Stat label="Hits"     value={totalHits} tone={totalHits > 0 ? 'rose' : undefined} />
            <button onClick={() => setShowCreate(true)}
              className="aegis-btn-primary text-primary-foreground px-3 py-2 rounded-lg text-xs font-semibold flex items-center gap-1.5">
              <Plus className="w-3.5 h-3.5" /> Nouveau canari
            </button>
          </div>
        </div>
      </div>

      {/* Empty state */}
      {!loading && tokens.length === 0 && (
        <div className="aegis-card aegis-card-edge p-10 text-center">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-rose-500/20 to-amber-500/0 ring-1 ring-rose-500/30 flex items-center justify-center mx-auto mb-4 shadow-lg shadow-rose-500/10">
            <Sparkles className="w-7 h-7 text-rose-300" />
          </div>
          <p className="text-foreground font-semibold mb-1">Aucun canari pour l'instant</p>
          <p className="text-xs text-muted-foreground max-w-md mx-auto mb-4">
            Crée ton premier honeytoken — URL invisible, pixel email ou redirection — et place-le là où une fuite te ferait mal.
          </p>
          <button onClick={() => setShowCreate(true)}
            className="aegis-btn-primary text-primary-foreground px-4 py-2 rounded-lg text-xs font-semibold inline-flex items-center gap-1.5">
            <Plus className="w-3.5 h-3.5" /> Créer un canari
          </button>
        </div>
      )}

      {tokens.length > 0 && (
        <div className="grid gap-4 lg:grid-cols-[420px_1fr]">
          {/* Tokens list */}
          <div className="space-y-2">
            <div className="flex items-center gap-2 px-1">
              <h2 className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Mes canaris</h2>
              <button onClick={refresh} className="ml-auto text-muted-foreground hover:text-foreground p-1 rounded">
                <RefreshCw className="w-3 h-3" />
              </button>
            </div>
            {tokens.map(t => (
              <CanaryCard
                key={t.id}
                token={t}
                active={selected === t.id}
                onSelect={() => setSelected(t.id === selected ? null : t.id)}
                onToggle={() => toggleEnabled(t)}
                onDelete={() => removeToken(t.id)}
              />
            ))}
          </div>

          {/* Events feed */}
          <div className="space-y-2">
            <div className="flex items-center gap-2 px-1">
              <Activity className={`w-3 h-3 ${selectedEvents.length > 0 ? 'text-rose-400 aegis-pulse' : 'text-muted-foreground'}`} />
              <h2 className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
                {selected ? `Événements · ${selectedToken?.label}` : 'Tous les déclenchements'}
              </h2>
              <span className="text-[10px] text-muted-foreground tabular-nums ml-auto">
                {selectedEvents.length} hit{selectedEvents.length > 1 ? 's' : ''}
              </span>
              {selected && (
                <button onClick={() => setSelected(null)} className="text-muted-foreground hover:text-foreground p-1">
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>

            {selectedEvents.length === 0 ? (
              <div className="aegis-card aegis-card-edge p-8 text-center">
                <Eye className="w-8 h-8 text-muted-foreground/30 mx-auto mb-2" />
                <p className="text-sm text-muted-foreground">Aucun déclenchement pour l'instant.</p>
                <p className="text-[11px] text-muted-foreground/60 mt-1">Le poll est de 8s · ou clique sur le rafraîchir manuel.</p>
              </div>
            ) : (
              <div className="space-y-1.5 max-h-[600px] overflow-y-auto pr-1">
                {selectedEvents.map(ev => <EventCard key={ev.id} ev={ev} showLabel={!selected} />)}
              </div>
            )}
          </div>
        </div>
      )}

      {showCreate && <CreateModal onClose={() => setShowCreate(false)} onCreated={refresh} />}
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────
function Stat({ label, value, tone }: { label: string; value: any; tone?: 'rose' }) {
  return (
    <div className="flex flex-col items-end">
      <span className={`text-sm font-bold tabular-nums leading-none ${tone === 'rose' ? 'text-rose-400' : 'text-foreground'}`}>{value}</span>
      <span className="text-[9px] uppercase tracking-wider text-muted-foreground/70 font-semibold mt-0.5">{label}</span>
    </div>
  );
}

function CanaryCard({ token, active, onSelect, onToggle, onDelete }: {
  token: CanaryToken; active: boolean;
  onSelect: () => void; onToggle: () => void; onDelete: () => void;
}) {
  const meta = TYPE_META[token.type];
  const Icon = meta.icon;
  const url = token.type === 'pixel' ? `${PUBLIC_BASE}/h/${token.id}.gif` : `${PUBLIC_BASE}/h/${token.id}`;
  const [copied, setCopied] = useState(false);

  const copy = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
    toast.success('URL copiée');
  };

  return (
    <div onClick={onSelect}
      className={`aegis-card aegis-card-edge aegis-lift cursor-pointer p-3 transition-all ${
        active ? 'border-rose-500/40 shadow-rose-500/10 shadow-lg' : ''
      }`}>
      <div className="flex items-center gap-3 mb-2">
        <div className={`w-9 h-9 rounded-lg ring-1 ${meta.tone} flex items-center justify-center flex-shrink-0`}>
          <Icon className="w-4 h-4" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-sm text-foreground font-semibold truncate">{token.label}</p>
            {token.hit_count > 0 && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-rose-500/15 text-rose-400 font-bold tabular-nums">
                {token.hit_count}
              </span>
            )}
            {!token.enabled && <BellOff className="w-3 h-3 text-muted-foreground/50" />}
          </div>
          <p className="text-[11px] text-muted-foreground truncate">{meta.label}{token.note ? ` · ${token.note}` : ''}</p>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          <button onClick={(e) => { e.stopPropagation(); onToggle(); }} title={token.enabled ? 'Désactiver' : 'Activer'}
            className="p-1.5 rounded text-muted-foreground hover:text-foreground hover:bg-white/5">
            {token.enabled ? <Bell className="w-3.5 h-3.5" /> : <BellOff className="w-3.5 h-3.5" />}
          </button>
          <button onClick={(e) => { e.stopPropagation(); onDelete(); }} title="Supprimer"
            className="p-1.5 rounded text-muted-foreground hover:text-rose-400 hover:bg-rose-500/10">
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      <div className="flex items-center gap-2 bg-black/40 rounded-md border border-white/5 px-2 py-1.5">
        <Icon className="w-3 h-3 text-muted-foreground flex-shrink-0" />
        <code className="text-[11px] text-muted-foreground font-mono truncate flex-1">{url}</code>
        <button onClick={copy} className="text-muted-foreground hover:text-foreground p-0.5">
          {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
        </button>
      </div>

      {token.last_hit_at && (
        <div className="flex items-center gap-1.5 mt-2 text-[10px] text-rose-400/80">
          <Clock className="w-2.5 h-2.5" />
          Dernier hit : {new Date(token.last_hit_at).toLocaleString('fr-FR')}
        </div>
      )}
    </div>
  );
}

function EventCard({ ev, showLabel }: { ev: CanaryEvent; showLabel?: boolean }) {
  const flag = ev.country_code
    ? String.fromCodePoint(...[...ev.country_code.toUpperCase()].map(c => 0x1F1A5 + c.charCodeAt(0)))
    : '🌐';
  const ts = new Date(ev.created_at);
  const recent = Date.now() - ev.created_at < 60_000;

  return (
    <div className={`aegis-card aegis-card-edge p-2.5 ${recent ? 'border-rose-500/30 shadow-rose-500/10 shadow' : ''}`}>
      <div className="flex items-start gap-2.5">
        <div className="w-8 h-8 rounded-md bg-rose-500/10 ring-1 ring-rose-500/30 flex items-center justify-center flex-shrink-0">
          <span className="text-sm">{flag}</span>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-xs font-semibold text-foreground truncate">
              {ev.country || 'Inconnu'}{ev.city ? ` · ${ev.city}` : ''}
            </p>
            {recent && <span className="text-[9px] uppercase tracking-wider text-rose-400 font-bold aegis-pulse">LIVE</span>}
            <span className="text-[10px] text-muted-foreground tabular-nums ml-auto">
              {ts.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
            </span>
          </div>
          {showLabel && ev.token_label && (
            <p className="text-[10px] text-rose-300/80 mb-0.5">→ {ev.token_label}</p>
          )}
          <div className="text-[11px] text-muted-foreground space-y-0.5 mt-0.5">
            <div className="flex items-center gap-1.5">
              <span className="font-mono">{ev.ip || '—'}</span>
              <span className="text-muted-foreground/50">·</span>
              <span className="text-muted-foreground/80 truncate">{ev.org || ''}</span>
            </div>
            {ev.user_agent && (
              <div className="font-mono text-muted-foreground/70 truncate" title={ev.user_agent}>
                {ev.user_agent}
              </div>
            )}
            {ev.referer && (
              <div className="text-muted-foreground/70 truncate" title={ev.referer}>
                Referer : <span className="font-mono">{ev.referer}</span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function CreateModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [type, setType]     = useState<CanaryToken['type']>('url');
  const [label, setLabel]   = useState('');
  const [note, setNote]     = useState('');
  const [redirect, setRedirect] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!label.trim()) { toast.error('Label requis'); return; }
    if (type === 'redirect' && !redirect.trim()) { toast.error('URL de redirection requise'); return; }
    setSaving(true);
    try {
      await api('/api/canaries', {
        method: 'POST',
        body: JSON.stringify({
          label: label.trim(), type,
          note: note.trim() || null,
          redirect_url: type === 'redirect' ? redirect.trim() : null,
        }),
      });
      toast.success('Canari créé');
      onCreated();
      onClose();
    } catch (e: any) {
      toast.error('Erreur', { description: e.message });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="aegis-card aegis-card-edge max-w-lg w-full p-6" onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-xl bg-rose-500/15 ring-1 ring-rose-500/40 flex items-center justify-center">
            <Flame className="w-5 h-5 text-rose-300" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-foreground">Nouveau canari</h2>
            <p className="text-[11px] text-muted-foreground">Place-le là où une intrusion ferait mal.</p>
          </div>
          <button onClick={onClose} className="ml-auto text-muted-foreground hover:text-foreground p-1">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Type picker */}
        <div className="grid grid-cols-3 gap-2 mb-4">
          {(Object.keys(TYPE_META) as CanaryToken['type'][]).map(k => {
            const m = TYPE_META[k];
            const Icon = m.icon;
            const active = type === k;
            return (
              <button key={k} onClick={() => setType(k)}
                className={`p-3 rounded-lg border text-left transition-all ${
                  active ? 'border-rose-500/40 bg-rose-500/10 shadow-rose-500/10 shadow' : 'border-white/10 bg-white/[0.02] hover:bg-white/[0.05]'
                }`}>
                <Icon className={`w-4 h-4 mb-1.5 ${active ? 'text-rose-300' : 'text-muted-foreground'}`} />
                <p className="text-xs font-semibold text-foreground">{m.label}</p>
                <p className="text-[10px] text-muted-foreground leading-tight mt-0.5">{m.description}</p>
              </button>
            );
          })}
        </div>

        <div className="space-y-3">
          <label className="block">
            <span className="block mb-1 text-[10px] uppercase tracking-wider text-muted-foreground/80 font-semibold">Label (interne) *</span>
            <input value={label} onChange={e => setLabel(e.target.value)} autoFocus
              placeholder='ex: "Lien dans email RH"'
              className="w-full bg-black/30 border border-white/10 rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-2 focus:ring-rose-500/40 focus:border-rose-500/40" />
          </label>

          <label className="block">
            <span className="block mb-1 text-[10px] uppercase tracking-wider text-muted-foreground/80 font-semibold">Placement (note interne)</span>
            <input value={note} onChange={e => setNote(e.target.value)}
              placeholder='ex: "Embed dans le mail à compta@x.com du 12/03"'
              className="w-full bg-black/30 border border-white/10 rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-2 focus:ring-rose-500/40 focus:border-rose-500/40" />
          </label>

          {type === 'redirect' && (
            <label className="block">
              <span className="block mb-1 text-[10px] uppercase tracking-wider text-muted-foreground/80 font-semibold">URL de redirection *</span>
              <input value={redirect} onChange={e => setRedirect(e.target.value)}
                placeholder="https://example.com/document-legitime.pdf"
                className="w-full bg-black/30 border border-white/10 rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-2 focus:ring-rose-500/40 focus:border-rose-500/40 font-mono" />
              <p className="text-[10px] text-muted-foreground mt-1">
                <AlertTriangle className="w-2.5 h-2.5 inline mr-1 text-amber-400" />
                Après alerte, le visiteur sera redirigé silencieusement vers cette URL.
              </p>
            </label>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 mt-5">
          <button onClick={onClose} disabled={saving}
            className="border border-white/10 hover:bg-white/5 text-muted-foreground hover:text-foreground px-3 py-2 rounded-lg text-xs font-medium">
            Annuler
          </button>
          <button onClick={submit} disabled={saving}
            className="aegis-btn-primary text-primary-foreground px-4 py-2 rounded-lg text-xs font-semibold flex items-center gap-1.5">
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
            Créer le canari
          </button>
        </div>
      </div>
    </div>
  );
}
