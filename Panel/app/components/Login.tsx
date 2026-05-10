import { useState } from 'react';
import { Key, AlertCircle, ArrowRight } from 'lucide-react';

interface LoginProps {
  onLogin: (key: string) => void;
}

export function Login({ onLogin }: LoginProps) {
  const [accessKey, setAccessKey] = useState('');
  const [error, setError]         = useState('');
  const [isShaking, setIsShaking] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    const fail = (msg: string) => {
      setError(msg);
      setIsShaking(true);
      setTimeout(() => setIsShaking(false), 400);
    };

    if (!accessKey.trim()) return fail('Veuillez entrer votre clé d\'accès');

    const users = JSON.parse(localStorage.getItem('osint_users') || '[]');
    const user  = users.find((u: any) => u.key === accessKey);

    if (!user) return fail('Clé d\'accès invalide');
    if (user.expiresAt && new Date(user.expiresAt) < new Date()) return fail('Votre accès a expiré');

    onLogin(accessKey);
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-6 relative overflow-hidden">
      {/* Grid backdrop */}
      <div
        className="absolute inset-0 opacity-[0.04] pointer-events-none"
        style={{
          backgroundImage: 'linear-gradient(to right, #fff 1px, transparent 1px), linear-gradient(to bottom, #fff 1px, transparent 1px)',
          backgroundSize: '48px 48px',
        }}
      />
      {/* Soft radial highlight */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[700px] h-[700px] bg-white/[0.03] rounded-full blur-3xl pointer-events-none" />

      <div className={`relative w-full max-w-sm transition-transform ${isShaking ? 'animate-[shake_0.4s_ease-in-out]' : ''}`}>
        {/* Brand */}
        <div className="text-center mb-10">
          <img src="/nt3xnb.png" alt="NET.X" className="h-12 w-auto mx-auto" />
        </div>

        {/* Card */}
        <div className="bg-card border border-border rounded-xl p-7 shadow-2xl shadow-black/40">
          <div className="mb-6">
            <h2 className="text-foreground font-semibold text-lg">Connexion</h2>
            <p className="text-muted-foreground text-sm mt-1">Entrez votre clé d'accès pour continuer</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="key" className="block mb-2 text-sm text-foreground font-medium">Clé d'accès</label>
              <div className="relative">
                <Key className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
                <input
                  id="key"
                  type="password"
                  value={accessKey}
                  onChange={(e) => setAccessKey(e.target.value)}
                  placeholder="XXXX-XXXX-XXXX-XXXX-XXXX-XXXX"
                  autoFocus
                  className="w-full bg-input border border-border rounded-lg pl-9 pr-4 py-2.5 text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-1 focus:ring-ring focus:border-ring text-sm font-mono transition-all"
                />
              </div>
            </div>

            {error && (
              <div className="flex items-center gap-2 bg-destructive/10 border border-destructive/30 rounded-lg px-3 py-2.5">
                <AlertCircle className="w-4 h-4 text-destructive flex-shrink-0" />
                <p className="text-sm text-destructive">{error}</p>
              </div>
            )}

            <button
              type="submit"
              className="group w-full bg-primary hover:bg-primary/90 text-primary-foreground font-medium rounded-lg py-2.5 transition-all flex items-center justify-center gap-2 text-sm"
            >
              Se connecter
              <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-0.5" />
            </button>
          </form>
        </div>
      </div>

      <style>{`
        @keyframes shake {
          0%, 100% { transform: translateX(0); }
          25% { transform: translateX(-6px); }
          75% { transform: translateX(6px); }
        }
      `}</style>
    </div>
  );
}
