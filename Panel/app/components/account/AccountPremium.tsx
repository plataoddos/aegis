/**
 * Sous-page "Premium" — activation d'une clé et résumé des avantages.
 */
import { useState } from 'react';
import { KeyRound, Crown, Loader2, Sparkles, Check, Zap, Database, Layers } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '../../lib/auth';
import { ApiError } from '../../lib/api';
import { daysLeft, fmtDate } from './accountShared';

export function AccountPremium() {
  const { user, redeem, refresh } = useAuth();
  const [key, setKey] = useState('');
  const [loading, setLoading] = useState(false);

  if (!user) return null;
  const dl = daysLeft(user.premium_until);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!key.trim()) return toast.error('Entre une clé premium');
    setLoading(true);
    try {
      const r = await redeem(key.trim());
      const left = daysLeft(r.premium_until) ?? r.days;
      toast.success(`Premium activé · +${r.days} jour${r.days > 1 ? 's' : ''}`,
        { description: `Total restant : ~${left} jour${left > 1 ? 's' : ''}` });
      setKey('');
      await refresh();
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : (e as Error).message;
      toast.error('Activation impossible', { description: msg });
    } finally { setLoading(false); }
  };

  return (
    <div className="space-y-5">
      {/* Status hero */}
      <div className={`aegis-card aegis-card-edge p-6 relative overflow-hidden ${user.premium ? '' : 'opacity-95'}`}>
        <div className="absolute -top-12 -right-12 w-52 h-52 rounded-full bg-gradient-to-br from-violet-500/30 to-fuchsia-500/0 blur-3xl pointer-events-none" />
        <div className="relative flex items-center gap-4">
          <div className={`w-14 h-14 rounded-xl flex items-center justify-center flex-shrink-0 ring-1 ${
            user.premium
              ? 'bg-gradient-to-br from-violet-500/30 to-fuchsia-500/10 ring-violet-500/40 text-violet-200'
              : 'bg-gradient-to-br from-zinc-500/20 to-zinc-500/0 ring-zinc-500/30 text-zinc-400'
          }`}>
            <Crown className="w-7 h-7" />
          </div>
          <div className="flex-1 min-w-0">
            {user.premium ? (
              <>
                <h2 className="text-xl font-bold text-violet-200">Premium actif</h2>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Encore <strong className="text-foreground">{dl ?? 0} jour{(dl ?? 0) > 1 ? 's' : ''}</strong>
                  {' '}· Expire le {fmtDate(user.premium_until)}
                </p>
              </>
            ) : (
              <>
                <h2 className="text-xl font-bold">Compte gratuit</h2>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Active une clé premium pour débloquer la totalité des fonctionnalités.
                </p>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Activation */}
      <div className="aegis-card aegis-card-edge p-6">
        <h3 className="text-sm font-semibold flex items-center gap-2 mb-3">
          <KeyRound className="w-4 h-4 text-violet-300" />
          Activer une clé
        </h3>
        <p className="text-xs text-muted-foreground mb-4">
          Une clé débloque <strong className="text-foreground">N&nbsp;jours</strong> de premium.
          {user.premium && ' Le temps s\'ajoute au premium en cours.'}
        </p>
        <form onSubmit={submit} className="flex flex-col sm:flex-row gap-2">
          <div className="relative flex-1">
            <KeyRound className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
            <input type="text" value={key} onChange={e => setKey(e.target.value)}
              placeholder="aegis_XXXXXXXXXXXXXXXXXXXXXXXX" disabled={loading}
              className="w-full bg-input/60 border border-border rounded-lg pl-10 pr-3 py-2.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-violet-500/40 focus:border-violet-500/40 disabled:opacity-50" />
          </div>
          <button type="submit" disabled={loading || !key.trim()}
            className="aegis-btn-primary text-primary-foreground px-5 py-2.5 rounded-lg text-sm font-semibold flex items-center justify-center gap-2 disabled:opacity-50">
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
            Activer
          </button>
        </form>
      </div>

      {/* Perks */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Perk icon={Zap}      tone="amber"   title="100 requêtes/jour"
              desc="20× la limite gratuite, suffisant pour des sessions longues." />
        <Perk icon={Database} tone="emerald" title="Cache 24 h"
              desc="Toutes les recherches récentes sont gratuites tant que le cache est chaud." />
        <Perk icon={Layers}   tone="violet"  title="Toutes les sources"
              desc="BrixHub, IP-lookup, et bientôt SeekNow & co. sans surcoût." />
      </div>
    </div>
  );
}

const TONES: Record<string, string> = {
  amber:   'from-amber-500/30 to-amber-500/0 ring-amber-500/40 text-amber-300',
  emerald: 'from-emerald-500/30 to-emerald-500/0 ring-emerald-500/40 text-emerald-300',
  violet:  'from-violet-500/30 to-violet-500/0 ring-violet-500/40 text-violet-300',
};

function Perk({ icon: Icon, tone, title, desc }: { icon: any; tone: keyof typeof TONES; title: string; desc: string }) {
  return (
    <div className="aegis-card aegis-card-edge p-4">
      <div className={`w-9 h-9 rounded-lg bg-gradient-to-br ring-1 flex items-center justify-center mb-2 ${TONES[tone]}`}>
        <Icon className="w-4 h-4" />
      </div>
      <h4 className="text-sm font-bold mb-0.5 flex items-center gap-1.5">
        <Check className="w-3 h-3 text-emerald-400" /> {title}
      </h4>
      <p className="text-[11px] text-muted-foreground leading-relaxed">{desc}</p>
    </div>
  );
}
