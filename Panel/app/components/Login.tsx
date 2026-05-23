import { useState } from 'react';
import { Key, AlertCircle, ArrowRight, ShieldCheck } from 'lucide-react';

interface LoginProps {
  onLogin: (key: string) => void;
}

export function Login({ onLogin }: LoginProps) {
  const [accessKey, setAccessKey] = useState('');
  const [error, setError]         = useState('');
  const [isShaking, setIsShaking] = useState(false);
  const [loading, setLoading]     = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    const fail = (msg: string) => {
      setError(msg);
      setIsShaking(true);
      setTimeout(() => setIsShaking(false), 400);
    };

    if (!accessKey.trim()) return fail("Veuillez entrer votre clé d'accès");

    const users = JSON.parse(localStorage.getItem('osint_users') || '[]');
    const user  = users.find((u: any) => u.key === accessKey);

    if (!user) return fail("Clé d'accès invalide");
    if (user.expiresAt && new Date(user.expiresAt) < new Date()) return fail('Votre accès a expiré');

    setLoading(true);
    setTimeout(() => onLogin(accessKey), 250);
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-6 relative overflow-hidden">
      {/* Ambient glow */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] rounded-full pointer-events-none"
        style={{ background: 'radial-gradient(circle, rgba(99,102,241,0.10) 0%, rgba(99,102,241,0.03) 35%, transparent 70%)' }} />
      {/* Subtle grid */}
      <div
        className="absolute inset-0 opacity-[0.025] pointer-events-none"
        style={{
          backgroundImage: 'linear-gradient(to right, #fff 1px, transparent 1px), linear-gradient(to bottom, #fff 1px, transparent 1px)',
          backgroundSize: '56px 56px',
        }}
      />

      <div className={`relative w-full max-w-sm aegis-fade-in ${isShaking ? 'animate-[aegis-shake_0.4s_ease-in-out]' : ''}`}>
        {/* Brand */}
        <div className="text-center mb-12">
          <img src="/aegis-logo.png" alt="Aegis" className="h-9 w-auto mx-auto mb-3 drop-shadow-[0_0_24px_rgba(99,102,241,0.35)]" />
          <p className="text-[11px] uppercase tracking-[0.25em] text-muted-foreground/70">Intelligence Platform</p>
        </div>

        {/* Card */}
        <div className="relative bg-card/70 backdrop-blur-xl border border-border rounded-2xl p-7 shadow-2xl shadow-black/50">
          {/* Top edge highlight */}
          <div className="absolute inset-x-0 -top-px h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent" />

          <div className="mb-6">
            <h2 className="text-foreground font-semibold text-lg">Connexion</h2>
            <p className="text-muted-foreground text-sm mt-1">Entrez votre clé d'accès pour continuer</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="key" className="block mb-2 text-xs text-muted-foreground font-medium uppercase tracking-wider">Clé d'accès</label>
              <div className="relative group">
                <Key className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none transition-colors group-focus-within:text-primary" />
                <input
                  id="key"
                  type="password"
                  value={accessKey}
                  onChange={(e) => setAccessKey(e.target.value)}
                  placeholder="XXXX-XXXX-XXXX-XXXX-XXXX-XXXX"
                  autoFocus
                  disabled={loading}
                  className="w-full bg-input/60 border border-border rounded-lg pl-10 pr-4 py-2.5 text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/50 text-sm font-mono transition-all disabled:opacity-50"
                />
              </div>
            </div>

            {error && (
              <div className="flex items-center gap-2 bg-destructive/10 border border-destructive/30 rounded-lg px-3 py-2.5 aegis-fade-in">
                <AlertCircle className="w-4 h-4 text-destructive flex-shrink-0" />
                <p className="text-sm text-destructive">{error}</p>
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="group w-full bg-primary hover:bg-primary/90 disabled:opacity-60 text-primary-foreground font-medium rounded-lg py-2.5 transition-all flex items-center justify-center gap-2 text-sm shadow-lg shadow-primary/20 hover:shadow-primary/40"
            >
              {loading ? (
                <>
                  <span className="w-4 h-4 rounded-full border-2 border-primary-foreground/30 border-t-primary-foreground animate-spin" />
                  Connexion…
                </>
              ) : (
                <>
                  Se connecter
                  <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-0.5" />
                </>
              )}
            </button>
          </form>

          {/* Security badge */}
          <div className="mt-6 pt-5 border-t border-border/60 flex items-center justify-center gap-2 text-[11px] text-muted-foreground/70">
            <ShieldCheck className="w-3.5 h-3.5" />
            Authentification chiffrée
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
