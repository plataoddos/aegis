/**
 * Sous-page "Aperçu" du compte : identité, quota, et un résumé rapide.
 */
import { Crown, Shield, Zap, RefreshCw, Activity, Clock, LogOut } from 'lucide-react';
import { useAuth } from '../../lib/auth';
import { fmtDate, daysLeft } from './accountShared';

export function AccountOverview() {
  const { user, refresh, logout } = useAuth();
  if (!user) return null;
  const { used, limit, tier } = user.quota;
  const pct = Math.min(100, (used / Math.max(1, limit)) * 100);
  const dl  = daysLeft(user.premium_until);

  return (
    <div className="space-y-5">
      {/* Identity */}
      <div className="aegis-card aegis-card-edge p-6 relative overflow-hidden">
        <div className="absolute -top-10 -right-10 w-48 h-48 rounded-full bg-gradient-to-br from-primary/20 to-violet-500/0 blur-3xl pointer-events-none" />
        <div className="flex items-start gap-4 relative">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-indigo-500/30 to-violet-500/10 ring-1 ring-indigo-500/40 flex items-center justify-center text-2xl font-bold text-indigo-200 flex-shrink-0">
            {user.username.slice(0, 1).toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-xl font-bold tracking-tight">{user.username}</h2>
              {user.is_admin && (
                <span className="text-[10px] uppercase tracking-wider bg-amber-500/15 text-amber-400 ring-1 ring-amber-500/30 rounded px-1.5 py-0.5 font-bold flex items-center gap-1">
                  <Shield className="w-3 h-3" /> Admin
                </span>
              )}
              {user.premium ? (
                <span className="text-[10px] uppercase tracking-wider bg-violet-500/15 text-violet-300 ring-1 ring-violet-500/30 rounded px-1.5 py-0.5 font-bold flex items-center gap-1">
                  <Crown className="w-3 h-3" /> Premium
                </span>
              ) : (
                <span className="text-[10px] uppercase tracking-wider bg-zinc-500/15 text-zinc-400 ring-1 ring-zinc-500/30 rounded px-1.5 py-0.5 font-bold">
                  Free
                </span>
              )}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Compte créé le {fmtDate(user.created_at)} · Dernière connexion {fmtDate(user.last_login_at)}
            </p>
          </div>
          <button onClick={logout}
            className="flex items-center gap-1.5 text-xs px-3 py-2 border border-rose-500/30 text-rose-400 hover:bg-rose-500/10 rounded-lg transition-all">
            <LogOut className="w-3.5 h-3.5" /> Déconnexion
          </button>
        </div>
      </div>

      {/* KPI grid */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="aegis-card aegis-card-edge p-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold flex items-center gap-2">
              <Zap className="w-4 h-4 text-amber-400" />
              Quota du jour
            </h3>
            <button onClick={() => refresh()} title="Rafraîchir"
              className="text-muted-foreground hover:text-foreground transition-colors">
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
          </div>
          <div className="flex items-baseline gap-2 mb-2">
            <span className="text-3xl font-bold tabular-nums">{used}</span>
            <span className="text-sm text-muted-foreground">/ {limit}</span>
          </div>
          <div className="h-1.5 rounded-full bg-white/5 overflow-hidden">
            <div className={`h-full transition-all ${
              pct > 90 ? 'bg-rose-500' : pct > 70 ? 'bg-amber-500' : 'bg-emerald-500'
            }`} style={{ width: `${pct}%` }} />
          </div>
          <p className="text-[11px] text-muted-foreground mt-2">Reset à minuit UTC.</p>
        </div>

        <div className="aegis-card aegis-card-edge p-5">
          <h3 className="text-sm font-semibold flex items-center gap-2 mb-3">
            <Crown className="w-4 h-4 text-violet-400" />
            Tier
          </h3>
          <div className="flex items-baseline gap-2 mb-1">
            <span className={`text-2xl font-bold ${tier === 'premium' ? 'text-violet-300' : 'text-zinc-400'}`}>
              {tier === 'premium' ? 'Premium' : 'Gratuit'}
            </span>
          </div>
          <p className="text-[11px] text-muted-foreground">
            {tier === 'premium' && dl != null && dl > 0
              ? `Encore ${dl} jour${dl > 1 ? 's' : ''} de premium.`
              : 'Active une clé premium pour débloquer 100 requêtes/jour.'}
          </p>
        </div>

        <div className="aegis-card aegis-card-edge p-5">
          <h3 className="text-sm font-semibold flex items-center gap-2 mb-3">
            <Activity className="w-4 h-4 text-cyan-400" />
            Activité
          </h3>
          <div className="space-y-1.5 text-xs">
            <div className="flex items-center gap-2 text-muted-foreground">
              <Clock className="w-3 h-3" />
              <span>Inscrit le <span className="text-foreground">{fmtDate(user.created_at)}</span></span>
            </div>
            <div className="flex items-center gap-2 text-muted-foreground">
              <Clock className="w-3 h-3" />
              <span>Dernière session <span className="text-foreground">{fmtDate(user.last_login_at)}</span></span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
