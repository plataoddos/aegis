/**
 * Admin shell — combines the four sub-pages behind a sticky tab bar.
 *
 *   Overview · Clés premium · Utilisateurs · Discord Watcher
 *
 * Each sub-page is a self-contained file in ./admin/ so this shell stays slim
 * and easy to extend (just drop a new entry in SUB_TABS).
 */
import { useState } from 'react';
import { Ban, Shield, TrendingUp, KeyRound, Users, Eye, Activity } from 'lucide-react';
import { useAuth } from '../lib/auth';
import { AdminOverview } from './admin/AdminOverview';
import { AdminStats }    from './admin/AdminStats';
import { AdminKeys }     from './admin/AdminKeys';
import { AdminUsers }    from './admin/AdminUsers';
import { AdminWatcher }  from './admin/AdminWatcher';

type SubId = 'overview' | 'stats' | 'keys' | 'users' | 'watcher';

const SUB_TABS: { id: SubId; label: string; icon: any; Component: React.ComponentType; description: string }[] = [
  { id: 'overview', label: 'Aperçu',         icon: TrendingUp, Component: AdminOverview, description: 'Statistiques globales et activité récente.' },
  { id: 'stats',    label: 'Statistiques',   icon: Activity,   Component: AdminStats,    description: 'Consommation détaillée par API, endpoint et utilisateur.' },
  { id: 'keys',     label: 'Clés premium',   icon: KeyRound,   Component: AdminKeys,     description: 'Générer et gérer les clés d\'activation.' },
  { id: 'users',    label: 'Utilisateurs',   icon: Users,      Component: AdminUsers,    description: 'Comptes inscrits, premium et droits admin.' },
  { id: 'watcher',  label: 'Discord Watcher', icon: Eye,        Component: AdminWatcher,  description: 'Pool de comptes selfbot et état du backend.' },
];

export function AdminPage() {
  const { user } = useAuth();
  const [sub, setSub] = useState<SubId>('overview');

  if (!user?.is_admin) {
    return (
      <div className="aegis-card aegis-card-edge p-10 text-center max-w-md mx-auto">
        <Ban className="w-10 h-10 text-rose-400 mx-auto mb-3" />
        <h2 className="text-lg font-bold mb-1">Accès refusé</h2>
        <p className="text-sm text-muted-foreground">Cette page est réservée aux administrateurs.</p>
      </div>
    );
  }

  const activeSub = SUB_TABS.find(t => t.id === sub) || SUB_TABS[0];
  const Active    = activeSub.Component;

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="aegis-card aegis-card-edge p-6 relative overflow-hidden">
        <div className="absolute -top-12 -right-12 w-52 h-52 rounded-full bg-gradient-to-br from-amber-500/20 to-rose-500/0 blur-3xl pointer-events-none" />
        <div className="flex items-start gap-4 relative">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-amber-500/30 to-rose-500/10 ring-1 ring-amber-500/40 flex items-center justify-center flex-shrink-0">
            <Shield className="w-6 h-6 text-amber-400" />
          </div>
          <div className="flex-1 min-w-0">
            <h1 className="text-2xl font-bold tracking-tight">Administration</h1>
            <p className="text-sm text-muted-foreground mt-0.5">{activeSub.description}</p>
          </div>
        </div>
      </div>

      {/* Sub-tabs */}
      <div className="aegis-card aegis-card-edge p-1.5 flex items-center gap-1 overflow-x-auto">
        {SUB_TABS.map(t => {
          const Icon = t.icon;
          const isActive = sub === t.id;
          return (
            <button key={t.id} onClick={() => setSub(t.id)}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold transition-all whitespace-nowrap ${
                isActive
                  ? 'bg-primary/15 text-primary ring-1 ring-primary/30'
                  : 'text-muted-foreground hover:text-foreground hover:bg-white/5'
              }`}>
              <Icon className="w-3.5 h-3.5" />
              {t.label}
            </button>
          );
        })}
      </div>

      {/* Active sub-page */}
      <Active />
    </div>
  );
}
