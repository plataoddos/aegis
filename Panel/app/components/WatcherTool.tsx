import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Plus, Trash2, Loader2, Search, X, MessageSquare, LogIn, LogOut,
  Mic, MicOff, Volume2, UserCog, Edit3, Activity, AlertCircle,
  Clock, Radio, Filter, ChevronDown, ChevronUp, ArrowDownToLine,
  Hash, Server, Eye,
} from 'lucide-react';
import { toast } from 'sonner';

const API_URL   = ((import.meta as any).env?.VITE_WATCHER_API_URL  as string) || 'http://localhost:8787';
const API_TOKEN = ((import.meta as any).env?.VITE_WATCHER_API_TOKEN as string) || '';

// ── Types ───────────────────────────────────────────────────────────────────
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

const EVENT_META: Record<string, { label: string; Icon: any; color: string; bg: string; group: string }> = {
  message_create:  { label: 'Message',          Icon: MessageSquare, color: 'text-sky-400',     bg: 'bg-sky-400/10',     group: 'msg' },
  message_update:  { label: 'Message édité',    Icon: Edit3,         color: 'text-amber-400',   bg: 'bg-amber-400/10',   group: 'msg' },
  message_delete:  { label: 'Message supprimé', Icon: Trash2,        color: 'text-rose-400',    bg: 'bg-rose-400/10',    group: 'msg' },
  guild_join:      { label: 'A rejoint',        Icon: LogIn,         color: 'text-emerald-400', bg: 'bg-emerald-400/10', group: 'guild' },
  guild_leave:     { label: 'A quitté',         Icon: LogOut,        color: 'text-rose-400',    bg: 'bg-rose-400/10',    group: 'guild' },
  voice_join:      { label: 'Voice rejoint',    Icon: Mic,           color: 'text-emerald-400', bg: 'bg-emerald-400/10', group: 'voice' },
  voice_leave:     { label: 'Voice quitté',     Icon: MicOff,        color: 'text-rose-400',    bg: 'bg-rose-400/10',    group: 'voice' },
  voice_move:      { label: 'Voice déplacé',    Icon: Volume2,       color: 'text-amber-400',   bg: 'bg-amber-400/10',   group: 'voice' },
  nickname_change: { label: 'Pseudo modifié',   Icon: UserCog,       color: 'text-amber-400',   bg: 'bg-amber-400/10',   group: 'profile' },
  roles_change:    { label: 'Rôles modifiés',   Icon: UserCog,       color: 'text-amber-400',   bg: 'bg-amber-400/10',   group: 'profile' },
  timeout:         { label: 'Timeout',          Icon: Clock,         color: 'text-rose-400',    bg: 'bg-rose-400/10',    group: 'mod' },
};

const TYPE_GROUPS: { id: string; label: string; types: string[] }[] = [
  { id: 'all',   label: 'Tous',     types: [] },
  { id: 'msg',   label: 'Messages', types: ['message_create', 'message_update', 'message_delete'] },
  { id: 'voice', label: 'Voice',    types: ['voice_join', 'voice_leave', 'voice_move'] },
  { id: 'guild', label: 'Serveur',  types: ['guild_join', 'guild_leave'] },
  { id: 'profile', label: 'Profil', types: ['nickname_change', 'roles_change'] },
  { id: 'mod',   label: 'Modé',     types: ['timeout'] },
];

// ── Helpers ─────────────────────────────────────────────────────────────────
function fmtRelative(ts: number) {
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 5)     return 'maintenant';
  if (s < 60)    return `${s}s`;
  if (s < 3600)  return `${Math.round(s / 60)}min`;
  if (s < 86400) return `${Math.round(s / 3600)}h`;
  return new Date(ts).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' });
}

function fmtFull(ts: number) {
  return new Date(ts).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'medium' });
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(API_URL + path, {
    ...init,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${API_TOKEN}`, ...(init?.headers || {}) },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    let msg = `HTTP ${res.status}`;
    try { msg = JSON.parse(text).error || msg; } catch { if (text) msg = text; }
    throw new Error(msg);
  }
  return res.json() as Promise<T>;
}

function safeParse(json: string | null) {
  if (!json) return null;
  try { return JSON.parse(json); } catch { return null; }
}

// ── Component ───────────────────────────────────────────────────────────────
export function WatcherTool() {
  const [status,   setStatus]   = useState<Status | null>(null);
  const [watches,  setWatches]  = useState<Watch[]>([]);
  const [events,   setEvents]   = useState<Event[]>([]);
  const [profiles, setProfiles] = useState<Record<string, Profile>>({});
  const [filterId, setFilterId] = useState<string | null>(null);
  const [typeGroup, setTypeGroup] = useState<string>('all');
  const [search,   setSearch]   = useState('');
  const [showAdd,  setShowAdd]  = useState(false);
  const [newId,    setNewId]    = useState('');
  const [newLabel, setNewLabel] = useState('');
  const [adding,   setAdding]   = useState(false);
  const [wsState,  setWsState]  = useState<'connecting' | 'open' | 'closed'>('closed');
  const [error,    setError]    = useState<string | null>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const [collapseLeft, setCollapseLeft] = useState(false);

  const wsRef    = useRef<WebSocket | null>(null);
  const feedRef  = useRef<HTMLDivElement | null>(null);
  const profilesRef = useRef(profiles);
  profilesRef.current = profiles;

  const refresh = async () => {
    try {
      const [s, w, e] = await Promise.all([
        apiFetch<Status>('/api/status'),
        apiFetch<Watch[]>('/api/watches'),
        apiFetch<Event[]>('/api/events?limit=500'),
      ]);
      setStatus(s); setWatches(w); setEvents(e);
      setError(null);
      // Lazy fetch profiles for any unknown
      const missing = w.filter(x => !profilesRef.current[x.user_id]);
      (async () => {
        for (const watch of missing) {
          await new Promise(r => setTimeout(r, 250 + Math.random() * 350));
          try {
            const p = await apiFetch<Profile>(`/api/watches/${watch.user_id}/profile`);
            setProfiles(prev => ({ ...prev, [watch.user_id]: p }));
          } catch { /* ignore */ }
        }
      })();
    } catch (e: any) {
      setError(e.message || 'Backend injoignable');
    }
  };

  // Initial load + WS
  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 20_000);

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
          setEvents(prev => {
            const next = [data.data, ...prev];
            return next.length > 600 ? next.slice(0, 600) : next;
          });
        }
      } catch {}
    };
    return () => { clearInterval(interval); ws.close(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-scroll on new events when enabled
  useEffect(() => {
    if (autoScroll && feedRef.current) feedRef.current.scrollTop = 0;
  }, [events, autoScroll]);

  // ── Mutations ─────────────────────────────────────────────────────────────
  const addWatch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!/^\d{15,25}$/.test(newId.trim())) {
      toast.error('ID Discord invalide (snowflake attendu)');
      return;
    }
    setAdding(true);
    try {
      const r: any = await apiFetch('/api/watches', {
        method: 'POST',
        body: JSON.stringify({ user_id: newId.trim(), label: newLabel.trim() || null }),
      });
      if (r?.profile) setProfiles(prev => ({ ...prev, [newId.trim()]: r.profile }));
      setNewId(''); setNewLabel(''); setShowAdd(false);
      toast.success('Cible ajoutée', { description: r?.profile?.username || newId.trim() });
      refresh();
    } catch (err: any) { toast.error('Erreur', { description: err.message }); }
    finally { setAdding(false); }
  };

  const removeWatch = async (id: string, label: string) => {
    if (!confirm(`Arrêter de surveiller ${label} ?\nTous ses events seront supprimés.`)) return;
    try {
      await apiFetch(`/api/watches/${id}`, { method: 'DELETE' });
      if (filterId === id) setFilterId(null);
      setProfiles(prev => { const n = { ...prev }; delete n[id]; return n; });
      toast.success('Cible retirée');
      refresh();
    } catch (err: any) { toast.error('Erreur', { description: err.message }); }
  };

  // ── Computed ──────────────────────────────────────────────────────────────
  const lastSeenByUser = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of events) {
      const cur = m.get(e.user_id) || 0;
      if (e.created_at > cur) m.set(e.user_id, e.created_at);
    }
    return m;
  }, [events]);

  const eventCountByUser = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of events) m.set(e.user_id, (m.get(e.user_id) || 0) + 1);
    return m;
  }, [events]);

  const sortedWatches = useMemo(() => {
    return [...watches].sort((a, b) => {
      const la = lastSeenByUser.get(a.user_id) || 0;
      const lb = lastSeenByUser.get(b.user_id) || 0;
      if (lb !== la) return lb - la;
      return b.added_at - a.added_at;
    });
  }, [watches, lastSeenByUser]);

  const allowedTypes = useMemo(() => {
    const g = TYPE_GROUPS.find(g => g.id === typeGroup);
    return g && g.types.length ? new Set(g.types) : null;
  }, [typeGroup]);

  const filteredEvents = useMemo(() => {
    const q = search.trim().toLowerCase();
    return events.filter(e => {
      if (filterId && e.user_id !== filterId) return false;
      if (allowedTypes && !allowedTypes.has(e.type)) return false;
      if (q) {
        const hay = [e.content, e.guild_name, e.channel_name, e.user_id, e.type].join(' ').toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [events, filterId, allowedTypes, search]);

  const currentTarget = filterId ? watches.find(w => w.user_id === filterId) : null;
  const currentProfile = filterId ? profiles[filterId] : null;

  // ── Render ────────────────────────────────────────────────────────────────
  if (error) {
    return (
      <div className="bg-card border border-border rounded-xl p-10 text-center">
        <AlertCircle className="w-10 h-10 text-destructive mx-auto mb-3" />
        <h3 className="text-foreground font-semibold mb-1">Backend Watcher injoignable</h3>
        <p className="text-sm text-muted-foreground mb-4 font-mono">{error}</p>
        <button onClick={refresh} className="text-sm border border-border rounded-md px-4 py-2 hover:bg-muted text-foreground">
          Réessayer
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Compact header */}
      <div className="bg-card border border-border rounded-xl px-5 py-3 flex items-center gap-4 flex-wrap">
        <div className="flex items-center gap-2">
          <span className={`relative flex h-2.5 w-2.5`}>
            {wsState === 'open' && (
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-60"></span>
            )}
            <span className={`relative inline-flex rounded-full h-2.5 w-2.5 ${
              wsState === 'open' ? 'bg-emerald-400' : wsState === 'connecting' ? 'bg-amber-400' : 'bg-rose-400'
            }`}></span>
          </span>
          <span className="text-sm text-foreground font-medium">
            {wsState === 'open' ? 'Stream live' : wsState === 'connecting' ? 'Connexion…' : 'Hors ligne'}
          </span>
        </div>
        <div className="h-5 w-px bg-border" />
        <Stat label="Comptes" value={status ? `${status.ready_accounts}/${status.total_accounts}` : '—'} icon={Server} />
        <Stat label="Serveurs" value={status?.total_guilds ?? '—'} icon={Hash} />
        <Stat label="Cibles" value={watches.length} icon={Eye} />
        <Stat label="Events" value={events.length} icon={Radio} />
        <div className="ml-auto flex items-center gap-2">
          <button onClick={refresh} title="Rafraîchir"
            className="border border-border hover:bg-muted text-foreground p-2 rounded-md transition-colors">
            <Activity className="w-4 h-4" />
          </button>
          <button onClick={() => setShowAdd(true)}
            className="bg-primary hover:bg-primary/90 text-primary-foreground px-4 py-2 rounded-md text-sm font-medium flex items-center gap-2 transition-colors">
            <Plus className="w-4 h-4" /> Ajouter une cible
          </button>
        </div>
      </div>

      {/* Main 2-column */}
      <div className={`grid gap-4 ${collapseLeft ? 'lg:grid-cols-[60px_1fr]' : 'lg:grid-cols-[270px_1fr]'} transition-all`}>

        {/* Targets sidebar */}
        <aside className="bg-card border border-border rounded-xl flex flex-col overflow-hidden h-[calc(100vh-220px)] min-h-[480px]">
          <div className="px-3 py-2.5 border-b border-border flex items-center gap-2 flex-shrink-0">
            <Eye className="w-4 h-4 text-muted-foreground" />
            {!collapseLeft && (
              <>
                <span className="text-sm font-medium text-foreground">Cibles</span>
                <span className="ml-auto text-xs text-muted-foreground tabular-nums">{watches.length}</span>
              </>
            )}
            <button onClick={() => setCollapseLeft(!collapseLeft)} className="ml-auto p-1 rounded hover:bg-muted text-muted-foreground">
              {collapseLeft ? <ChevronDown className="w-3.5 h-3.5 -rotate-90" /> : <ChevronUp className="w-3.5 h-3.5 -rotate-90" />}
            </button>
          </div>

          {!collapseLeft && (
            <>
              <button onClick={() => setFilterId(null)}
                className={`px-4 py-2.5 text-left text-sm border-b border-border transition-colors flex items-center gap-2 ${
                  !filterId ? 'bg-muted text-foreground font-medium' : 'text-muted-foreground hover:bg-muted/50'
                }`}>
                <Radio className="w-4 h-4" /> Flux global
                <span className="ml-auto text-xs tabular-nums">{events.length}</span>
              </button>

              <div className="overflow-y-auto flex-1">
                {sortedWatches.length === 0 ? (
                  <div className="px-4 py-12 text-center">
                    <Eye className="w-8 h-8 text-muted-foreground/40 mx-auto mb-2" />
                    <p className="text-sm text-muted-foreground mb-3">Aucune cible</p>
                    <button onClick={() => setShowAdd(true)} className="text-xs text-foreground border border-border rounded-md px-3 py-1.5 hover:bg-muted">
                      Ajouter
                    </button>
                  </div>
                ) : sortedWatches.map(w => {
                  const profile = profiles[w.user_id];
                  const lastSeen = lastSeenByUser.get(w.user_id);
                  const count = eventCountByUser.get(w.user_id) || 0;
                  const active = filterId === w.user_id;
                  return (
                    <div key={w.user_id} className={`group relative border-b border-border last:border-0 transition-colors ${
                      active ? 'bg-muted' : 'hover:bg-muted/40'
                    }`}>
                      <button onClick={() => setFilterId(w.user_id)} className="w-full px-3 py-3 pr-12 flex items-center gap-3 text-left">
                        {profile?.avatar
                          ? <img src={profile.avatar} alt="" className="w-9 h-9 rounded-full flex-shrink-0 ring-1 ring-border" />
                          : <div className="w-9 h-9 rounded-full bg-muted flex items-center justify-center text-xs text-muted-foreground flex-shrink-0 ring-1 ring-border">
                              {(w.label || profile?.username || '?').slice(0,2).toUpperCase()}
                            </div>}
                        <div className="flex-1 min-w-0">
                          <p className="text-foreground text-sm truncate font-medium">
                            {w.label || profile?.global_name || profile?.username || 'Inconnu'}
                          </p>
                          <p className="text-xs text-muted-foreground font-mono truncate">
                            {profile?.username ? `@${profile.username}` : w.user_id}
                          </p>
                          {lastSeen && (
                            <p className="text-[10px] text-muted-foreground mt-0.5">
                              <span className="inline-block w-1 h-1 rounded-full bg-emerald-400 mr-1.5 align-middle"></span>
                              actif il y a {fmtRelative(lastSeen)}
                            </p>
                          )}
                        </div>
                        {count > 0 && (
                          <span className="flex-shrink-0 text-xs px-1.5 py-0.5 rounded bg-foreground/10 text-foreground tabular-nums font-medium">
                            {count}
                          </span>
                        )}
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); removeWatch(w.user_id, w.label || profile?.username || w.user_id); }}
                        className="absolute opacity-0 group-hover:opacity-100 right-2 top-1/2 -translate-y-1/2 p-1.5 rounded text-muted-foreground hover:text-destructive hover:bg-background transition-all"
                        title="Retirer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </aside>

        {/* Feed panel */}
        <section className="bg-card border border-border rounded-xl flex flex-col overflow-hidden h-[calc(100vh-220px)] min-h-[480px]">
          {/* Toolbar */}
          <div className="border-b border-border flex-shrink-0">
            <div className="px-4 py-2.5 flex items-center gap-3 flex-wrap">
              {/* Title with profile */}
              <div className="flex items-center gap-2.5 flex-1 min-w-0">
                {currentTarget ? (
                  <>
                    {currentProfile?.avatar
                      ? <img src={currentProfile.avatar} alt="" className="w-7 h-7 rounded-full flex-shrink-0" />
                      : <div className="w-7 h-7 rounded-full bg-muted flex items-center justify-center text-[10px] text-muted-foreground flex-shrink-0">?</div>}
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-foreground truncate">
                        {currentTarget.label || currentProfile?.global_name || currentProfile?.username || 'Inconnu'}
                      </p>
                      <p className="text-[11px] text-muted-foreground font-mono truncate">{currentTarget.user_id}</p>
                    </div>
                  </>
                ) : (
                  <>
                    <Radio className="w-4 h-4 text-muted-foreground" />
                    <p className="text-sm font-medium text-foreground">Flux global</p>
                    <p className="text-xs text-muted-foreground">— toutes les cibles</p>
                  </>
                )}
              </div>

              <div className="flex items-center gap-1.5">
                <button onClick={() => setAutoScroll(!autoScroll)}
                  title={autoScroll ? 'Auto-scroll activé' : 'Auto-scroll désactivé'}
                  className={`p-1.5 rounded text-xs border transition-colors ${
                    autoScroll
                      ? 'border-emerald-400/30 bg-emerald-400/10 text-emerald-400'
                      : 'border-border text-muted-foreground hover:bg-muted'
                  }`}>
                  <ArrowDownToLine className="w-3.5 h-3.5" />
                </button>
                <span className="text-xs text-muted-foreground tabular-nums">{filteredEvents.length} events</span>
              </div>
            </div>

            {/* Filters row */}
            <div className="px-4 pb-2.5 flex items-center gap-2 flex-wrap">
              <div className="relative flex-1 min-w-[180px] max-w-[420px]">
                <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <input
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="Rechercher dans les events…"
                  className="w-full text-xs bg-input border border-border rounded-md pl-8 pr-7 py-1.5 text-foreground placeholder:text-muted-foreground/70 focus:outline-none focus:ring-1 focus:ring-ring" />
                {search && (
                  <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                    <X className="w-3 h-3" />
                  </button>
                )}
              </div>
              <Filter className="w-3.5 h-3.5 text-muted-foreground" />
              <div className="flex items-center gap-1">
                {TYPE_GROUPS.map(g => (
                  <button key={g.id} onClick={() => setTypeGroup(g.id)}
                    className={`text-xs px-2.5 py-1 rounded-md border transition-colors ${
                      typeGroup === g.id
                        ? 'border-primary bg-primary/15 text-primary font-medium'
                        : 'border-border text-muted-foreground hover:bg-muted'
                    }`}>
                    {g.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Timeline */}
          <div ref={feedRef} className="flex-1 overflow-y-auto">
            {filteredEvents.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-center px-6 py-12">
                <Activity className="w-10 h-10 text-muted-foreground/40 mb-3" />
                <p className="text-sm text-muted-foreground mb-1">Aucun événement</p>
                <p className="text-xs text-muted-foreground/70 max-w-md">
                  {watches.length === 0
                    ? "Ajoute une cible pour commencer à tracer son activité sur les serveurs où tes selfbots sont présents."
                    : "Les events apparaissent ici dès que la cible est active sur un serveur partagé avec un selfbot."}
                </p>
              </div>
            ) : (
              <ul>
                {filteredEvents.map((evt, i) => {
                  const prev = filteredEvents[i - 1];
                  const showDate = !prev || new Date(prev.created_at).toDateString() !== new Date(evt.created_at).toDateString();
                  return (
                    <div key={evt.id}>
                      {showDate && (
                        <li className="sticky top-0 z-10 px-4 py-1 text-[10px] uppercase tracking-wider font-semibold bg-card/95 backdrop-blur text-muted-foreground border-b border-border">
                          {new Date(evt.created_at).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })}
                        </li>
                      )}
                      <EventRow evt={evt} profile={profiles[evt.user_id]} watch={watches.find(w => w.user_id === evt.user_id)} />
                    </div>
                  );
                })}
              </ul>
            )}
          </div>
        </section>
      </div>

      {/* Add modal */}
      {showAdd && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => setShowAdd(false)}>
          <div className="bg-card border border-border rounded-xl w-full max-w-md shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="px-6 py-4 border-b border-border flex items-center gap-2">
              <Eye className="w-4 h-4 text-muted-foreground" />
              <h3 className="text-foreground font-semibold">Ajouter une cible</h3>
              <button onClick={() => setShowAdd(false)} className="ml-auto p-1 rounded hover:bg-muted text-muted-foreground">
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={addWatch} className="p-6 space-y-4">
              <div>
                <label className="block mb-1.5 text-xs uppercase tracking-wider text-muted-foreground font-semibold">ID Discord</label>
                <input value={newId} onChange={e => setNewId(e.target.value)}
                  placeholder="123456789012345678" autoFocus
                  className="w-full bg-input border border-border rounded-md px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-1 focus:ring-ring font-mono" />
                <p className="text-[11px] text-muted-foreground mt-1.5">Snowflake (15-25 chiffres). Active le mode développeur sur Discord pour copier l'ID.</p>
              </div>
              <div>
                <label className="block mb-1.5 text-xs uppercase tracking-wider text-muted-foreground font-semibold">Label (optionnel)</label>
                <input value={newLabel} onChange={e => setNewLabel(e.target.value)}
                  placeholder="ex: cible-1, suspect, ami…"
                  className="w-full bg-input border border-border rounded-md px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-1 focus:ring-ring" />
              </div>
              <div className="flex gap-2 pt-2">
                <button type="button" onClick={() => setShowAdd(false)}
                  className="flex-1 border border-border hover:bg-muted text-foreground py-2 rounded-md text-sm transition-colors">
                  Annuler
                </button>
                <button type="submit" disabled={adding}
                  className="flex-1 bg-primary hover:bg-primary/90 disabled:opacity-60 text-primary-foreground font-medium py-2 rounded-md text-sm flex items-center justify-center gap-2 transition-colors">
                  {adding ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                  Surveiller
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Sub-components ──────────────────────────────────────────────────────────
function Stat({ label, value, icon: Icon }: { label: string; value: number | string; icon: any }) {
  return (
    <div className="flex items-center gap-1.5 text-sm">
      <Icon className="w-3.5 h-3.5 text-muted-foreground" />
      <span className="text-muted-foreground">{label}</span>
      <span className="text-foreground font-semibold tabular-nums">{value}</span>
    </div>
  );
}

function EventRow({ evt, profile, watch }: { evt: Event; profile?: Profile; watch?: Watch }) {
  const meta = EVENT_META[evt.type] || { label: evt.type, Icon: Activity, color: 'text-muted-foreground', bg: 'bg-muted', group: 'other' };
  const Icon = meta.Icon;
  const extra = safeParse(evt.extra_json);
  const displayName = watch?.label || profile?.global_name || profile?.username || evt.user_id;

  return (
    <li className="px-4 py-2.5 border-b border-border last:border-0 hover:bg-muted/30 transition-colors">
      <div className="flex items-start gap-3">
        {/* Icon */}
        <div className={`w-8 h-8 rounded-md ${meta.bg} flex items-center justify-center flex-shrink-0`}>
          <Icon className={`w-4 h-4 ${meta.color}`} />
        </div>

        <div className="flex-1 min-w-0">
          {/* Header line */}
          <div className="flex items-center gap-2 flex-wrap text-sm leading-tight">
            <span className="text-foreground font-medium">{displayName}</span>
            <span className={`text-xs ${meta.color}`}>{meta.label}</span>
            {evt.guild_name && (
              <span className="text-xs text-muted-foreground inline-flex items-center gap-1">
                <Server className="w-3 h-3" /> {evt.guild_name}
              </span>
            )}
            {evt.channel_name && (
              <span className="text-xs text-muted-foreground inline-flex items-center gap-1">
                <Hash className="w-3 h-3" /> {evt.channel_name}
              </span>
            )}
            <span className="ml-auto text-xs text-muted-foreground tabular-nums" title={fmtFull(evt.created_at)}>
              {fmtRelative(evt.created_at)}
            </span>
          </div>

          {/* Content */}
          {evt.content && (
            <p className="text-sm text-foreground/90 mt-1 break-words whitespace-pre-wrap leading-snug">{evt.content}</p>
          )}

          {/* Extra info */}
          {extra && <ExtraDetails type={evt.type} extra={extra} />}
        </div>
      </div>
    </li>
  );
}

function ExtraDetails({ type, extra }: { type: string; extra: any }) {
  if (type === 'message_create' && Array.isArray(extra.attachments) && extra.attachments.length) {
    return (
      <div className="flex flex-wrap gap-1.5 mt-1.5">
        {extra.attachments.map((a: any, i: number) => (
          <a key={i} href={a.url} target="_blank" rel="noreferrer"
            className="text-xs text-sky-400 hover:underline inline-flex items-center gap-1 bg-sky-400/10 px-1.5 py-0.5 rounded">
            📎 {a.name || 'attachment'}
          </a>
        ))}
      </div>
    );
  }
  if (type === 'message_update' && extra.before) {
    return (
      <p className="text-xs text-muted-foreground mt-1 line-through opacity-70 truncate">avant : {extra.before}</p>
    );
  }
  if (type === 'nickname_change') {
    return (
      <p className="text-xs text-muted-foreground mt-1">
        <span className="line-through opacity-70">{extra.from || '∅'}</span>
        <span className="mx-1.5">→</span>
        <span className="text-foreground">{extra.to || '∅'}</span>
      </p>
    );
  }
  if (type === 'roles_change') {
    return (
      <div className="flex flex-wrap gap-1 mt-1">
        {(extra.added || []).map((r: any, i: number) =>
          <span key={'a'+i} className="text-[11px] px-1.5 py-0.5 rounded bg-emerald-400/15 text-emerald-400 font-medium">+ {r.name || r.id}</span>)}
        {(extra.removed || []).map((r: any, i: number) =>
          <span key={'r'+i} className="text-[11px] px-1.5 py-0.5 rounded bg-rose-400/15 text-rose-400 font-medium">− {r.name || r.id}</span>)}
      </div>
    );
  }
  if (type === 'voice_move' && extra.from_channel) {
    return (
      <p className="text-xs text-muted-foreground mt-1">
        depuis <span className="text-foreground">#{extra.from_channel.name || extra.from_channel.id}</span>
      </p>
    );
  }
  if (type === 'guild_join' && extra.account_age_ms) {
    const days = Math.floor(extra.account_age_ms / 86_400_000);
    return <p className="text-xs text-muted-foreground mt-1">compte créé il y a {days} j</p>;
  }
  if (type === 'timeout' && extra.until) {
    const until = new Date(extra.until);
    return <p className="text-xs text-rose-400 mt-1">jusqu'à {until.toLocaleString('fr-FR')}</p>;
  }
  return null;
}
