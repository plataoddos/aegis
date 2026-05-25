/**
 * Admin sub-page : Discord Watcher management.
 *
 * Lets an admin :
 *  - see backend pool status (accounts ready / total guilds / watched ids)
 *  - add new selfbot tokens to the pool
 *  - enable / disable / start / stop / delete individual accounts
 *  - restart the whole pool
 */
import { useEffect, useState } from 'react';
import {
  Plus, Trash2, Power, Loader2, RefreshCw, CheckCircle2,
  Shield, Eye, EyeOff, Server, Wifi, WifiOff, Play, Square, AlertCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import { apiGet, apiPost, apiPatch, apiDelete, API_URL } from '../../lib/api';

interface Account {
  id: number;
  label: string | null;
  enabled: boolean;
  token_preview: string;
  status: 'stopped' | 'starting' | 'ready' | 'error';
  username: string | null;
  user_id: string | null;
  guilds: number;
  ping: number | null;
  last_error: string | null;
}

interface Status {
  accounts: Account[];
  ready_accounts: number;
  total_accounts: number;
  total_guilds: number;
  watched: number;
}

const STATUS_BADGE: Record<Account['status'], { label: string; cls: string }> = {
  ready:    { label: 'Connecté',     cls: 'bg-emerald-500/15 text-emerald-400 ring-emerald-500/30' },
  starting: { label: 'Connexion…',   cls: 'bg-amber-500/15 text-amber-400 ring-amber-500/30' },
  stopped:  { label: 'Arrêté',       cls: 'bg-zinc-500/15 text-zinc-400 ring-zinc-500/30' },
  error:    { label: 'Erreur',       cls: 'bg-rose-500/15 text-rose-400 ring-rose-500/30' },
};

export function AdminWatcher() {
  const [status, setStatus]     = useState<Status | null>(null);
  const [error,  setError]      = useState<string | null>(null);
  const [busy,   setBusy]       = useState(false);
  const [showAdd, setShowAdd]   = useState(false);
  const [newToken, setNewToken] = useState('');
  const [newLabel, setNewLabel] = useState('');
  const [showToken, setShowToken] = useState(false);

  const refresh = async () => {
    try {
      const s = await apiGet<Status>('/api/status');
      setStatus(s);
      setError(null);
    } catch (e: any) {
      setError(e.message);
    }
  };

  useEffect(() => {
    refresh();
    const i = setInterval(refresh, 8_000);
    return () => clearInterval(i);
  }, []);

  const action = async (label: string, fn: () => Promise<any>) => {
    setBusy(true);
    try {
      await fn();
      toast.success(label);
      await refresh();
    } catch (e: any) {
      toast.error('Erreur', { description: e.message });
    } finally {
      setBusy(false);
    }
  };

  const addAccount = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newToken.trim() || newToken.trim().length < 30) {
      toast.error('Token invalide (au moins 30 caractères)');
      return;
    }
    action('Compte ajouté au pool', async () => {
      await apiPost('/api/accounts', { token: newToken.trim(), label: newLabel.trim() || null });
      setNewToken(''); setNewLabel(''); setShowAdd(false);
    });
  };

  if (error) {
    return (
      <div className="aegis-card aegis-card-edge p-8 text-center">
        <WifiOff className="w-10 h-10 text-rose-400 mx-auto mb-3" />
        <h3 className="font-semibold mb-1">Backend Watcher injoignable</h3>
        <p className="text-sm text-muted-foreground mb-4 font-mono">{error}</p>
        <p className="text-xs text-muted-foreground/70 mb-4">
          Vérifie que le backend tourne sur <code className="text-foreground">{API_URL}</code>.
        </p>
        <button onClick={refresh}
          className="inline-flex items-center gap-2 text-sm border border-white/10 hover:bg-white/5 rounded-lg px-4 py-2 transition-all">
          <RefreshCw className="w-4 h-4" /> Réessayer
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Backend status + actions */}
      <div className="aegis-card aegis-card-edge p-5 flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-emerald-500/15 ring-1 ring-emerald-500/30 flex items-center justify-center">
            <Wifi className="w-5 h-5 text-emerald-400" />
          </div>
          <div>
            <p className="font-semibold">Backend connecté</p>
            <p className="text-xs text-muted-foreground font-mono">{API_URL}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => action('Pool redémarré', () => apiPost('/api/control/restart', {}))}
            disabled={busy}
            className="flex items-center gap-1.5 text-xs px-3 py-2 border border-white/10 hover:bg-white/5 rounded-lg transition-all disabled:opacity-50">
            <RefreshCw className={`w-3.5 h-3.5 ${busy ? 'animate-spin' : ''}`} />
            Redémarrer le pool
          </button>
          <button onClick={() => setShowAdd(true)}
            className="aegis-btn-primary text-primary-foreground px-3 py-2 rounded-lg text-xs font-semibold flex items-center gap-1.5">
            <Plus className="w-3.5 h-3.5" /> Ajouter un compte
          </button>
        </div>
      </div>

      {/* Stats */}
      {status && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <PoolStat label="Comptes connectés" value={`${status.ready_accounts} / ${status.total_accounts}`}
            tone={status.ready_accounts > 0 ? 'emerald' : 'zinc'} />
          <PoolStat label="Serveurs couverts" value={status.total_guilds.toString()} tone="indigo" />
          <PoolStat label="IDs surveillés"    value={status.watched.toString()}     tone="violet" />
          <PoolStat label="État global"
            value={status.ready_accounts > 0 ? 'Actif' : 'Inactif'}
            tone={status.ready_accounts > 0 ? 'emerald' : 'rose'} />
        </div>
      )}

      {/* Accounts list */}
      <div className="aegis-card aegis-card-edge overflow-hidden">
        <div className="px-5 py-3 border-b border-white/5 flex items-center gap-2">
          <Server className="w-4 h-4 text-muted-foreground" />
          <span className="text-sm font-semibold">Pool de comptes</span>
          <span className="ml-auto text-xs text-muted-foreground tabular-nums">{status?.total_accounts ?? 0} compte(s)</span>
        </div>

        {!status?.accounts.length ? (
          <div className="text-center py-12 px-5">
            <Shield className="w-10 h-10 text-muted-foreground/50 mx-auto mb-3" />
            <p className="text-muted-foreground text-sm mb-3">Aucun compte ajouté au pool.</p>
            <button onClick={() => setShowAdd(true)}
              className="text-xs px-3 py-1.5 border border-white/10 hover:bg-white/5 rounded-lg transition-all">
              Ajouter le premier compte
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[720px]">
              <thead>
                <tr className="bg-black/30 border-b border-white/5">
                  <Th>Compte</Th>
                  <Th>Token</Th>
                  <Th>Statut</Th>
                  <Th>Serveurs</Th>
                  <Th>Ping</Th>
                  <Th align="right">Actions</Th>
                </tr>
              </thead>
              <tbody>
                {status.accounts.map(acc => (
                  <tr key={acc.id} className="border-b border-white/5 last:border-0 hover:bg-white/[0.02] transition-colors">
                    <td className="px-4 py-3">
                      <p className="font-medium text-sm">{acc.label || acc.username || `Compte #${acc.id}`}</p>
                      {acc.username && acc.label && (
                        <p className="text-[10px] text-muted-foreground font-mono">@{acc.username}</p>
                      )}
                      {acc.last_error && (
                        <p className="text-[10px] text-rose-400 mt-0.5 truncate max-w-[200px] flex items-center gap-1" title={acc.last_error}>
                          <AlertCircle className="w-2.5 h-2.5 flex-shrink-0" /> {acc.last_error}
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <code className="text-[10px] text-muted-foreground font-mono">{acc.token_preview}</code>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center text-[10px] uppercase tracking-wider px-2 py-0.5 rounded ring-1 font-bold ${STATUS_BADGE[acc.status].cls}`}>
                        {STATUS_BADGE[acc.status].label}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground tabular-nums text-xs">{acc.guilds}</td>
                    <td className="px-4 py-3 text-muted-foreground tabular-nums text-xs">{acc.ping != null ? `${acc.ping} ms` : '—'}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-0.5">
                        {acc.status === 'stopped' ? (
                          <button title="Démarrer"
                            onClick={() => action('Compte démarré', () => apiPost(`/api/accounts/${acc.id}/start`, {}))}
                            className="p-1.5 rounded text-emerald-400 hover:bg-white/5 transition-colors">
                            <Play className="w-3.5 h-3.5" />
                          </button>
                        ) : (
                          <button title="Arrêter"
                            onClick={() => action('Compte arrêté', () => apiPost(`/api/accounts/${acc.id}/stop`, {}))}
                            className="p-1.5 rounded text-amber-400 hover:bg-white/5 transition-colors">
                            <Square className="w-3.5 h-3.5" />
                          </button>
                        )}
                        <button title={acc.enabled ? 'Désactiver' : 'Activer'}
                          onClick={() => action(acc.enabled ? 'Compte désactivé' : 'Compte activé',
                            () => apiPatch(`/api/accounts/${acc.id}`, { enabled: !acc.enabled }))}
                          className={`p-1.5 rounded transition-colors hover:bg-white/5 ${acc.enabled ? 'text-emerald-400' : 'text-muted-foreground'}`}>
                          <Power className="w-3.5 h-3.5" />
                        </button>
                        <button title="Supprimer"
                          onClick={() => {
                            if (!confirm(`Supprimer "${acc.label || acc.username || acc.id}" du pool ?`)) return;
                            action('Compte supprimé', () => apiDelete(`/api/accounts/${acc.id}`));
                          }}
                          className="p-1.5 rounded text-muted-foreground hover:text-rose-400 hover:bg-white/5 transition-colors">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="aegis-card aegis-card-edge p-4 bg-amber-500/[0.03] border-amber-500/20">
        <p className="text-xs text-muted-foreground flex items-start gap-2">
          <AlertCircle className="w-3.5 h-3.5 text-amber-400 flex-shrink-0 mt-0.5" />
          <span>
            <strong className="text-amber-400">Attention :</strong> les tokens ajoutés sont des
            tokens utilisateur (selfbot), pas des bots Discord. Leur utilisation viole les ToS
            de Discord et le compte peut être banni. Utilise uniquement des comptes jetables.
          </span>
        </p>
      </div>

      {/* Add account modal */}
      {showAdd && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-50" onClick={() => setShowAdd(false)}>
          <div className="aegis-card aegis-card-edge w-full max-w-md shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="px-5 py-4 border-b border-white/5">
              <h3 className="font-semibold">Ajouter un compte au pool</h3>
              <p className="text-xs text-muted-foreground mt-0.5">Le compte tente une connexion immédiate.</p>
            </div>
            <form onSubmit={addAccount} className="p-5 space-y-4">
              <div>
                <label className="block mb-1.5 text-[10px] uppercase tracking-wider text-muted-foreground/70 font-semibold">Label (optionnel)</label>
                <input value={newLabel} onChange={e => setNewLabel(e.target.value)}
                  placeholder="ex: alt-1, watcher-fr…"
                  className="w-full bg-input/60 border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40" />
              </div>
              <div>
                <label className="block mb-1.5 text-[10px] uppercase tracking-wider text-muted-foreground/70 font-semibold">Token utilisateur</label>
                <div className="relative">
                  <input value={newToken} onChange={e => setNewToken(e.target.value)} type={showToken ? 'text' : 'password'}
                    placeholder="MTAxxxxxxx.xxxxxx.xxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                    className="w-full bg-input/60 border border-border rounded-lg pr-10 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 font-mono" />
                  <button type="button" onClick={() => setShowToken(s => !s)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                    {showToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                <p className="text-[10px] text-muted-foreground/70 mt-1.5">
                  DevTools → Network → header <code className="text-foreground">authorization</code>.
                </p>
              </div>
              <div className="flex gap-2 pt-2">
                <button type="button" onClick={() => setShowAdd(false)}
                  className="flex-1 border border-white/10 hover:bg-white/5 rounded-lg py-2 text-sm transition-colors">
                  Annuler
                </button>
                <button type="submit" disabled={busy}
                  className="flex-1 aegis-btn-primary text-primary-foreground rounded-lg py-2 text-sm font-semibold flex items-center justify-center gap-1.5 disabled:opacity-50">
                  {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                  Ajouter
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

function PoolStat({ label, value, tone }: { label: string; value: string; tone: 'emerald' | 'rose' | 'zinc' | 'indigo' | 'violet' }) {
  const tones: Record<string, string> = {
    emerald: 'text-emerald-400',
    rose:    'text-rose-400',
    zinc:    'text-zinc-400',
    indigo:  'text-foreground',
    violet:  'text-foreground',
  };
  return (
    <div className="aegis-card aegis-card-edge p-4">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground/70 font-semibold">{label}</p>
      <p className={`text-2xl font-bold mt-1 tabular-nums ${tones[tone]}`}>{value}</p>
    </div>
  );
}

function Th({ children, align = 'left' }: { children: React.ReactNode; align?: 'left' | 'right' }) {
  return (
    <th className={`text-${align} text-[10px] uppercase tracking-wider text-muted-foreground/70 font-semibold px-4 py-2.5`}>
      {children}
    </th>
  );
}
