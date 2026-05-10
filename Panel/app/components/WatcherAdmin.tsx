import { useEffect, useState } from 'react';
import {
  Plus, Trash2, Power, Loader2, RefreshCw, CheckCircle2,
  Shield, Eye, EyeOff, Server, Wifi, WifiOff,
} from 'lucide-react';
import { toast } from 'sonner';

const API_URL   = ((import.meta as any).env?.VITE_WATCHER_API_URL  as string) || 'http://localhost:8787';
const API_TOKEN = ((import.meta as any).env?.VITE_WATCHER_API_TOKEN as string) || '';

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

async function api<T>(path: string, init?: RequestInit): Promise<T> {
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

const STATUS_BADGE: Record<Account['status'], { label: string; cls: string }> = {
  ready:    { label: 'Connecté',     cls: 'bg-emerald-400/15 text-emerald-400 border-emerald-400/30' },
  starting: { label: 'Connexion...', cls: 'bg-amber-400/15 text-amber-400 border-amber-400/30' },
  stopped:  { label: 'Arrêté',       cls: 'bg-muted text-muted-foreground border-border' },
  error:    { label: 'Erreur',       cls: 'bg-rose-400/15 text-rose-400 border-rose-400/30' },
};

export function WatcherAdmin() {
  const [status, setStatus]  = useState<Status | null>(null);
  const [error,  setError]   = useState<string | null>(null);
  const [busy,   setBusy]    = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [newToken, setNewToken] = useState('');
  const [newLabel, setNewLabel] = useState('');
  const [showToken, setShowToken] = useState(false);

  const refresh = async () => {
    try {
      const s = await api<Status>('/api/status');
      setStatus(s);
      setError(null);
    } catch (e: any) {
      setError(e.message);
    }
  };

  useEffect(() => {
    refresh();
    const i = setInterval(refresh, 8000);
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
      toast.error('Token invalide');
      return;
    }
    action('Compte ajouté', async () => {
      await api('/api/accounts', {
        method: 'POST',
        body: JSON.stringify({ token: newToken.trim(), label: newLabel.trim() || null }),
      });
      setNewToken(''); setNewLabel(''); setShowAdd(false);
    });
  };

  // ── Backend down state ────────────────────────────────────────────────────
  if (error) {
    return (
      <div className="bg-card border border-border rounded-xl p-8 text-center">
        <WifiOff className="w-10 h-10 text-destructive mx-auto mb-3" />
        <h3 className="text-foreground font-semibold mb-1">Backend Watcher injoignable</h3>
        <p className="text-sm text-muted-foreground mb-4 font-mono">{error}</p>
        <div className="bg-muted/40 border border-border rounded-lg p-4 max-w-lg mx-auto text-left text-xs text-muted-foreground space-y-1">
          <p><span className="text-foreground font-semibold">1.</span> <code>cd backend && npm install</code></p>
          <p><span className="text-foreground font-semibold">2.</span> Configure <code>backend/.env</code> (API_TOKEN)</p>
          <p><span className="text-foreground font-semibold">3.</span> <code>npm run dev</code></p>
          <p><span className="text-foreground font-semibold">4.</span> Vérifie que <code>VITE_WATCHER_API_TOKEN</code> dans <code>Panel/.env.local</code> matche</p>
        </div>
        <button onClick={refresh} className="mt-5 inline-flex items-center gap-2 text-sm border border-border rounded-md px-4 py-2 hover:bg-muted text-foreground">
          <RefreshCw className="w-4 h-4" />Réessayer
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Status header */}
      <div className="bg-card border border-border rounded-xl p-6 flex items-center justify-between flex-wrap gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-emerald-400/10 border border-emerald-400/30 flex items-center justify-center">
            <Wifi className="w-5 h-5 text-emerald-400" />
          </div>
          <div>
            <p className="text-foreground font-semibold">Backend connecté</p>
            <p className="text-xs text-muted-foreground">{API_URL}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => action('Pool redémarré', () => api('/api/control/restart', { method: 'POST' }))}
            disabled={busy}
            className="flex items-center gap-2 border border-border hover:bg-muted text-foreground px-4 py-2 rounded-lg text-sm transition-colors disabled:opacity-60">
            <RefreshCw className={`w-4 h-4 ${busy ? 'animate-spin' : ''}`} />Redémarrer le pool
          </button>
          <button onClick={() => setShowAdd(true)}
            className="flex items-center gap-2 bg-primary hover:bg-primary/90 text-primary-foreground px-4 py-2 rounded-lg text-sm font-medium transition-colors">
            <Plus className="w-4 h-4" />Ajouter un compte
          </button>
        </div>
      </div>

      {/* Stats */}
      {status && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Stat label="Comptes connectés" value={`${status.ready_accounts}/${status.total_accounts}`} />
          <Stat label="Serveurs couverts"  value={status.total_guilds} />
          <Stat label="IDs surveillés"     value={status.watched} />
          <Stat label="Statut global"      value={status.ready_accounts > 0 ? 'Actif' : 'Inactif'}
            valueClass={status.ready_accounts > 0 ? 'text-emerald-400' : 'text-muted-foreground'} />
        </div>
      )}

      {/* Accounts table */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="px-6 py-4 border-b border-border flex items-center gap-2">
          <Server className="w-4 h-4 text-muted-foreground" />
          <span className="text-foreground font-medium text-sm">Pool de comptes</span>
          <span className="ml-auto text-xs text-muted-foreground">{status?.total_accounts ?? 0} compte(s)</span>
        </div>

        {!status?.accounts.length ? (
          <div className="text-center py-16">
            <Shield className="w-10 h-10 text-muted-foreground/50 mx-auto mb-3" />
            <p className="text-muted-foreground text-sm">Aucun compte ajouté</p>
            <button onClick={() => setShowAdd(true)} className="mt-4 text-sm text-foreground border border-border rounded-md px-3 py-1.5 hover:bg-muted transition-colors">
              Ajouter le premier
            </button>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/30">
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
                <tr key={acc.id} className="border-b border-border last:border-0 hover:bg-muted/20 transition-colors">
                  <td className="px-6 py-4">
                    <p className="text-foreground font-medium">{acc.label || acc.username || `Compte #${acc.id}`}</p>
                    {acc.username && acc.label && (
                      <p className="text-xs text-muted-foreground font-mono">@{acc.username}</p>
                    )}
                    {acc.last_error && (
                      <p className="text-xs text-rose-400 mt-0.5 truncate max-w-xs" title={acc.last_error}>{acc.last_error}</p>
                    )}
                  </td>
                  <td className="px-6 py-4">
                    <code className="text-xs text-muted-foreground font-mono">{acc.token_preview}</code>
                  </td>
                  <td className="px-6 py-4">
                    <span className={`inline-block text-xs px-2 py-0.5 rounded-md border ${STATUS_BADGE[acc.status].cls}`}>
                      {STATUS_BADGE[acc.status].label}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-muted-foreground tabular-nums">{acc.guilds}</td>
                  <td className="px-6 py-4 text-muted-foreground tabular-nums">{acc.ping != null ? `${acc.ping} ms` : '—'}</td>
                  <td className="px-6 py-4">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        onClick={() => action(acc.enabled ? 'Compte désactivé' : 'Compte activé',
                          () => api(`/api/accounts/${acc.id}`, { method: 'PATCH', body: JSON.stringify({ enabled: !acc.enabled }) }))}
                        className={`p-2 rounded transition-colors ${acc.enabled ? 'text-emerald-400 hover:bg-muted' : 'text-muted-foreground hover:bg-muted'}`}
                        title={acc.enabled ? 'Désactiver' : 'Activer'}
                      >
                        <Power className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => {
                          if (!confirm(`Supprimer "${acc.label || acc.username || acc.id}" du pool ?`)) return;
                          action('Compte supprimé', () => api(`/api/accounts/${acc.id}`, { method: 'DELETE' }));
                        }}
                        className="p-2 rounded text-muted-foreground hover:text-destructive hover:bg-muted transition-colors"
                        title="Supprimer"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Add account modal */}
      {showAdd && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-50" onClick={() => setShowAdd(false)}>
          <div className="bg-card border border-border rounded-xl w-full max-w-md shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="px-6 py-4 border-b border-border">
              <h3 className="text-foreground font-semibold">Ajouter un compte</h3>
              <p className="text-xs text-muted-foreground mt-1">Le compte est connecté immédiatement</p>
            </div>
            <form onSubmit={addAccount} className="p-6 space-y-4">
              <div>
                <label className="block mb-1.5 text-sm text-foreground font-medium">Label (optionnel)</label>
                <input value={newLabel} onChange={e => setNewLabel(e.target.value)}
                  placeholder="Ex: alt-1, watcher-fr, etc."
                  className="w-full bg-input border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring" />
              </div>
              <div>
                <label className="block mb-1.5 text-sm text-foreground font-medium">Token utilisateur</label>
                <div className="relative">
                  <input value={newToken} onChange={e => setNewToken(e.target.value)} type={showToken ? 'text' : 'password'}
                    placeholder="MTAxxxxxxxxxxxxxxx.xxxxxx.xxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                    className="w-full bg-input border border-border rounded-lg pr-10 px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-1 focus:ring-ring font-mono" />
                  <button type="button" onClick={() => setShowToken(s => !s)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                    {showToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                <p className="text-xs text-muted-foreground mt-1.5">Récupérable via DevTools → Network → Header <code>authorization</code></p>
              </div>
              <div className="flex gap-2 pt-2">
                <button type="button" onClick={() => setShowAdd(false)}
                  className="flex-1 border border-border hover:bg-muted text-foreground font-medium py-2 rounded-lg text-sm transition-colors">
                  Annuler
                </button>
                <button type="submit" disabled={busy}
                  className="flex-1 bg-primary hover:bg-primary/90 disabled:opacity-60 text-primary-foreground font-medium py-2 rounded-lg text-sm flex items-center justify-center gap-2 transition-colors">
                  {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                  Ajouter et connecter
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, valueClass = '' }: { label: string; value: number | string; valueClass?: string }) {
  return (
    <div className="bg-card border border-border rounded-xl p-5">
      <p className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">{label}</p>
      <p className={`text-3xl font-bold mt-2 tabular-nums ${valueClass || 'text-foreground'}`}>{value}</p>
    </div>
  );
}

function Th({ children, align = 'left' }: { children: React.ReactNode; align?: 'left' | 'right' }) {
  return (
    <th className={`text-${align} text-xs uppercase tracking-wider text-muted-foreground font-semibold px-6 py-3`}>
      {children}
    </th>
  );
}
