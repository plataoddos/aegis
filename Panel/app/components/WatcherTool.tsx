import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Eye, Plus, Trash2, Loader2, Wifi, WifiOff, MessageSquare, LogIn, LogOut,
  Mic, MicOff, UserCog, Edit3, Activity, AlertCircle, Clock, Volume2,
} from 'lucide-react';
import { toast } from 'sonner';

const API_URL   = ((import.meta as any).env?.VITE_WATCHER_API_URL  as string) || 'http://localhost:8787';
const API_TOKEN = ((import.meta as any).env?.VITE_WATCHER_API_TOKEN as string) || '';

interface Watch    { user_id: string; label: string | null; added_at: number }
interface Event    {
  id: number; user_id: string; type: string; created_at: number;
  guild_id: string | null; guild_name: string | null;
  channel_id: string | null; channel_name: string | null;
  content: string | null;   extra_json: string | null;
}
interface AccountInfo { id: number; status: string; username: string | null; guilds: number; ping: number | null }
interface Status      { accounts: AccountInfo[]; ready_accounts: number; total_accounts: number; total_guilds: number; watched: number }
interface Profile  { id: string; username: string; global_name: string | null; avatar: string; created_at: number }

const EVENT_META: Record<string, { label: string; Icon: any; color: string }> = {
  message_create:  { label: 'Message',          Icon: MessageSquare, color: 'text-sky-400' },
  message_update:  { label: 'Message édité',    Icon: Edit3,         color: 'text-amber-400' },
  message_delete:  { label: 'Message supprimé', Icon: Trash2,        color: 'text-rose-400' },
  guild_join:      { label: 'A rejoint',        Icon: LogIn,         color: 'text-emerald-400' },
  guild_leave:     { label: 'A quitté',         Icon: LogOut,        color: 'text-rose-400' },
  voice_join:      { label: 'Voice rejoint',    Icon: Mic,           color: 'text-emerald-400' },
  voice_leave:     { label: 'Voice quitté',     Icon: MicOff,        color: 'text-rose-400' },
  voice_move:      { label: 'Voice déplacé',    Icon: Volume2,       color: 'text-amber-400' },
  nickname_change: { label: 'Pseudo',           Icon: UserCog,       color: 'text-amber-400' },
  roles_change:    { label: 'Rôles',            Icon: UserCog,       color: 'text-amber-400' },
  timeout:         { label: 'Timeout',          Icon: Clock,         color: 'text-rose-400' },
};

function fmtRelative(ts: number) {
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60)    return `${s}s`;
  if (s < 3600)  return `${Math.round(s / 60)}min`;
  if (s < 86400) return `${Math.round(s / 3600)}h`;
  return new Date(ts).toLocaleString('fr-FR');
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(API_URL + path, {
    ...init,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${API_TOKEN}`, ...(init?.headers || {}) },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(text || `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export function WatcherTool() {
  const [status,   setStatus]   = useState<Status | null>(null);
  const [watches,  setWatches]  = useState<Watch[]>([]);
  const [events,   setEvents]   = useState<Event[]>([]);
  const [profiles, setProfiles] = useState<Record<string, Profile>>({});
  const [filterId, setFilterId] = useState<string | null>(null);
  const [newId,    setNewId]    = useState('');
  const [newLabel, setNewLabel] = useState('');
  const [adding,   setAdding]   = useState(false);
  const [wsState,  setWsState]  = useState<'connecting' | 'open' | 'closed'>('closed');
  const [error,    setError]    = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);

  const refresh = async () => {
    try {
      const [s, w, e] = await Promise.all([
        apiFetch<Status>('/api/status'),
        apiFetch<Watch[]>('/api/watches'),
        apiFetch<Event[]>('/api/events?limit=300'),
      ]);
      setStatus(s); setWatches(w); setEvents(e);
      setError(null);
      // Lazy + sequential profile fetch with random delays — avoids bursts
      // of /users/{id} REST calls (a major selfbot detection signal).
      const missing = w.filter(watch => !profiles[watch.user_id]);
      (async () => {
        for (const watch of missing) {
          await new Promise(r => setTimeout(r, 400 + Math.random() * 800));
          try {
            const p = await apiFetch<Profile>(`/api/watches/${watch.user_id}/profile`);
            setProfiles(prev => ({ ...prev, [watch.user_id]: p }));
          } catch {}
        }
      })();
    } catch (e: any) {
      setError(e.message || 'Backend injoignable');
    }
  };

  // Initial load + WS
  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 15_000);

    const wsUrl = API_URL.replace(/^http/, 'ws') + `/ws?token=${encodeURIComponent(API_TOKEN)}`;
    setWsState('connecting');
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen    = () => setWsState('open');
    ws.onclose   = () => setWsState('closed');
    ws.onerror   = () => setWsState('closed');
    ws.onmessage = (msg) => {
      try {
        const data = JSON.parse(msg.data);
        if (data.type === 'event') {
          setEvents(prev => [data.data, ...prev].slice(0, 500));
        }
      } catch {}
    };

    return () => { clearInterval(interval); ws.close(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const addWatch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!/^\d{15,25}$/.test(newId.trim())) {
      toast.error('ID Discord invalide');
      return;
    }
    setAdding(true);
    try {
      await apiFetch('/api/watches', {
        method: 'POST',
        body: JSON.stringify({ user_id: newId.trim(), label: newLabel.trim() || null }),
      });
      setNewId(''); setNewLabel('');
      toast.success('Surveillance ajoutée');
      refresh();
    } catch (err: any) {
      toast.error('Erreur', { description: err.message });
    } finally {
      setAdding(false);
    }
  };

  const removeWatch = async (id: string) => {
    if (!confirm('Arrêter de surveiller cet ID et supprimer ses events ?')) return;
    try {
      await apiFetch(`/api/watches/${id}`, { method: 'DELETE' });
      if (filterId === id) setFilterId(null);
      toast.success('Surveillance retirée');
      refresh();
    } catch (err: any) { toast.error('Erreur', { description: err.message }); }
  };

  const filteredEvents = useMemo(
    () => filterId ? events.filter(e => e.user_id === filterId) : events,
    [events, filterId]
  );

  // ── Backend down ──────────────────────────────────────────────────────────
  if (error) {
    return (
      <div className="bg-card border border-border rounded-lg p-8 text-center">
        <AlertCircle className="w-10 h-10 text-destructive mx-auto mb-3" />
        <h3 className="text-foreground font-semibold mb-1">Backend Watcher injoignable</h3>
        <p className="text-sm text-muted-foreground mb-4">{error}</p>
        <p className="text-xs text-muted-foreground max-w-md mx-auto">
          Lance le backend : <code className="bg-muted px-1.5 py-0.5 rounded font-mono">cd backend && npm run dev</code><br />
          Et configure <code className="bg-muted px-1.5 py-0.5 rounded font-mono">VITE_WATCHER_API_URL</code> / <code className="bg-muted px-1.5 py-0.5 rounded font-mono">VITE_WATCHER_API_TOKEN</code> dans <code className="bg-muted px-1.5 py-0.5 rounded font-mono">.env.local</code> du panel.
        </p>
        <button onClick={refresh} className="mt-4 text-sm border border-border rounded-md px-3 py-1.5 hover:bg-muted text-foreground">Réessayer</button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Status bar */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="Comptes connectés" value={status ? `${status.ready_accounts}/${status.total_accounts}` : '—'} />
        <StatCard label="Serveurs couverts" value={status?.total_guilds ?? '—'} />
        <StatCard label="IDs surveillés"    value={watches.length} />
        <div className="bg-card border border-border rounded-xl p-5">
          <p className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">Stream live</p>
          <div className="flex items-center gap-2 mt-2">
            {wsState === 'open'
              ? <><Wifi className="w-4 h-4 text-emerald-400" /><span className="text-emerald-400 font-medium">Connecté</span></>
              : wsState === 'connecting'
              ? <><Loader2 className="w-4 h-4 animate-spin text-muted-foreground" /><span className="text-muted-foreground font-medium">Connexion...</span></>
              : <><WifiOff className="w-4 h-4 text-rose-400" /><span className="text-rose-400 font-medium">Déconnecté</span></>}
          </div>
          <p className="text-xs text-muted-foreground mt-1">{events.length} événements en mémoire</p>
        </div>
      </div>

      {/* Add form */}
      <div className="bg-card border border-border rounded-lg p-6">
        <form onSubmit={addWatch} className="flex flex-wrap gap-3">
          <input value={newId} onChange={e => setNewId(e.target.value)} placeholder="ID Discord (snowflake)"
            className="flex-1 min-w-[200px] bg-input border border-border rounded-md px-4 py-2.5 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary font-mono text-sm" />
          <input value={newLabel} onChange={e => setNewLabel(e.target.value)} placeholder="Label (optionnel)"
            className="flex-1 min-w-[160px] bg-input border border-border rounded-md px-4 py-2.5 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary text-sm" />
          <button type="submit" disabled={adding}
            className="bg-primary hover:bg-primary/90 disabled:opacity-60 text-primary-foreground px-6 py-2.5 rounded-md flex items-center gap-2 whitespace-nowrap">
            {adding ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}Surveiller
          </button>
        </form>
      </div>

      <div className="grid lg:grid-cols-[320px_1fr] gap-6">
        {/* Watch list */}
        <div className="bg-card border border-border rounded-lg overflow-hidden">
          <div className="px-5 py-3 border-b border-border flex items-center gap-2">
            <Eye className="w-4 h-4 text-muted-foreground" />
            <span className="text-foreground font-medium text-sm">Surveillés</span>
            <span className="ml-auto text-xs text-muted-foreground">{watches.length}</span>
          </div>
          <div className="divide-y divide-border max-h-[60vh] overflow-y-auto">
            <button onClick={() => setFilterId(null)}
              className={`w-full px-5 py-3 text-left text-sm transition-colors ${!filterId ? 'bg-muted text-foreground' : 'text-muted-foreground hover:bg-muted/50'}`}>
              Tous les flux
            </button>
            {watches.length === 0 && (
              <p className="px-5 py-8 text-center text-sm text-muted-foreground">Aucun ID surveillé</p>
            )}
            {watches.map(w => {
              const profile = profiles[w.user_id];
              const eventCount = events.filter(e => e.user_id === w.user_id).length;
              return (
                <div key={w.user_id} className={`flex items-center gap-3 px-5 py-3 transition-colors ${filterId === w.user_id ? 'bg-muted' : 'hover:bg-muted/50'}`}>
                  <button onClick={() => setFilterId(w.user_id)} className="flex items-center gap-3 flex-1 min-w-0">
                    {profile?.avatar
                      ? <img src={profile.avatar} alt="" className="w-8 h-8 rounded-full flex-shrink-0" />
                      : <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center text-xs text-muted-foreground flex-shrink-0">?</div>}
                    <div className="flex-1 min-w-0 text-left">
                      <p className="text-foreground text-sm truncate">{w.label || profile?.global_name || profile?.username || 'Inconnu'}</p>
                      <p className="text-xs text-muted-foreground font-mono truncate">{w.user_id}</p>
                    </div>
                    {eventCount > 0 && (
                      <span className="text-xs px-1.5 py-0.5 rounded bg-foreground/10 text-foreground font-mono">{eventCount}</span>
                    )}
                  </button>
                  <button onClick={() => removeWatch(w.user_id)} className="text-muted-foreground hover:text-destructive p-1 rounded transition-colors flex-shrink-0">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              );
            })}
          </div>
        </div>

        {/* Live feed */}
        <div className="bg-card border border-border rounded-lg overflow-hidden">
          <div className="px-5 py-3 border-b border-border flex items-center justify-between">
            <span className="text-foreground font-medium text-sm">
              {filterId
                ? <>Flux de <span className="font-mono text-muted-foreground">{watches.find(w => w.user_id === filterId)?.label || filterId}</span></>
                : 'Flux global'}
            </span>
            <span className="text-xs text-muted-foreground">{filteredEvents.length} events</span>
          </div>
          <div className="max-h-[60vh] overflow-y-auto">
            {filteredEvents.length === 0 ? (
              <p className="px-5 py-12 text-center text-sm text-muted-foreground">
                Aucun événement à afficher. Les nouveaux events apparaissent en temps réel.
              </p>
            ) : (
              <ul className="divide-y divide-border">
                {filteredEvents.map(evt => <EventItem key={evt.id} evt={evt} profile={profiles[evt.user_id]} />)}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="bg-card border border-border rounded-xl p-5">
      <p className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">{label}</p>
      <p className="text-3xl font-bold text-foreground mt-2 tabular-nums">{value}</p>
    </div>
  );
}

function EventItem({ evt, profile }: { evt: Event; profile?: Profile }) {
  const meta = EVENT_META[evt.type] || { label: evt.type, Icon: Activity, color: 'text-muted-foreground' };
  const Icon = meta.Icon;
  const extra = evt.extra_json ? safeParse(evt.extra_json) : null;

  return (
    <li className="px-5 py-3 hover:bg-muted/30 transition-colors">
      <div className="flex items-start gap-3">
        <div className={`w-8 h-8 rounded-md bg-muted flex items-center justify-center flex-shrink-0 ${meta.color}`}>
          <Icon className="w-4 h-4" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-foreground text-sm font-medium">{profile?.global_name || profile?.username || evt.user_id}</span>
            <span className={`text-xs ${meta.color}`}>{meta.label}</span>
            {evt.guild_name && (
              <span className="text-xs text-muted-foreground">· {evt.guild_name}</span>
            )}
            {evt.channel_name && (
              <span className="text-xs text-muted-foreground">#{evt.channel_name}</span>
            )}
            <span className="ml-auto text-xs text-muted-foreground tabular-nums">{fmtRelative(evt.created_at)}</span>
          </div>
          {evt.content && (
            <p className="text-sm text-foreground/80 mt-1 break-words">{evt.content}</p>
          )}
          {extra && (
            <ExtraInfo type={evt.type} extra={extra} />
          )}
        </div>
      </div>
    </li>
  );
}

function ExtraInfo({ type, extra }: { type: string; extra: any }) {
  if (type === 'presence_update') {
    return <p className="text-xs text-muted-foreground mt-1">{extra.from || 'offline'} → <span className="text-foreground">{extra.to}</span></p>;
  }
  if (type === 'nickname_change') {
    return <p className="text-xs text-muted-foreground mt-1"><span className="line-through">{extra.from || '∅'}</span> → <span className="text-foreground">{extra.to || '∅'}</span></p>;
  }
  if (type === 'roles_change') {
    return (
      <div className="text-xs mt-1 flex flex-wrap gap-1">
        {(extra.added || []).map((r: any) => <span key={r.id} className="px-1.5 py-0.5 rounded bg-emerald-400/10 text-emerald-400">+ {r.name}</span>)}
        {(extra.removed || []).map((r: any) => <span key={r.id} className="px-1.5 py-0.5 rounded bg-rose-400/10 text-rose-400">− {r.name}</span>)}
      </div>
    );
  }
  if (type === 'message_create' && extra.attachments?.length) {
    return (
      <div className="text-xs text-muted-foreground mt-1">
        {extra.attachments.length} pièce(s) jointe(s) : {extra.attachments.map((a: any) => a.name).join(', ')}
      </div>
    );
  }
  return null;
}

function safeParse(json: string) {
  try { return JSON.parse(json); } catch { return null; }
}
