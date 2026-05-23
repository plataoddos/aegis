import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Plus, Trash2, Loader2, Search, X, MessageSquare, LogIn, LogOut,
  Mic, MicOff, Volume2, UserCog, Edit3, Activity, AlertCircle,
  Clock, Radio, Filter, ArrowDownToLine,
  Hash, Server, Eye, TrendingUp, Zap, Wifi, WifiOff,
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

  // ── Computed: stats ───────────────────────────────────────────────────────
  const eventsToday = useMemo(() => {
    const start = new Date(); start.setHours(0,0,0,0);
    const ts = start.getTime();
    return events.filter(e => e.created_at >= ts &&
      (filterId ? e.user_id === filterId : true)).length;
  }, [events, filterId]);

  const eventsLastHour = useMemo(() => {
    const ts = Date.now() - 3600_000;
    return events.filter(e => e.created_at >= ts &&
      (filterId ? e.user_id === filterId : true)).length;
  }, [events, filterId]);

  const typeBreakdown = useMemo(() => {
    const m = new Map<string, number>();
    const src = filterId ? events.filter(e => e.user_id === filterId) : events;
    for (const e of src) m.set(e.type, (m.get(e.type) || 0) + 1);
    return Array.from(m.entries()).sort((a, b) => b[1] - a[1]);
  }, [events, filterId]);

  // ── Render ────────────────────────────────────────────────────────────────
  if (error) {
    return (
      <div className="aegis-card aegis-card-edge p-10 text-center">
        <AlertCircle className="w-10 h-10 text-destructive mx-auto mb-3" />
        <h3 className="text-foreground font-semibold mb-1">Backend Watcher injoignable</h3>
        <p className="text-sm text-muted-foreground mb-4 font-mono">{error}</p>
        <button onClick={refresh}
          className="aegis-btn-primary text-primary-foreground rounded-lg px-4 py-2 text-sm font-medium">
          Réessayer
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4 h-full flex flex-col" style={{ height: 'calc(100vh - 112px)' }}>

      {/* ═══ Top status bar ════════════════════════════════════════════════ */}
      <div className="aegis-card aegis-card-edge px-4 py-2.5 flex items-center gap-3 flex-shrink-0 flex-wrap">
        {/* Live indicator */}
        <div className={`flex items-center gap-2 px-3 py-1 rounded-full border ${
          wsState === 'open'       ? 'bg-emerald-500/10 border-emerald-500/30' :
          wsState === 'connecting' ? 'bg-amber-500/10  border-amber-500/30'  :
                                     'bg-rose-500/10   border-rose-500/30'
        }`}>
          {wsState === 'open' ? (
            <>
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-60" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-400" />
              </span>
              <span className="text-xs text-emerald-400 font-medium">LIVE</span>
            </>
          ) : wsState === 'connecting' ? (
            <>
              <Loader2 className="w-3 h-3 text-amber-400 animate-spin" />
              <span className="text-xs text-amber-400 font-medium">Connexion…</span>
            </>
          ) : (
            <>
              <WifiOff className="w-3 h-3 text-rose-400" />
              <span className="text-xs text-rose-400 font-medium">Hors ligne</span>
            </>
          )}
        </div>

        <div className="h-5 w-px bg-white/10" />

        {/* Stats inline */}
        <CompactStat icon={Server} label="Comptes" value={status ? `${status.ready_accounts}/${status.total_accounts}` : '—'} />
        <CompactStat icon={Hash}    label="Serveurs" value={status?.total_guilds ?? '—'} />
        <CompactStat icon={Eye}     label="Cibles"   value={watches.length} />
        <CompactStat icon={Radio}   label="Buffer"   value={events.length} />

        <div className="ml-auto flex items-center gap-2">
          <button onClick={refresh} title="Rafraîchir"
            className="border border-white/10 hover:bg-white/5 hover:border-white/15 text-muted-foreground hover:text-foreground p-1.5 rounded-lg transition-all">
            <Activity className="w-3.5 h-3.5" />
          </button>
          <button onClick={() => setShowAdd(true)}
            className="aegis-btn-primary text-primary-foreground px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5">
            <Plus className="w-3.5 h-3.5" /> Cible
          </button>
        </div>
      </div>

      {/* ═══ Main 2-col grid ═══════════════════════════════════════════════ */}
      <div className="grid gap-4 lg:grid-cols-[260px_1fr] flex-1 min-h-0">

        {/* ── Targets sidebar ───────────────────────────────────────────── */}
        <aside className="aegis-card aegis-card-edge flex flex-col overflow-hidden">
          <div className="px-3 py-2 border-b border-white/5 flex items-center gap-2 flex-shrink-0">
            <Eye className="w-3.5 h-3.5 text-muted-foreground" />
            <span className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">Cibles</span>
            <span className="ml-auto text-[10px] text-muted-foreground/60 tabular-nums">{watches.length}</span>
          </div>

          <button onClick={() => setFilterId(null)}
            className={`group flex items-center gap-2.5 px-3 py-2.5 m-2 rounded-lg transition-all ${
              !filterId ? 'bg-primary/10 ring-1 ring-primary/30' : 'hover:bg-white/[0.03]'
            }`}>
            <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${
              !filterId ? 'bg-primary/20 text-primary' : 'bg-white/[0.04] text-muted-foreground'
            }`}>
              <Radio className="w-4 h-4" />
            </div>
            <div className="flex-1 min-w-0 text-left">
              <p className={`text-sm font-medium ${!filterId ? 'text-foreground' : 'text-muted-foreground'}`}>Flux global</p>
              <p className="text-[10px] text-muted-foreground/60 tabular-nums">{events.length} events</p>
            </div>
          </button>

          <div className="overflow-y-auto flex-1 px-2 pb-2">
            {sortedWatches.length === 0 ? (
              <div className="px-2 py-10 text-center">
                <div className="w-10 h-10 rounded-xl bg-primary/10 ring-1 ring-primary/20 flex items-center justify-center mx-auto mb-2">
                  <Eye className="w-4 h-4 text-primary/60" />
                </div>
                <p className="text-xs text-foreground font-medium mb-1">Aucune cible</p>
                <p className="text-[10px] text-muted-foreground mb-3">Ajoute un ID Discord pour commencer</p>
                <button onClick={() => setShowAdd(true)}
                  className="aegis-btn-primary text-primary-foreground rounded-lg px-3 py-1.5 text-[11px] font-semibold inline-flex items-center gap-1">
                  <Plus className="w-3 h-3" /> Ajouter
                </button>
              </div>
            ) : (
              <div className="space-y-0.5">
                {sortedWatches.map(w => {
                  const profile = profiles[w.user_id];
                  const lastSeen = lastSeenByUser.get(w.user_id);
                  const count = eventCountByUser.get(w.user_id) || 0;
                  const isActive = filterId === w.user_id;
                  const isOnline = lastSeen && (Date.now() - lastSeen) < 5 * 60_000;
                  return (
                    <div key={w.user_id} className={`group relative rounded-lg transition-all ${
                      isActive ? 'bg-emerald-500/10 ring-1 ring-emerald-500/30' : 'hover:bg-white/[0.03]'
                    }`}>
                      <button onClick={() => setFilterId(w.user_id)} className="w-full px-2.5 py-2 pr-9 flex items-center gap-2.5 text-left">
                        <div className="relative flex-shrink-0">
                          {profile?.avatar
                            ? <img src={profile.avatar} alt="" className="w-9 h-9 rounded-full ring-1 ring-white/10" />
                            : <div className="w-9 h-9 rounded-full bg-white/[0.04] flex items-center justify-center text-[11px] text-muted-foreground font-semibold ring-1 ring-white/10">
                                {(w.label || profile?.username || '?').slice(0,2).toUpperCase()}
                              </div>}
                          {isOnline && (
                            <span className="absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full bg-emerald-400 ring-2 ring-background aegis-pulse" />
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className={`text-xs font-medium truncate ${isActive ? 'text-foreground' : 'text-foreground/90'}`}>
                            {w.label || profile?.global_name || profile?.username || 'Inconnu'}
                          </p>
                          <p className="text-[10px] text-muted-foreground/70 truncate">
                            {lastSeen ? `il y a ${fmtRelative(lastSeen)}` : 'jamais vu'}
                          </p>
                        </div>
                        {count > 0 && (
                          <span className="flex-shrink-0 text-[9px] px-1.5 py-0.5 rounded bg-white/[0.06] text-foreground/80 tabular-nums font-bold">
                            {count}
                          </span>
                        )}
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); removeWatch(w.user_id, w.label || profile?.username || w.user_id); }}
                        className="absolute opacity-0 group-hover:opacity-100 right-1.5 top-1/2 -translate-y-1/2 p-1 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-all"
                        title="Retirer"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </aside>

        {/* ── Main content (hero + timeline) ────────────────────────────── */}
        <section className="flex flex-col gap-4 min-h-0">

          {/* Hero — target focus or global dashboard */}
          {currentTarget ? (
            <TargetHero
              target={currentTarget}
              profile={currentProfile}
              eventsToday={eventsToday}
              eventsLastHour={eventsLastHour}
              eventsTotal={eventCountByUser.get(currentTarget.user_id) || 0}
              lastSeen={lastSeenByUser.get(currentTarget.user_id)}
              typeBreakdown={typeBreakdown}
            />
          ) : (
            <GlobalHero
              eventsToday={eventsToday}
              eventsLastHour={eventsLastHour}
              eventsTotal={events.length}
              activeTargets={Array.from(lastSeenByUser.keys()).filter(id =>
                (Date.now() - (lastSeenByUser.get(id) || 0)) < 5 * 60_000
              ).length}
              typeBreakdown={typeBreakdown}
            />
          )}

          {/* Timeline panel */}
          <div className="aegis-card aegis-card-edge flex flex-col overflow-hidden flex-1 min-h-0">
            {/* Filters bar */}
            <div className="px-4 py-2.5 border-b border-white/5 flex items-center gap-2 flex-wrap flex-shrink-0">
              <Activity className="w-3.5 h-3.5 text-muted-foreground" />
              <span className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">Activité</span>
              <span className="text-[10px] text-muted-foreground/60 tabular-nums">{filteredEvents.length}</span>

              <div className="relative flex-1 min-w-[160px] max-w-xs ml-2">
                <Search className="w-3 h-3 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <input
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="Filtrer dans les events…"
                  className="w-full text-[11px] bg-input/60 border border-white/8 rounded-md pl-7 pr-7 py-1 text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:border-primary/40" />
                {search && (
                  <button onClick={() => setSearch('')} className="absolute right-1.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                    <X className="w-3 h-3" />
                  </button>
                )}
              </div>

              <Filter className="w-3 h-3 text-muted-foreground/70" />
              <div className="flex items-center gap-1">
                {TYPE_GROUPS.map(g => (
                  <button key={g.id} onClick={() => setTypeGroup(g.id)}
                    className={`text-[10px] px-2 py-0.5 rounded-md border transition-all ${
                      typeGroup === g.id
                        ? 'border-primary/40 bg-primary/15 text-primary font-semibold'
                        : 'border-white/8 text-muted-foreground hover:bg-white/5 hover:text-foreground'
                    }`}>
                    {g.label}
                  </button>
                ))}
              </div>

              <button onClick={() => setAutoScroll(!autoScroll)}
                title={autoScroll ? 'Auto-scroll : ON' : 'Auto-scroll : OFF'}
                className={`p-1 rounded-md border transition-all ${
                  autoScroll
                    ? 'border-emerald-400/30 bg-emerald-400/10 text-emerald-400'
                    : 'border-white/8 text-muted-foreground hover:bg-white/5'
                }`}>
                <ArrowDownToLine className="w-3 h-3" />
              </button>
            </div>

            {/* Timeline body */}
            <div ref={feedRef} className="flex-1 overflow-y-auto">
              {filteredEvents.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-center px-6 py-12">
                  <div className="w-12 h-12 rounded-2xl bg-primary/10 ring-1 ring-primary/20 flex items-center justify-center mb-3">
                    <Activity className="w-5 h-5 text-primary/60" />
                  </div>
                  <p className="text-foreground font-medium mb-1">En attente d'activité</p>
                  <p className="text-xs text-muted-foreground/70 max-w-md">
                    {watches.length === 0
                      ? "Ajoute une cible pour commencer à tracer son activité sur les serveurs partagés avec tes selfbots."
                      : "Les events apparaissent ici dès que la cible est active."}
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
                          <li className="sticky top-0 z-10 px-4 py-1.5 text-[9px] uppercase tracking-[0.15em] font-bold bg-background/80 backdrop-blur text-muted-foreground/70 border-b border-white/5">
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
          </div>
        </section>
      </div>

      {/* Add modal */}
      {showAdd && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-md z-50 flex items-center justify-center p-4 aegis-fade-in" onClick={() => setShowAdd(false)}>
          <div className="aegis-card aegis-card-edge w-full max-w-md aegis-scale-in" onClick={e => e.stopPropagation()}>
            <div className="px-6 py-4 border-b border-white/5 flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-emerald-500/15 ring-1 ring-emerald-500/30 flex items-center justify-center">
                <Eye className="w-4 h-4 text-emerald-400" />
              </div>
              <h3 className="text-foreground font-semibold">Surveiller un nouvel utilisateur</h3>
              <button onClick={() => setShowAdd(false)} className="ml-auto p-1 rounded hover:bg-white/5 text-muted-foreground">
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={addWatch} className="p-6 space-y-4">
              <div>
                <label className="block mb-1.5 text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">ID Discord *</label>
                <input value={newId} onChange={e => setNewId(e.target.value)}
                  placeholder="123456789012345678" autoFocus
                  className="w-full bg-input/60 border border-white/10 rounded-lg px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:border-primary/40 font-mono" />
                <p className="text-[10px] text-muted-foreground mt-1.5">Snowflake (15-25 chiffres). Active le mode développeur sur Discord pour copier l'ID.</p>
              </div>
              <div>
                <label className="block mb-1.5 text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Label (optionnel)</label>
                <input value={newLabel} onChange={e => setNewLabel(e.target.value)}
                  placeholder="ex: cible-1, suspect, ami…"
                  className="w-full bg-input/60 border border-white/10 rounded-lg px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:border-primary/40" />
              </div>
              <div className="flex gap-2 pt-2">
                <button type="button" onClick={() => setShowAdd(false)}
                  className="flex-1 border border-white/10 hover:bg-white/5 text-foreground py-2 rounded-lg text-sm transition-all">
                  Annuler
                </button>
                <button type="submit" disabled={adding}
                  className="flex-1 aegis-btn-primary text-primary-foreground py-2 rounded-lg text-sm font-semibold flex items-center justify-center gap-2">
                  {adding ? <Loader2 className="w-4 h-4 animate-spin" /> : <Eye className="w-4 h-4" />}
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
function CompactStat({ icon: Icon, label, value }: { icon: any; label: string; value: number | string }) {
  return (
    <div className="flex items-center gap-1.5 text-xs">
      <Icon className="w-3 h-3 text-muted-foreground/70" />
      <span className="text-muted-foreground/70">{label}</span>
      <span className="text-foreground font-semibold tabular-nums">{value}</span>
    </div>
  );
}

// ── Hero blocks ─────────────────────────────────────────────────────────────
function TargetHero({ target, profile, eventsToday, eventsLastHour, eventsTotal, lastSeen, typeBreakdown }: {
  target: Watch; profile?: Profile;
  eventsToday: number; eventsLastHour: number; eventsTotal: number;
  lastSeen?: number;
  typeBreakdown: [string, number][];
}) {
  const isOnline = lastSeen && (Date.now() - lastSeen) < 5 * 60_000;
  const displayName = target.label || profile?.global_name || profile?.username || 'Inconnu';

  return (
    <div className="aegis-card aegis-card-edge overflow-hidden flex-shrink-0">
      <div className="relative px-5 py-4 flex items-center gap-4 flex-wrap">
        {/* Backdrop gradient */}
        <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/10 via-transparent to-primary/5 pointer-events-none" />

        {/* Avatar + name */}
        <div className="relative flex items-center gap-3">
          <div className="relative">
            {profile?.avatar
              ? <img src={profile.avatar} alt="" className="w-14 h-14 rounded-2xl ring-2 ring-white/10 shadow-lg" />
              : <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-emerald-500/30 to-emerald-500/10 ring-1 ring-emerald-500/40 text-emerald-300 font-bold text-lg flex items-center justify-center">
                  {displayName.slice(0,2).toUpperCase()}
                </div>}
            {isOnline && (
              <span className="absolute bottom-0 right-0 w-3.5 h-3.5 rounded-full bg-emerald-400 ring-[3px] ring-background aegis-pulse" />
            )}
          </div>
          <div>
            <h2 className="text-foreground font-bold text-lg tracking-tight leading-tight">{displayName}</h2>
            <div className="flex items-center gap-2 mt-0.5 text-[11px] text-muted-foreground">
              {profile?.username && <span className="font-mono">@{profile.username}</span>}
              <span className="font-mono opacity-60">{target.user_id}</span>
            </div>
            <div className="flex items-center gap-1.5 mt-1.5">
              {isOnline ? (
                <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider font-semibold text-emerald-400 bg-emerald-500/10 border border-emerald-500/30 rounded px-1.5 py-0.5">
                  <span className="w-1 h-1 rounded-full bg-emerald-400 aegis-pulse" /> ACTIF
                </span>
              ) : lastSeen ? (
                <span className="text-[10px] text-muted-foreground">Vu il y a {fmtRelative(lastSeen)}</span>
              ) : (
                <span className="text-[10px] text-muted-foreground">Aucune activité capturée</span>
              )}
            </div>
          </div>
        </div>

        {/* Metric blocks */}
        <div className="relative ml-auto flex items-stretch gap-2">
          <MetricBlock icon={Zap}        tone="amber"    label="Last hour" value={eventsLastHour} />
          <MetricBlock icon={Activity}   tone="emerald"  label="Today"     value={eventsToday} />
          <MetricBlock icon={TrendingUp} tone="primary"  label="Total"     value={eventsTotal} />
        </div>
      </div>

      {/* Type breakdown bar */}
      {typeBreakdown.length > 0 && (
        <div className="relative px-5 pb-3 flex items-center gap-2 flex-wrap">
          <span className="text-[9px] uppercase tracking-wider text-muted-foreground/70 font-bold">Mix</span>
          {typeBreakdown.slice(0, 5).map(([type, count]) => {
            const meta = EVENT_META[type];
            if (!meta) return null;
            const Icon = meta.Icon;
            return (
              <span key={type} className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded ${meta.bg} ${meta.color}`}>
                <Icon className="w-2.5 h-2.5" />
                <span className="font-semibold">{count}</span>
                <span className="opacity-70">{meta.label}</span>
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}

function GlobalHero({ eventsToday, eventsLastHour, eventsTotal, activeTargets, typeBreakdown }: {
  eventsToday: number; eventsLastHour: number; eventsTotal: number;
  activeTargets: number;
  typeBreakdown: [string, number][];
}) {
  return (
    <div className="aegis-card aegis-card-edge overflow-hidden flex-shrink-0">
      <div className="relative px-5 py-4 flex items-center gap-4 flex-wrap">
        <div className="absolute inset-0 bg-gradient-to-br from-primary/8 via-transparent to-violet-500/5 pointer-events-none" />

        <div className="relative flex items-center gap-3">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-primary/30 to-primary/10 ring-1 ring-primary/40 flex items-center justify-center">
            <Wifi className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h2 className="text-foreground font-bold text-lg tracking-tight leading-tight">Flux global</h2>
            <p className="text-[11px] text-muted-foreground mt-0.5">Activité agrégée de toutes les cibles</p>
            {activeTargets > 0 && (
              <div className="flex items-center gap-1.5 mt-1.5">
                <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider font-semibold text-emerald-400 bg-emerald-500/10 border border-emerald-500/30 rounded px-1.5 py-0.5">
                  <span className="w-1 h-1 rounded-full bg-emerald-400 aegis-pulse" /> {activeTargets} actif{activeTargets > 1 ? 's' : ''}
                </span>
              </div>
            )}
          </div>
        </div>

        <div className="relative ml-auto flex items-stretch gap-2">
          <MetricBlock icon={Zap}        tone="amber"    label="Last hour" value={eventsLastHour} />
          <MetricBlock icon={Activity}   tone="emerald"  label="Today"     value={eventsToday} />
          <MetricBlock icon={TrendingUp} tone="primary"  label="Buffer"    value={eventsTotal} />
        </div>
      </div>

      {typeBreakdown.length > 0 && (
        <div className="relative px-5 pb-3 flex items-center gap-2 flex-wrap">
          <span className="text-[9px] uppercase tracking-wider text-muted-foreground/70 font-bold">Mix</span>
          {typeBreakdown.slice(0, 5).map(([type, count]) => {
            const meta = EVENT_META[type];
            if (!meta) return null;
            const Icon = meta.Icon;
            return (
              <span key={type} className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded ${meta.bg} ${meta.color}`}>
                <Icon className="w-2.5 h-2.5" />
                <span className="font-semibold">{count}</span>
                <span className="opacity-70">{meta.label}</span>
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}

function MetricBlock({ icon: Icon, tone, label, value }: {
  icon: any; tone: 'amber' | 'emerald' | 'primary'; label: string; value: number;
}) {
  const tones = {
    amber:   { bg: 'bg-amber-500/10',   ring: 'ring-amber-500/30',   text: 'text-amber-400' },
    emerald: { bg: 'bg-emerald-500/10', ring: 'ring-emerald-500/30', text: 'text-emerald-400' },
    primary: { bg: 'bg-primary/10',     ring: 'ring-primary/30',     text: 'text-primary' },
  };
  const t = tones[tone];
  return (
    <div className={`relative px-3 py-2 rounded-lg ${t.bg} ring-1 ${t.ring} min-w-[90px]`}>
      <div className="flex items-center gap-1 mb-0.5">
        <Icon className={`w-3 h-3 ${t.text}`} />
        <span className={`text-[9px] uppercase tracking-wider font-bold ${t.text} opacity-80`}>{label}</span>
      </div>
      <p className="text-foreground text-xl font-bold tabular-nums leading-none">{value}</p>
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
