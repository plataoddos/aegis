/**
 * Admin sub-page : at-a-glance dashboard.
 *
 * Reads /api/admin/users and /api/admin/keys to display stats cards and
 * a short list of recent activity (last 5 keys generated, last 5 users
 * signed up, current premium subscribers).
 */
import { useEffect, useMemo, useState } from 'react';
import {
  Users as UsersIcon, Shield, Crown, KeyRound, Sparkles, Check,
  RefreshCw, Loader2, TrendingUp, Clock,
} from 'lucide-react';
import { toast } from 'sonner';
import { apiGet } from '../../lib/api';
import type { AdminUser, AdminKey } from './adminTypes';

function fmtDate(ts: number | null): string {
  if (!ts) return '—';
  return new Date(ts).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
}

export function AdminOverview() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [keys, setKeys]   = useState<AdminKey[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = async () => {
    setLoading(true);
    try {
      const [u, k] = await Promise.all([
        apiGet<AdminUser[]>('/api/admin/users'),
        apiGet<AdminKey[]>('/api/admin/keys'),
      ]);
      setUsers(u);
      setKeys(k);
    } catch (e) {
      toast.error('Erreur de chargement', { description: (e as Error).message });
    } finally { setLoading(false); }
  };
  useEffect(() => { reload(); }, []);

  const stats = useMemo(() => {
    const now = Date.now();
    return {
      total:        users.length,
      admins:       users.filter(u => u.is_admin).length,
      premium:      users.filter(u => u.premium_until && u.premium_until > now).length,
      keys_unused:  keys.filter(k => !k.used_at).length,
      keys_used:    keys.filter(k =>  k.used_at).length,
      keys_total:   keys.length,
    };
  }, [users, keys]);

  const recentUsers = useMemo(() =>
    [...users].sort((a, b) => b.created_at - a.created_at).slice(0, 5),
    [users]);

  const recentKeys = useMemo(() =>
    [...keys].sort((a, b) => b.created_at - a.created_at).slice(0, 5),
    [keys]);

  return (
    <div className="space-y-5">
      {/* Stats */}
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold flex items-center gap-2">
          <TrendingUp className="w-4 h-4 text-indigo-400" />
          Aperçu général
        </h2>
        <button onClick={reload} disabled={loading}
          className="text-xs px-3 py-1.5 border border-white/10 hover:bg-white/5 rounded-lg flex items-center gap-1.5 transition-all disabled:opacity-50">
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          Rafraîchir
        </button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <StatCard icon={UsersIcon} label="Utilisateurs"     value={stats.total}       tone="indigo" />
        <StatCard icon={Shield}    label="Admins"           value={stats.admins}      tone="amber" />
        <StatCard icon={Crown}     label="Premium actifs"   value={stats.premium}     tone="violet" />
        <StatCard icon={KeyRound}  label="Clés totales"     value={stats.keys_total}  tone="zinc" />
        <StatCard icon={Sparkles}  label="Clés disponibles" value={stats.keys_unused} tone="emerald" />
        <StatCard icon={Check}     label="Clés utilisées"   value={stats.keys_used}   tone="cyan" />
      </div>

      {/* Two-column recent activity */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <Panel title="Inscriptions récentes" icon={UsersIcon}>
          {loading
            ? <Skeleton />
            : recentUsers.length === 0
              ? <Empty label="Aucun utilisateur encore." />
              : recentUsers.map(u => (
                  <div key={u.id} className="flex items-center gap-3 px-3 py-2 hover:bg-white/[0.02] rounded-lg">
                    <div className="w-7 h-7 rounded-md bg-gradient-to-br from-indigo-500/30 to-violet-500/10 ring-1 ring-indigo-500/40 flex items-center justify-center text-xs font-bold text-indigo-200 flex-shrink-0">
                      {u.username.slice(0, 1).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0 flex items-center gap-2">
                      <span className="text-sm font-semibold truncate">{u.username}</span>
                      {u.is_admin === 1 && <Shield className="w-3 h-3 text-amber-400 flex-shrink-0" />}
                      {u.premium_until && u.premium_until > Date.now() && <Crown className="w-3 h-3 text-violet-400 flex-shrink-0" />}
                    </div>
                    <span className="text-[10px] text-muted-foreground/70 tabular-nums flex items-center gap-1">
                      <Clock className="w-2.5 h-2.5" /> {fmtDate(u.created_at)}
                    </span>
                  </div>
                ))}
        </Panel>

        <Panel title="Clés récentes" icon={KeyRound}>
          {loading
            ? <Skeleton />
            : recentKeys.length === 0
              ? <Empty label="Aucune clé générée encore." />
              : recentKeys.map(k => (
                  <div key={k.key} className="flex items-center gap-3 px-3 py-2 hover:bg-white/[0.02] rounded-lg">
                    <code className="text-xs font-mono flex-1 truncate text-muted-foreground">{k.key}</code>
                    <span className="text-[10px] tabular-nums px-1.5 py-0.5 rounded bg-white/5 text-muted-foreground">{k.days}j</span>
                    {k.used_at ? (
                      <span className="text-[10px] uppercase tracking-wider text-cyan-400">utilisée</span>
                    ) : (
                      <span className="text-[10px] uppercase tracking-wider text-emerald-400">dispo</span>
                    )}
                  </div>
                ))}
        </Panel>
      </div>
    </div>
  );
}

function StatCard({ icon: Icon, label, value, tone }: {
  icon: any; label: string; value: number;
  tone: 'indigo' | 'amber' | 'violet' | 'zinc' | 'emerald' | 'cyan';
}) {
  const tones: Record<string, { from: string; ring: string; text: string }> = {
    indigo:  { from: 'from-indigo-500/15',  ring: 'ring-indigo-500/40',  text: 'text-indigo-400' },
    amber:   { from: 'from-amber-500/15',   ring: 'ring-amber-500/40',   text: 'text-amber-400' },
    violet:  { from: 'from-violet-500/15',  ring: 'ring-violet-500/40',  text: 'text-violet-400' },
    zinc:    { from: 'from-zinc-500/10',    ring: 'ring-zinc-500/30',    text: 'text-zinc-400' },
    emerald: { from: 'from-emerald-500/15', ring: 'ring-emerald-500/40', text: 'text-emerald-400' },
    cyan:    { from: 'from-cyan-500/15',    ring: 'ring-cyan-500/40',    text: 'text-cyan-400' },
  };
  const t = tones[tone];
  return (
    <div className="aegis-card aegis-card-edge p-4 relative overflow-hidden">
      <div className={`absolute inset-0 bg-gradient-to-br ${t.from} to-transparent opacity-50 pointer-events-none`} />
      <div className="relative flex items-center gap-3">
        <div className={`w-10 h-10 rounded-lg bg-black/30 ring-1 ${t.ring} flex items-center justify-center flex-shrink-0 ${t.text}`}>
          <Icon className="w-4 h-4" />
        </div>
        <div className="min-w-0">
          <p className="text-2xl font-bold tabular-nums leading-none">{value}</p>
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground/70 font-semibold mt-1.5 truncate">{label}</p>
        </div>
      </div>
    </div>
  );
}

function Panel({ title, icon: Icon, children }: { title: string; icon: any; children: React.ReactNode }) {
  return (
    <div className="aegis-card aegis-card-edge overflow-hidden">
      <div className="px-4 py-2.5 border-b border-white/5 flex items-center gap-2">
        <Icon className="w-3.5 h-3.5 text-muted-foreground" />
        <span className="text-xs uppercase tracking-wider text-muted-foreground/70 font-semibold">{title}</span>
      </div>
      <div className="p-2 space-y-0.5">{children}</div>
    </div>
  );
}

function Skeleton() {
  return (
    <div className="flex items-center justify-center py-6">
      <Loader2 className="w-4 h-4 animate-spin text-muted-foreground/50" />
    </div>
  );
}

function Empty({ label }: { label: string }) {
  return <p className="text-xs text-muted-foreground/70 italic text-center py-4">{label}</p>;
}
