/**
 * Account / profile page — shell avec sous-tabs (Aperçu, Premium, Sécurité).
 *
 *   Aperçu   → identité, quota, dernier login
 *   Premium  → activation des clés, perks
 *   Sécurité → changement de mot de passe, infos de session
 *
 * Les utilisateurs admin voient un encart pointant vers la page Admin dédiée.
 */
import { useState } from 'react';
import { User, Crown, Lock, Shield } from 'lucide-react';
import { useAuth } from '../lib/auth';
import { AccountOverview } from './account/AccountOverview';
import { AccountPremium }  from './account/AccountPremium';
import { AccountSecurity } from './account/AccountSecurity';

type SubId = 'overview' | 'premium' | 'security';

const SUB_TABS: { id: SubId; label: string; icon: any; Component: React.ComponentType; description: string }[] = [
  { id: 'overview', label: 'Aperçu',   icon: User,  Component: AccountOverview, description: 'Identité, quota du jour et activité récente.' },
  { id: 'premium',  label: 'Premium',  icon: Crown, Component: AccountPremium,  description: 'Activer une clé et débloquer 100 requêtes/jour.' },
  { id: 'security', label: 'Sécurité', icon: Lock,  Component: AccountSecurity, description: 'Mot de passe et gestion de la session.' },
];

export function AccountPage() {
  const { user } = useAuth();
  const [sub, setSub] = useState<SubId>('overview');

  if (!user) return null;
  const activeSub = SUB_TABS.find(t => t.id === sub) || SUB_TABS[0];
  const Active    = activeSub.Component;

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="aegis-card aegis-card-edge p-6 relative overflow-hidden">
        <div className="absolute -top-12 -right-12 w-52 h-52 rounded-full bg-gradient-to-br from-indigo-500/20 to-violet-500/0 blur-3xl pointer-events-none" />
        <div className="flex items-start gap-4 relative">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-indigo-500/30 to-violet-500/10 ring-1 ring-indigo-500/40 flex items-center justify-center flex-shrink-0">
            <User className="w-6 h-6 text-indigo-300" />
          </div>
          <div className="flex-1 min-w-0">
            <h1 className="text-2xl font-bold tracking-tight">Mon compte</h1>
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

      {/* Admin pointer (kept on every sub-tab to remind admins) */}
      {user.is_admin && (
        <div className="aegis-card aegis-card-edge p-4 border-amber-500/20 bg-gradient-to-br from-amber-500/[0.04] to-transparent">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-amber-500/15 ring-1 ring-amber-500/40 flex items-center justify-center flex-shrink-0">
              <Shield className="w-5 h-5 text-amber-400" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold">Tu es administrateur</p>
              <p className="text-xs text-muted-foreground">Génération des clés et gestion des comptes dans l'onglet <strong className="text-amber-400">Admin</strong>.</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
