import { useState } from 'react';
import { Plus, Trash2, User as UserIcon, Key, AlertCircle, ArrowLeft, Copy, Check, Search, X, Eye } from 'lucide-react';
import { WatcherAdmin } from './WatcherAdmin';

interface AdminPanelProps {
  onBack: () => void;
}

interface User {
  username: string;
  key: string;
  role?: string;
  createdAt: string;
  expiresAt: string | null;
  duration: number;
  credits?: number;
}

type AdminTab = 'keys' | 'watcher';

export function AdminPanel({ onBack }: AdminPanelProps) {
  const [tab, setTab] = useState<AdminTab>('keys');
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [username, setUsername] = useState('');
  const [duration, setDuration] = useState('30');
  const [error, setError]       = useState('');
  const [copiedKey, setCopiedKey] = useState('');
  const [filter, setFilter]     = useState('');
  const [users, setUsers]       = useState<User[]>(
    JSON.parse(localStorage.getItem('osint_users') || '[]')
  );

  const generateKey = () => {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let key = '';
    for (let i = 0; i < 24; i++) {
      key += chars.charAt(Math.floor(Math.random() * chars.length));
      if ((i + 1) % 4 === 0 && i < 23) key += '-';
    }
    return key;
  };

  const handleCreateKey = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!username.trim()) return setError('Veuillez entrer un nom d\'utilisateur');

    const key = generateKey();
    const expiresAt = duration === 'lifetime' ? null : (() => {
      const d = new Date();
      d.setDate(d.getDate() + parseInt(duration));
      return d.toISOString();
    })();

    const newUser: User = {
      username:  username.trim(),
      key,
      createdAt: new Date().toISOString(),
      expiresAt,
      duration:  duration === 'lifetime' ? -1 : parseInt(duration),
    };

    const updated = [...users, newUser];
    setUsers(updated);
    localStorage.setItem('osint_users', JSON.stringify(updated));

    setUsername('');
    setDuration('30');
    setShowCreateForm(false);
  };

  const handleDeleteUser = (key: string, role?: string) => {
    if (role === 'admin') return alert('La clé administrateur ne peut pas être supprimée.');
    if (!confirm('Supprimer cette clé d\'accès ?')) return;
    const updated = users.filter(u => u.key !== key);
    setUsers(updated);
    localStorage.setItem('osint_users', JSON.stringify(updated));
  };

  const handleCopyKey = (key: string) => {
    navigator.clipboard.writeText(key);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(''), 2000);
  };

  const isExpired = (e: string | null) => e ? new Date(e) < new Date() : false;
  const daysLeft  = (e: string | null) => e ? Math.ceil((new Date(e).getTime() - Date.now()) / 86400000) : Infinity;

  const filtered = users.filter(u =>
    !filter || u.username.toLowerCase().includes(filter.toLowerCase()) || u.key.toLowerCase().includes(filter.toLowerCase())
  );

  const stats = {
    total:    users.length,
    active:   users.filter(u => !isExpired(u.expiresAt)).length,
    expired:  users.filter(u =>  isExpired(u.expiresAt)).length,
    lifetime: users.filter(u => !u.expiresAt).length,
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Top bar */}
      <header className="border-b border-border bg-background sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button onClick={onBack} className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors">
              <ArrowLeft className="w-4 h-4" />Retour
            </button>
            <span className="text-muted-foreground">/</span>
            <span className="text-foreground font-medium text-sm">Administration</span>
          </div>
          <img src="/aegis-logo.png" alt="Aegis" className="h-7 w-auto drop-shadow-[0_0_12px_rgba(99,102,241,0.4)]" />
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-6 py-10">
        {/* Title */}
        <div className="mb-6">
          <h1 className="text-3xl font-bold tracking-tight text-foreground">Administration</h1>
          <p className="text-muted-foreground mt-2">Gestion des clés et du pool Discord Watcher</p>
        </div>

        {/* Tabs */}
        <div className="flex gap-2 border-b border-border mb-8">
          {[
            { id: 'keys' as const,    label: 'Clés d\'accès', Icon: Key },
            { id: 'watcher' as const, label: 'Discord Watcher', Icon: Eye },
          ].map(t => {
            const Icon = t.Icon;
            const active = tab === t.id;
            return (
              <button key={t.id} onClick={() => setTab(t.id)}
                className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 -mb-[1px] transition-colors ${
                  active ? 'border-foreground text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'
                }`}>
                <Icon className="w-4 h-4" />{t.label}
              </button>
            );
          })}
        </div>

        {tab === 'watcher' ? <WatcherAdmin /> : <>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-10">
          {[
            { label: 'Total',     value: stats.total,    sub: 'clés enregistrées' },
            { label: 'Actives',   value: stats.active,   sub: 'utilisables maintenant' },
            { label: 'Lifetime',  value: stats.lifetime, sub: 'sans expiration' },
            { label: 'Expirées',  value: stats.expired,  sub: 'à nettoyer' },
          ].map((s) => (
            <div key={s.label} className="bg-card border border-border rounded-xl p-5">
              <p className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">{s.label}</p>
              <p className="text-3xl font-bold text-foreground mt-2 tabular-nums">{s.value}</p>
              <p className="text-xs text-muted-foreground mt-1">{s.sub}</p>
            </div>
          ))}
        </div>

        {/* Action bar */}
        <div className="flex items-center gap-3 mb-6">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
            <input
              value={filter}
              onChange={e => setFilter(e.target.value)}
              placeholder="Rechercher par nom ou clé..."
              className="w-full bg-input border border-border rounded-lg pl-9 pr-4 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
          <button
            onClick={() => setShowCreateForm(true)}
            className="flex items-center gap-2 bg-primary hover:bg-primary/90 text-primary-foreground font-medium px-4 py-2 rounded-lg text-sm transition-colors"
          >
            <Plus className="w-4 h-4" />Nouvelle clé
          </button>
        </div>

        {/* Users table */}
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          {filtered.length === 0 ? (
            <div className="text-center py-16">
              <Key className="w-10 h-10 text-muted-foreground/50 mx-auto mb-3" />
              <p className="text-muted-foreground text-sm">{filter ? 'Aucun résultat' : 'Aucune clé créée pour le moment'}</p>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  <th className="text-left text-xs uppercase tracking-wider text-muted-foreground font-semibold px-6 py-3">Utilisateur</th>
                  <th className="text-left text-xs uppercase tracking-wider text-muted-foreground font-semibold px-6 py-3">Clé d'accès</th>
                  <th className="text-left text-xs uppercase tracking-wider text-muted-foreground font-semibold px-6 py-3">Statut</th>
                  <th className="text-left text-xs uppercase tracking-wider text-muted-foreground font-semibold px-6 py-3">Expiration</th>
                  <th className="text-right text-xs uppercase tracking-wider text-muted-foreground font-semibold px-6 py-3">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((user) => {
                  const expired = isExpired(user.expiresAt);
                  const days    = daysLeft(user.expiresAt);
                  return (
                    <tr key={user.key} className="border-b border-border last:border-0 hover:bg-muted/20 transition-colors">
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center">
                            <UserIcon className="w-4 h-4 text-muted-foreground" />
                          </div>
                          <div>
                            <p className="text-foreground font-medium">{user.username}</p>
                            <p className="text-xs text-muted-foreground">{new Date(user.createdAt).toLocaleDateString('fr-FR')}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-2">
                          <code className="font-mono text-xs text-foreground/80 bg-muted px-2 py-1 rounded">{user.key.substring(0, 14)}…</code>
                          <button onClick={() => handleCopyKey(user.key)} className="text-muted-foreground hover:text-foreground p-1 rounded transition-colors">
                            {copiedKey === user.key ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                          </button>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex flex-wrap gap-1.5">
                          {user.role === 'admin' && (
                            <span className="text-xs px-2 py-0.5 rounded-md bg-foreground text-background font-semibold">Admin</span>
                          )}
                          {!user.expiresAt && (
                            <span className="text-xs px-2 py-0.5 rounded-md border border-border text-foreground">Lifetime</span>
                          )}
                          {expired ? (
                            <span className="text-xs px-2 py-0.5 rounded-md bg-destructive/15 text-destructive border border-destructive/30">Expirée</span>
                          ) : user.expiresAt && (
                            <span className="text-xs px-2 py-0.5 rounded-md border border-border text-muted-foreground">Active</span>
                          )}
                        </div>
                      </td>
                      <td className="px-6 py-4 text-muted-foreground">
                        {!user.expiresAt
                          ? <span className="text-foreground">∞</span>
                          : expired
                          ? <span className="text-destructive/80">{new Date(user.expiresAt).toLocaleDateString('fr-FR')}</span>
                          : <span>{days} jour{days > 1 ? 's' : ''}</span>}
                      </td>
                      <td className="px-6 py-4 text-right">
                        <button
                          onClick={() => handleDeleteUser(user.key, user.role)}
                          disabled={user.role === 'admin'}
                          className="text-muted-foreground hover:text-destructive disabled:opacity-30 disabled:cursor-not-allowed p-1.5 rounded transition-colors"
                          title={user.role === 'admin' ? 'Impossible de supprimer admin' : 'Supprimer'}
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
        </>}
      </div>

      {/* Create modal */}
      {showCreateForm && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-50" onClick={() => setShowCreateForm(false)}>
          <div className="bg-card border border-border rounded-xl w-full max-w-md shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-4 border-b border-border">
              <h3 className="text-foreground font-semibold">Nouvelle clé d'accès</h3>
              <button onClick={() => setShowCreateForm(false)} className="text-muted-foreground hover:text-foreground">
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleCreateKey} className="p-6 space-y-4">
              <div>
                <label className="block mb-1.5 text-sm text-foreground font-medium">Nom d'utilisateur</label>
                <input
                  type="text" value={username} onChange={(e) => setUsername(e.target.value)}
                  placeholder="John Doe"
                  className="w-full bg-input border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                />
              </div>
              <div>
                <label className="block mb-1.5 text-sm text-foreground font-medium">Durée d'accès</label>
                <select value={duration} onChange={(e) => setDuration(e.target.value)}
                  className="w-full bg-input border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring">
                  <option value="1">1 jour</option>
                  <option value="7">7 jours</option>
                  <option value="30">30 jours</option>
                  <option value="90">90 jours</option>
                  <option value="365">1 an</option>
                  <option value="lifetime">Lifetime (illimité)</option>
                </select>
              </div>
              {error && (
                <div className="flex items-center gap-2 bg-destructive/10 border border-destructive/30 rounded-lg px-3 py-2.5">
                  <AlertCircle className="w-4 h-4 text-destructive flex-shrink-0" />
                  <p className="text-sm text-destructive">{error}</p>
                </div>
              )}
              <div className="flex gap-2 pt-2">
                <button type="button" onClick={() => setShowCreateForm(false)}
                  className="flex-1 border border-border hover:bg-muted text-foreground font-medium py-2 rounded-lg text-sm transition-colors">
                  Annuler
                </button>
                <button type="submit"
                  className="flex-1 bg-primary hover:bg-primary/90 text-primary-foreground font-medium py-2 rounded-lg text-sm transition-colors">
                  Générer la clé
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
