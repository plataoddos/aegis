/**
 * Contact page — page dédiée, plus visuelle, qui affiche le canal de contact
 * officiel (Session). Pensée pour être un point d'entrée clair quand un
 * utilisateur a besoin d'aide ou veut nous joindre.
 */
import { useState } from 'react';
import {
  MessageSquare, Copy, Check, Sparkles, ExternalLink,
} from 'lucide-react';
import { toast } from 'sonner';

const SESSION_ID =
  '056eed2a971ede8f4feb7464ab52430cd5260872e8dd0bff336caa7cd303837238';

export function ContactPage() {
  const [copied, setCopied] = useState(false);

  const copy = () => {
    navigator.clipboard.writeText(SESSION_ID);
    setCopied(true);
    toast.success('Session ID copié');
    setTimeout(() => setCopied(false), 1600);
  };

  return (
    <div className="space-y-6">
      {/* Page header — style identique à "Mon compte" */}
      <div className="aegis-card aegis-card-edge p-6 relative overflow-hidden">
        <div className="absolute -top-12 -right-12 w-52 h-52 rounded-full bg-gradient-to-br from-emerald-500/20 to-cyan-500/0 blur-3xl pointer-events-none" />
        <div className="flex items-start gap-4 relative">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-emerald-500/30 to-cyan-500/10 ring-1 ring-emerald-500/40 flex items-center justify-center flex-shrink-0">
            <MessageSquare className="w-6 h-6 text-emerald-300" />
          </div>
          <div className="flex-1 min-w-0">
            <h1 className="text-2xl font-bold tracking-tight">Contact</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              Pour toute demande, contacte-nous via Session — messagerie chiffrée de bout-en-bout.
            </p>
          </div>
        </div>
      </div>

      {/* Session ID card */}
      <div className="aegis-card aegis-card-edge p-6">
        <div className="flex items-center gap-2 mb-4">
          <span className="text-[10px] uppercase tracking-wider text-emerald-300/80 font-bold">
            Canal officiel
          </span>
          <span className="h-px flex-1 bg-gradient-to-r from-emerald-500/30 to-transparent" />
        </div>

        <div className="flex flex-col md:flex-row items-start md:items-center gap-4">
          <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-emerald-500/20 to-emerald-500/0 ring-1 ring-emerald-500/30 flex items-center justify-center flex-shrink-0">
            <img
              src="https://getsession.org/favicon.ico"
              alt=""
              className="w-7 h-7 opacity-90"
              onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
            />
          </div>
          <div className="flex-1 min-w-0 w-full">
            <p className="text-xs uppercase tracking-wider text-muted-foreground/70 font-semibold mb-1">
              Session ID
            </p>
            <code className="block text-sm text-emerald-300 font-mono break-all bg-black/40 border border-emerald-500/20 rounded-lg px-4 py-3 leading-relaxed">
              {SESSION_ID}
            </code>
          </div>
          <div className="flex flex-row md:flex-col gap-2 w-full md:w-auto">
            <button onClick={copy}
              className="aegis-btn-primary text-primary-foreground px-4 py-2.5 rounded-lg text-sm font-semibold flex items-center justify-center gap-2 flex-1 md:flex-none">
              {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
              {copied ? 'Copié' : 'Copier l\'ID'}
            </button>
            <a href="https://getsession.org/download"
               target="_blank" rel="noopener noreferrer"
               className="border border-white/10 hover:bg-white/5 hover:border-emerald-500/40 text-muted-foreground hover:text-emerald-300 px-4 py-2.5 rounded-lg text-sm flex items-center justify-center gap-2 transition-all flex-1 md:flex-none">
              <ExternalLink className="w-4 h-4" />
              Télécharger Session
            </a>
          </div>
        </div>
      </div>

      {/* How-to */}
      <div className="aegis-card aegis-card-edge p-6">
        <div className="flex items-center gap-2 mb-4">
          <Sparkles className="w-4 h-4 text-amber-300" />
          <h2 className="text-sm font-bold tracking-tight">Comment nous joindre</h2>
        </div>
        <ol className="space-y-3">
          <Step n={1} title="Installe Session"
                desc={<>Disponible gratuitement sur <a href="https://getsession.org/download" target="_blank" rel="noopener noreferrer" className="text-emerald-300 hover:text-emerald-200 underline-offset-2 hover:underline">getsession.org</a> — Windows, macOS, Linux, iOS, Android.</>} />
          <Step n={2} title="Crée ta Session ID"
                desc="Au premier lancement, l'app génère une ID anonyme. Sauvegarde la phrase mnémonique." />
          <Step n={3} title="Ajoute notre ID"
                desc={<>Dans Session, ouvre une nouvelle conversation et colle notre ID (bouton <em>Copier</em> ci-dessus).</>} />
          <Step n={4} title="Envoie ton message"
                desc="Précise ton pseudo Aegis, le module concerné, et joins une capture si possible." />
        </ol>
      </div>
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────
function Step({ n, title, desc }: { n: number; title: string; desc: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <div className="w-7 h-7 rounded-lg bg-indigo-500/15 ring-1 ring-indigo-500/30 flex items-center justify-center text-xs font-bold text-indigo-300 flex-shrink-0">
        {n}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-foreground">{title}</p>
        <p className="text-xs text-muted-foreground mt-0.5">{desc}</p>
      </div>
    </li>
  );
}
