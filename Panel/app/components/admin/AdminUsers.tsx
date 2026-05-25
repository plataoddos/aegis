/**
 * Admin sub-page : user management.
 *
 *   - List all users with search
 *   - Expand a row to show details + actions
 *     · grant / revoke premium (custom duration)
 *     · promote / demote admin
 *     · delete the account
 */
import { useEffect, useMemo, useState } from 'react';
import {
  Users as UsersIcon, Shield, Crown, Trash2, ChevronDown, ChevronRight,
  Loader2, Search, RefreshCw,
} from 'lucide-react';
import { toast } from 'sonner';
import { apiGet, apiPatch, apiDelete } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import type { AdminUser } from './adminTypes';

function fmtDate(ts: number | null): string {
  if (!ts) return '—';
  return new Date(ts).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
}

function daysLeft(until: number | null): number {
  if (!until) return 0;
  const ms = until - Date.now();
  return ms > 0 ? Math.ceil(ms / 86400_000) : 0;
}

export function AdminUsers() {
  const { user: me } = useAuth();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [open, setOpen]     = useState<number | null>(null);

  const reload = async () => {
    setLoading(true);
    try {
      setUsers(await apiGet<AdminUser[]>('/api/admin/users'));
    } catch (e) {
      toast.error('Erreur', { description: (e as Error).message });
    } finally { setLoading(false); }
  };
  useEffect(() => { reload(); }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return users;
    return users.filter(u => u.username.toLowerCase().includes(q));
  }, [users, search]);

  const togglePremium = async (u: AdminUser) => {
    const isActive = u.premium_until && u.premium_until > Date.now();
    if (isActive) {
      if (!confirm(`Retirer le premium à ${u.username} ?`)) return;
      try {
        await apiPatch(`/api/admin/users/${u.id}`, { premium_until: null });
        toast.success('Premium retiré');
        await reload();
      } catch (e) { toast.error((e as Error).message); }
      return;
    }
    const days = prompt('Durée premium (jours) :', '30');
    if (days === null) return;
    const n = parseInt(days, 10);
    if (!Number.isFinite(n) || n < 1) return toast.error('Durée invalide');
    try {
      await apiPatch(`/api/admin/users/${u.id}`, { premium_until: Date.now() + n * 86400_000 });
      toast.success(`Premium activé pour ${n}j`);
      await reload();
    } catch (e) { toast.error((e as Error).message); }
  };

  const toggleAdmin = async (u: AdminUser) => {
    const willBeAdmin = !u.is_admin;
    const verb = willBeAdmin ? 'promouvoir' : 'rétrograder';
    if (!confirm(`Confirmer : ${verb} ${u.username} ?`)) return;
    try {
      await apiPatch(`/api/admin/users/${u.id}`, { is_admin: willBeAdmin });
      toast.success(`${u.username} est ${willBeAdmin ? 'admin' : 'utilisateur'}`);
      await reload();
    } catch (e) { toast.error((e as Error).message); }
  };

  const removeUser = async (u: AdminUser) => {
    if (u.id === me?.id) return toast.error('Impossible de te supprimer toi-même');
    if (!confirm(`Supprimer définitivement ${u.username} ? Cette action est irréversible.`)) return;
    try {
      await apiDelete(`/api/admin/users/${u.id}`);
      toast.success('Utilisateur supprimé');
      await reload();
    } catch (e) { toast.error((e as Error).message); }
  };

  return (
    <div className="aegis-card aegis-card-edge p-5">
      <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
        <h2 className="text-base font-semibold flex items-center gap-2">
          <UsersIcon className="w-4 h-4 text-indigo-400" />
          Utilisateurs ({filtered.length})
        </h2>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground pointer-events-none" />
            <input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder="Chercher…"
              className="bg-black/30 border border-white/5 rounded-md pl-7 pr-2 py-1 text-xs w-48 focus:outline-none focus:border-white/20" />
          </div>
          <button onClick={reload} disabled={loading}
            className="text-xs px-2 py-1 border border-white/10 hover:bg-white/5 rounded flex items-center gap-1 transition-all disabled:opacity-50">
            <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {loading ? (
        <p className="text-xs text-muted-foreground/70 italic text-center py-6">
          <Loader2 className="w-3 h-3 inline animate-spin mr-1" /> Chargement…
        </p>
      ) : filtered.length === 0 ? (
        <p className="text-sm text-muted-foreground italic text-center py-6">Aucun utilisateur.</p>
      ) : (
        <div className="space-y-1.5">
          {filtered.map(u => {
            const isMe = u.id === me?.id;
            const dl = daysLeft(u.premium_until);
            const isPremium = dl > 0;
            const isOpen = open === u.id;
            return (
              <div key={u.id} className="bg-black/20 rounded-lg border border-white/5 overflow-hidden">
                <button onClick={() => setOpen(isOpen ? null : u.id)}
                  className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-white/[0.02] text-left transition-colors">
                  <div className="w-8 h-8 rounded-md bg-gradient-to-br from-indigo-500/30 to-violet-500/10 ring-1 ring-indigo-500/40 flex items-center justify-center font-bold text-indigo-200 flex-shrink-0">
                    {u.username.slice(0, 1).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0 flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-semibold truncate">{u.username}</span>
                    {isMe && <span className="text-[9px] uppercase tracking-wider text-muted-foreground/70">(toi)</span>}
                    {!!u.is_admin && (
                      <span className="text-[9px] uppercase tracking-wider bg-amber-500/15 text-amber-400 ring-1 ring-amber-500/30 rounded px-1.5 py-0.5 font-bold flex items-center gap-0.5">
                        <Shield className="w-2.5 h-2.5" /> Admin
                      </span>
                    )}
                    {isPremium ? (
                      <span className="text-[9px] uppercase tracking-wider bg-violet-500/15 text-violet-300 ring-1 ring-violet-500/30 rounded px-1.5 py-0.5 font-bold flex items-center gap-0.5">
                        <Crown className="w-2.5 h-2.5" /> {dl}j
                      </span>
                    ) : (
                      <span className="text-[9px] uppercase tracking-wider text-muted-foreground/70">Free</span>
                    )}
                  </div>
                  <span className="text-[10px] text-muted-foreground/70 tabular-nums hidden sm:inline">
                    {u.last_login_at ? fmtDate(u.last_login_at) : 'jamais'}
                  </span>
                  {isOpen ? <ChevronDown className="w-4 h-4 text-muted-foreground" /> : <ChevronRight className="w-4 h-4 text-muted-foreground" />}
                </button>

                {isOpen && (
                  <div className="px-3 pb-3 pt-0 border-t border-white/5 bg-black/30">
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mt-3 text-[11px]">
                      <Detail label="ID"             value={`#${u.id}`} />
                      <Detail label="Créé le"        value={fmtDate(u.created_at)} />
                      <Detail label="Dernière conn." value={u.last_login_at ? fmtDate(u.last_login_at) : '—'} />
                      {u.premium_until && (
                        <Detail label="Premium jusqu'à" value={fmtDate(u.premium_until)} />
                      )}
                    </div>

                    <div className="flex flex-wrap gap-2 mt-3">
                      <button onClick={() => togglePremium(u)}
                        className="text-[10px] uppercase tracking-wider px-2.5 py-1 rounded bg-violet-500/10 text-violet-300 ring-1 ring-violet-500/30 hover:bg-violet-500/20 transition-colors flex items-center gap-1">
                        <Crown className="w-3 h-3" /> {isPremium ? 'Retirer le premium' : 'Activer premium…'}
                      </button>
                      {!isMe && (
                        <button onClick={() => toggleAdmin(u)}
                          className="text-[10px] uppercase tracking-wider px-2.5 py-1 rounded bg-amber-500/10 text-amber-300 ring-1 ring-amber-500/30 hover:bg-amber-500/20 transition-colors flex items-center gap-1">
                          <Shield className="w-3 h-3" /> {u.is_admin ? 'Retirer admin' : 'Promouvoir admin'}
                        </button>
                      )}
                      {!isMe && (
                        <button onClick={() => removeUser(u)}
                          className="text-[10px] uppercase tracking-wider px-2.5 py-1 rounded bg-rose-500/10 text-rose-300 ring-1 ring-rose-500/30 hover:bg-rose-500/20 transition-colors flex items-center gap-1 ml-auto">
                          <Trash2 className="w-3 h-3" /> Supprimer
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[9px] uppercase tracking-wider text-muted-foreground/70 font-semibold">{label}</p>
      <p className="text-foreground font-mono mt-0.5">{value}</p>
    </div>
  );
}
