/**
 * Sous-page "Sécurité" — changement de mot de passe + résumé de la session.
 */
import { useState } from 'react';
import { Lock, Loader2, Check, ShieldCheck, LogOut, Clock } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '../../lib/auth';
import { fmtDate } from './accountShared';

export function AccountSecurity() {
  const { user, changePassword, logout } = useAuth();
  const [current, setCurrent] = useState('');
  const [next,    setNext]    = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);

  if (!user) return null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!current || !next) return toast.error('Tous les champs sont requis');
    if (next.length < 10)  return toast.error('Le nouveau mot de passe doit faire au moins 10 caractères');
    if (next !== confirm)  return toast.error('Les mots de passe ne correspondent pas');
    setLoading(true);
    try {
      await changePassword(current, next);
      toast.success('Mot de passe changé');
      setCurrent(''); setNext(''); setConfirm('');
    } catch (e) {
      toast.error((e as Error).message);
    } finally { setLoading(false); }
  };

  return (
    <div className="space-y-5">
      {/* Change password */}
      <div className="aegis-card aegis-card-edge p-6">
        <div className="flex items-center gap-2 mb-4">
          <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-cyan-500/20 to-cyan-500/0 ring-1 ring-cyan-500/30 flex items-center justify-center">
            <Lock className="w-4 h-4 text-cyan-300" />
          </div>
          <div>
            <h3 className="text-sm font-bold">Mot de passe</h3>
            <p className="text-[11px] text-muted-foreground">Au moins 10 caractères, mélangeant majuscules, minuscules, chiffres et symboles.</p>
          </div>
        </div>
        <form onSubmit={submit} className="grid grid-cols-1 md:grid-cols-3 gap-2">
          <input type="password" placeholder="Mot de passe actuel" value={current} onChange={e => setCurrent(e.target.value)}
            autoComplete="current-password" disabled={loading}
            className="bg-input/60 border border-border rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500/40 focus:border-cyan-500/40 disabled:opacity-50" />
          <input type="password" placeholder="Nouveau mot de passe" value={next} onChange={e => setNext(e.target.value)}
            autoComplete="new-password" disabled={loading}
            className="bg-input/60 border border-border rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500/40 focus:border-cyan-500/40 disabled:opacity-50" />
          <input type="password" placeholder="Confirmer" value={confirm} onChange={e => setConfirm(e.target.value)}
            autoComplete="new-password" disabled={loading}
            className="bg-input/60 border border-border rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500/40 focus:border-cyan-500/40 disabled:opacity-50" />
          <div className="md:col-span-3 flex justify-end">
            <button type="submit" disabled={loading}
              className="aegis-btn-primary text-primary-foreground px-4 py-2 rounded-lg text-sm font-semibold flex items-center gap-2 disabled:opacity-50">
              {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
              Modifier
            </button>
          </div>
        </form>
      </div>

      {/* Session info */}
      <div className="aegis-card aegis-card-edge p-6">
        <div className="flex items-center gap-2 mb-4">
          <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-emerald-500/20 to-emerald-500/0 ring-1 ring-emerald-500/30 flex items-center justify-center">
            <ShieldCheck className="w-4 h-4 text-emerald-300" />
          </div>
          <div>
            <h3 className="text-sm font-bold">Session</h3>
            <p className="text-[11px] text-muted-foreground">Bearer token chiffré, durée de vie 24 h, renouvelé à chaque login.</p>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
          <Info icon={Clock} label="Compte créé"      value={fmtDate(user.created_at)} />
          <Info icon={Clock} label="Dernière session" value={fmtDate(user.last_login_at)} />
        </div>

        <button onClick={logout}
          className="flex items-center gap-1.5 text-xs px-3 py-2 border border-rose-500/30 text-rose-400 hover:bg-rose-500/10 rounded-lg transition-all">
          <LogOut className="w-3.5 h-3.5" /> Se déconnecter de cet appareil
        </button>
      </div>
    </div>
  );
}

function Info({ icon: Icon, label, value }: { icon: any; label: string; value: string }) {
  return (
    <div className="bg-black/30 border border-white/5 rounded-lg px-3 py-2.5 flex items-center gap-3">
      <Icon className="w-4 h-4 text-muted-foreground flex-shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground/70 font-semibold">{label}</p>
        <p className="text-sm text-foreground truncate">{value}</p>
      </div>
    </div>
  );
}
