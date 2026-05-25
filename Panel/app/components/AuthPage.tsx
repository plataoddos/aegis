/**
 * Authentication entry point: combined login + signup form.
 *
 * The first user created by /api/auth/signup is automatically promoted to
 * admin (see backend auth.ts), so the very first signup gets management
 * powers without any extra setup.
 */
import { useState } from 'react';
import { User, Lock, AlertCircle, ArrowRight, ShieldCheck, UserPlus, LogIn } from 'lucide-react';
import { useAuth } from '../lib/auth';
import { ApiError } from '../lib/api';

type Mode = 'login' | 'signup';

export function AuthPage() {
  const { login, signup } = useAuth();
  const [mode, setMode]         = useState<Mode>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirm,  setConfirm]  = useState('');
  const [error, setError]       = useState('');
  const [loading, setLoading]   = useState(false);
  const [shake, setShake]       = useState(false);

  const fail = (msg: string) => {
    setError(msg);
    setShake(true);
    setTimeout(() => setShake(false), 400);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!username.trim()) return fail('Nom d\'utilisateur requis');
    if (!password)        return fail('Mot de passe requis');
    if (mode === 'signup') {
      if (password.length < 10)    return fail('Mot de passe trop court (10 caractères min)');
      if (password !== confirm)    return fail('Les mots de passe ne correspondent pas');
    }

    setLoading(true);
    try {
      if (mode === 'login') await login(username.trim(), password);
      else                  await signup(username.trim(), password);
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : (e as Error).message || 'Erreur';
      fail(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-6 relative overflow-hidden">
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] rounded-full pointer-events-none"
        style={{ background: 'radial-gradient(circle, rgba(99,102,241,0.10) 0%, rgba(99,102,241,0.03) 35%, transparent 70%)' }} />
      <div className="absolute inset-0 opacity-[0.025] pointer-events-none"
        style={{
          backgroundImage: 'linear-gradient(to right, #fff 1px, transparent 1px), linear-gradient(to bottom, #fff 1px, transparent 1px)',
          backgroundSize: '56px 56px',
        }} />

      <div className={`relative w-full max-w-sm aegis-fade-in ${shake ? 'animate-[aegis-shake_0.4s_ease-in-out]' : ''}`}>
        <div className="text-center mb-12">
          <img src="/logo-plat-nb.png" alt="Aegis"
            className="h-12 w-auto mx-auto drop-shadow-[0_0_24px_rgba(99,102,241,0.35)]" />
          <p className="text-[11px] uppercase tracking-[0.25em] text-muted-foreground/70 mt-3">Intelligence Platform</p>
        </div>

        <div className="relative bg-card/70 backdrop-blur-xl border border-border rounded-2xl p-7 shadow-2xl shadow-black/50">
          <div className="absolute inset-x-0 -top-px h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent" />

          {/* Tabs */}
          <div className="flex gap-1 mb-6 p-1 bg-black/30 rounded-lg border border-white/5">
            {(['login', 'signup'] as Mode[]).map(m => (
              <button key={m} type="button" onClick={() => { setMode(m); setError(''); }}
                className={`flex-1 py-1.5 rounded text-xs font-semibold uppercase tracking-wider transition-all flex items-center justify-center gap-1.5 ${
                  mode === m
                    ? 'bg-primary/20 text-primary ring-1 ring-primary/30'
                    : 'text-muted-foreground hover:text-foreground'
                }`}>
                {m === 'login' ? <LogIn className="w-3 h-3" /> : <UserPlus className="w-3 h-3" />}
                {m === 'login' ? 'Connexion' : 'Inscription'}
              </button>
            ))}
          </div>

          <form onSubmit={submit} className="space-y-3">
            <div>
              <label className="block mb-1.5 text-xs text-muted-foreground font-medium uppercase tracking-wider">Nom d'utilisateur</label>
              <div className="relative group">
                <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none transition-colors group-focus-within:text-primary" />
                <input
                  type="text"
                  value={username}
                  onChange={e => setUsername(e.target.value)}
                  placeholder="johndoe"
                  autoFocus
                  autoComplete="username"
                  disabled={loading}
                  className="w-full bg-input/60 border border-border rounded-lg pl-10 pr-4 py-2.5 text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/50 text-sm transition-all disabled:opacity-50"
                />
              </div>
            </div>

            <div>
              <label className="block mb-1.5 text-xs text-muted-foreground font-medium uppercase tracking-wider">Mot de passe</label>
              <div className="relative group">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none transition-colors group-focus-within:text-primary" />
                <input
                  type="password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="••••••••"
                  autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                  disabled={loading}
                  className="w-full bg-input/60 border border-border rounded-lg pl-10 pr-4 py-2.5 text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/50 text-sm transition-all disabled:opacity-50"
                />
              </div>
            </div>

            {mode === 'signup' && (
              <div>
                <label className="block mb-1.5 text-xs text-muted-foreground font-medium uppercase tracking-wider">Confirmer le mot de passe</label>
                <div className="relative group">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none transition-colors group-focus-within:text-primary" />
                  <input
                    type="password"
                    value={confirm}
                    onChange={e => setConfirm(e.target.value)}
                    placeholder="••••••••"
                    autoComplete="new-password"
                    disabled={loading}
                    className="w-full bg-input/60 border border-border rounded-lg pl-10 pr-4 py-2.5 text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/50 text-sm transition-all disabled:opacity-50"
                  />
                </div>
              </div>
            )}

            {error && (
              <div className="flex items-center gap-2 bg-destructive/10 border border-destructive/30 rounded-lg px-3 py-2.5 aegis-fade-in">
                <AlertCircle className="w-4 h-4 text-destructive flex-shrink-0" />
                <p className="text-sm text-destructive">{error}</p>
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="group w-full bg-primary hover:bg-primary/90 disabled:opacity-60 text-primary-foreground font-medium rounded-lg py-2.5 transition-all flex items-center justify-center gap-2 text-sm shadow-lg shadow-primary/20 hover:shadow-primary/40 mt-2"
            >
              {loading ? (
                <>
                  <span className="w-4 h-4 rounded-full border-2 border-primary-foreground/30 border-t-primary-foreground animate-spin" />
                  {mode === 'login' ? 'Connexion…' : 'Création…'}
                </>
              ) : (
                <>
                  {mode === 'login' ? 'Se connecter' : 'Créer le compte'}
                  <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-0.5" />
                </>
              )}
            </button>
          </form>

          <div className="mt-6 pt-5 border-t border-border/60 flex items-center justify-center gap-2 text-[11px] text-muted-foreground/70">
            <ShieldCheck className="w-3.5 h-3.5" />
            {mode === 'signup'
              ? '5 recherches gratuites par jour · clé premium pour 100 req/j'
              : 'Sessions sécurisées · scrypt + bearer 24 h'}
          </div>
        </div>

        <p className="text-center text-[11px] text-muted-foreground/40 mt-6">
          © {new Date().getFullYear()} Aegis · Tous droits réservés
        </p>
      </div>

      <style>{`
        @keyframes aegis-shake {
          0%, 100% { transform: translateX(0); }
          25% { transform: translateX(-6px); }
          75% { transform: translateX(6px); }
        }
      `}</style>
    </div>
  );
}
