import { useState, useEffect } from 'react';
import {
  LogOut, Globe, Hash, Settings, FileJson, Wifi, MessageSquare, Code2,
  ShieldAlert, Eye, Users, Search, Telescope, ArrowLeft, ArrowUpRight,
  Sparkles,
} from 'lucide-react';
import { XEyesImport } from './XEyesImport';
import { ReseauTool } from './ReseauTool';
import { WebTool } from './WebTool';
import { CryptoTool } from './CryptoTool';
import { VulnTool } from './VulnTool';
import { DiscordTool } from './DiscordTool';
import { DomaineTool } from './DomaineTool';
import { WatcherTool } from './WatcherTool';
import { PersonsTool } from './PersonsTool';
import { SeekTool } from './SeekTool';

interface DashboardProps {
  userKey: string;
  onLogout: () => void;
  onAdminAccess: () => void;
  isAdmin?: boolean;
}

type Tone = 'indigo' | 'emerald' | 'amber' | 'rose' | 'sky' | 'violet' | 'cyan';

interface Module {
  id: string;
  name: string;
  description: string;
  icon: any;
  tone: Tone;
  badge?: string;
  badgeTone?: 'live' | 'pro' | 'api';
  Component: React.ComponentType;
  group: 'recon' | 'people' | 'utils';
  /** Headline featured on the home grid */
  tagline?: string;
}

const MODULES: Module[] = [
  // ── Reconnaissance & infra
  { id: 'domaine', group: 'recon', tone: 'sky',     name: 'Domaine',         icon: Globe,         description: 'IP, DNS, WHOIS, sous-domaines, reverse DNS',                 tagline: 'Cartographie réseau & infrastructure',     Component: DomaineTool },
  { id: 'reseau',  group: 'recon', tone: 'cyan',    name: 'Réseau',          icon: Wifi,          description: 'Ping, scan de ports, traceroute, SSL/TLS',                   tagline: 'Diagnostic temps réel des hôtes',          Component: ReseauTool },
  { id: 'web',     group: 'recon', tone: 'violet',  name: 'Web',             icon: Code2,         description: 'En-têtes, technologies, WAF, redirections',                  tagline: 'Empreinte technologique des sites',        Component: WebTool },
  { id: 'vuln',    group: 'recon', tone: 'rose',    name: 'Vulnérabilités',  icon: ShieldAlert,   description: 'Recherche CVE, Shodan InternetDB',                           tagline: 'Veille CVE et exposition publique',        Component: VulnTool },
  // ── People intelligence
  { id: 'fiches',  group: 'people', tone: 'indigo', name: 'Fiches',          icon: Users,         description: 'Identité, contact, allocataire, IBAN',                      tagline: 'Base de personnes structurée',             Component: PersonsTool },
  { id: 'seek',    group: 'people', tone: 'violet', name: 'Seek',            icon: Telescope,     description: 'Recherche multi-source via see-know.eu',                    tagline: '70+ sources, cache 24h, proxy sécurisé',   badge: 'API',  badgeTone: 'api',  Component: SeekTool },
  { id: 'discord', group: 'people', tone: 'sky',    name: 'Discord',         icon: MessageSquare, description: 'Snowflake, token, invitation, webhook, profil',             tagline: 'Décodage et profilage Discord',            Component: DiscordTool },
  { id: 'watcher', group: 'people', tone: 'emerald',name: 'Discord Watcher', icon: Eye,           description: 'Surveillance temps réel multi-tokens',                      tagline: 'Pool selfbot, push WS, événements live',   badge: 'LIVE', badgeTone: 'live', Component: WatcherTool },
  // ── Utilitaires
  { id: 'crypto',  group: 'utils',  tone: 'amber',  name: 'Crypto',          icon: Hash,          description: 'Hachage, encodage, mots de passe, JWT',                     tagline: 'Couteau-suisse cryptographique',           Component: CryptoTool },
  { id: 'xeyes',   group: 'utils',  tone: 'rose',   name: 'Import xEyes',    icon: FileJson,      description: 'Import et consolidation de rapports JSON',                  tagline: 'Fusion intelligente de rapports',          badge: 'PRO',  badgeTone: 'pro',  Component: XEyesImport },
];

const GROUPS: { id: Module['group']; label: string; description: string }[] = [
  { id: 'recon',  label: 'Reconnaissance', description: 'Cartographie infrastructure & réseau' },
  { id: 'people', label: 'People Intel',   description: 'Recherche, surveillance et données personnelles' },
  { id: 'utils',  label: 'Utilitaires',    description: 'Outils transverses et import' },
];

const TONE_GRADIENTS: Record<Tone, { from: string; to: string; ring: string; glow: string; text: string }> = {
  indigo:  { from: 'from-indigo-500/20',  to: 'to-indigo-500/0',   ring: 'ring-indigo-500/40',  glow: 'group-hover:shadow-indigo-500/30',  text: 'text-indigo-400' },
  emerald: { from: 'from-emerald-500/20', to: 'to-emerald-500/0',  ring: 'ring-emerald-500/40', glow: 'group-hover:shadow-emerald-500/30', text: 'text-emerald-400' },
  amber:   { from: 'from-amber-500/20',   to: 'to-amber-500/0',    ring: 'ring-amber-500/40',   glow: 'group-hover:shadow-amber-500/30',   text: 'text-amber-400' },
  rose:    { from: 'from-rose-500/20',    to: 'to-rose-500/0',     ring: 'ring-rose-500/40',    glow: 'group-hover:shadow-rose-500/30',    text: 'text-rose-400' },
  sky:     { from: 'from-sky-500/20',     to: 'to-sky-500/0',      ring: 'ring-sky-500/40',     glow: 'group-hover:shadow-sky-500/30',     text: 'text-sky-400' },
  violet:  { from: 'from-violet-500/20',  to: 'to-violet-500/0',   ring: 'ring-violet-500/40',  glow: 'group-hover:shadow-violet-500/30',  text: 'text-violet-400' },
  cyan:    { from: 'from-cyan-500/20',    to: 'to-cyan-500/0',     ring: 'ring-cyan-500/40',    glow: 'group-hover:shadow-cyan-500/30',    text: 'text-cyan-400' },
};

function Badge({ tone, children }: { tone?: Module['badgeTone']; children: React.ReactNode }) {
  const map: Record<NonNullable<Module['badgeTone']>, string> = {
    live: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
    pro:  'bg-amber-500/15 text-amber-400 border-amber-500/30',
    api:  'bg-primary/15 text-primary border-primary/30',
  };
  return (
    <span className={`text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded border ${map[tone || 'api']}`}>
      {children}
    </span>
  );
}

export function Dashboard({ userKey, onLogout, onAdminAccess, isAdmin = false }: DashboardProps) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const [search, setSearch]     = useState('');

  const users       = JSON.parse(localStorage.getItem('osint_users') || '[]');
  const currentUser = users.find((u: any) => u.key === userKey);
  const username    = currentUser?.username || 'Utilisateur';
  const userInitial = username[0]?.toUpperCase() || '?';

  const active = activeId ? MODULES.find(m => m.id === activeId) || null : null;

  // ESC → retour à la home
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && activeId) {
        const target = e.target as HTMLElement;
        // Don't intercept if user is in an input/textarea
        if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return;
        setActiveId(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [activeId]);

  if (active) {
    const Active = active.Component;
    return (
      <div className="min-h-screen relative">
        <TopBar
          username={username}
          userInitial={userInitial}
          isAdmin={isAdmin}
          onLogout={onLogout}
          onAdminAccess={onAdminAccess}
          onHome={() => setActiveId(null)}
          breadcrumb={active}
        />

        <main className="max-w-7xl mx-auto px-6 lg:px-10 pt-8 pb-16">
          <div key={active.id} className="aegis-fade-in">
            <Active />
          </div>
        </main>
      </div>
    );
  }

  // ── HOME ──────────────────────────────────────────────────────────────────
  const q = search.trim().toLowerCase();
  const filtered = q
    ? MODULES.filter(m =>
        m.name.toLowerCase().includes(q) ||
        m.description.toLowerCase().includes(q) ||
        (m.tagline?.toLowerCase().includes(q) ?? false))
    : MODULES;

  return (
    <div className="min-h-screen relative">
      <TopBar
        username={username}
        userInitial={userInitial}
        isAdmin={isAdmin}
        onLogout={onLogout}
        onAdminAccess={onAdminAccess}
      />

      <main className="max-w-7xl mx-auto px-6 lg:px-10 pt-12 pb-16 aegis-fade-in">
        {/* Hero */}
        <section className="text-center mb-14">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-primary/20 bg-primary/5 mb-5">
            <Sparkles className="w-3 h-3 text-primary" />
            <span className="text-[11px] uppercase tracking-wider text-primary font-semibold">Intelligence Platform</span>
          </div>
          <h1 className="text-foreground text-4xl lg:text-5xl font-bold tracking-tight mb-3">
            Bienvenue, <span className="bg-gradient-to-r from-primary via-violet-400 to-primary bg-clip-text text-transparent">{username}</span>
          </h1>
          <p className="text-muted-foreground text-base max-w-xl mx-auto">
            Sélectionne un module pour commencer. Tous les outils Aegis sont disponibles ci-dessous.
          </p>

          {/* Search */}
          <div className="max-w-md mx-auto mt-8">
            <div className="relative group">
              <Search className="w-4 h-4 absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground transition-colors group-focus-within:text-primary" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Rechercher un module…"
                className="w-full bg-card/40 backdrop-blur-md border border-white/8 rounded-xl pl-11 pr-4 py-3 text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:border-primary/40 transition-all shadow-lg shadow-black/30"
              />
            </div>
          </div>
        </section>

        {/* Stats strip */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-12 max-w-3xl mx-auto">
          <MiniStat label="Modules"  value={MODULES.length}      tone="indigo" />
          <MiniStat label="Live"     value="✓ Online"             tone="emerald" pulse />
          <MiniStat label="Sources"  value="70+"                  tone="violet" />
          <MiniStat label="Cache"    value="24h"                  tone="sky" />
        </div>

        {/* Module groups */}
        {GROUPS.map(group => {
          const items = filtered.filter(m => m.group === group.id);
          if (items.length === 0) return null;
          return (
            <section key={group.id} className="mb-12 last:mb-0">
              <div className="flex items-end justify-between mb-5 px-1">
                <div>
                  <h2 className="text-foreground text-lg font-semibold tracking-tight">{group.label}</h2>
                  <p className="text-muted-foreground text-xs mt-0.5">{group.description}</p>
                </div>
                <span className="text-[11px] text-muted-foreground/70 tabular-nums">
                  {items.length} module{items.length > 1 ? 's' : ''}
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {items.map((m, i) => (
                  <ModuleCard key={m.id} module={m} index={i} onOpen={() => setActiveId(m.id)} />
                ))}
              </div>
            </section>
          );
        })}

        {filtered.length === 0 && (
          <div className="text-center py-20">
            <Search className="w-10 h-10 text-muted-foreground/30 mx-auto mb-3" />
            <p className="text-muted-foreground">Aucun module ne correspond à ta recherche.</p>
          </div>
        )}
      </main>
    </div>
  );
}

// ── Top bar (commune home + module) ─────────────────────────────────────────
interface TopBarProps {
  username: string;
  userInitial: string;
  isAdmin: boolean;
  onLogout: () => void;
  onAdminAccess: () => void;
  onHome?: () => void;
  breadcrumb?: Module;
}

function TopBar({ username, userInitial, isAdmin, onLogout, onAdminAccess, onHome, breadcrumb }: TopBarProps) {
  return (
    <header className="sticky top-0 z-30 border-b border-white/5 bg-background/60 backdrop-blur-xl">
      <div className="max-w-7xl mx-auto px-6 lg:px-10 h-16 flex items-center gap-4">
        {/* Brand or back */}
        {breadcrumb && onHome ? (
          <button
            onClick={onHome}
            className="group flex items-center gap-2 px-3 py-1.5 -ml-3 rounded-lg hover:bg-white/5 transition-colors"
          >
            <ArrowLeft className="w-4 h-4 text-muted-foreground group-hover:text-foreground transition-colors" />
            <span className="text-sm text-muted-foreground group-hover:text-foreground transition-colors">Accueil</span>
          </button>
        ) : (
          <div className="flex items-center gap-3">
            <img src="/aegis-logo.png" alt="Aegis" className="h-6 w-auto drop-shadow-[0_0_12px_rgba(99,102,241,0.45)]" />
          </div>
        )}

        {/* Breadcrumb to module */}
        {breadcrumb && (
          <>
            <span className="text-muted-foreground/30">/</span>
            <div className="flex items-center gap-2 min-w-0">
              <breadcrumb.icon className={`w-4 h-4 ${TONE_GRADIENTS[breadcrumb.tone].text} flex-shrink-0`} />
              <span className="text-sm text-foreground font-medium truncate">{breadcrumb.name}</span>
              {breadcrumb.badge && <Badge tone={breadcrumb.badgeTone}>{breadcrumb.badge}</Badge>}
            </div>
          </>
        )}

        {/* Right side */}
        <div className="ml-auto flex items-center gap-2">
          {/* Status pill */}
          <div className="hidden md:flex items-center gap-1.5 text-[11px] text-muted-foreground border border-white/8 bg-white/[0.02] rounded-full px-3 py-1.5">
            <span className="relative flex w-1.5 h-1.5">
              <span className="absolute inset-0 rounded-full bg-emerald-400 animate-ping opacity-50" />
              <span className="relative w-1.5 h-1.5 rounded-full bg-emerald-400" />
            </span>
            Opérationnel
          </div>

          {isAdmin && (
            <button
              onClick={onAdminAccess}
              title="Administration"
              className="p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-white/5 transition-colors"
            >
              <Settings className="w-4 h-4" />
            </button>
          )}

          {/* User */}
          <div className="flex items-center gap-2 pl-2 border-l border-white/8 ml-1">
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-primary to-violet-500 flex items-center justify-center text-white font-semibold text-xs ring-2 ring-primary/20 shadow-lg shadow-primary/30">
              {userInitial}
            </div>
            <div className="hidden sm:block text-right">
              <p className="text-foreground text-[13px] font-medium leading-tight">{username}</p>
              <p className="text-muted-foreground text-[10px] leading-tight">{isAdmin ? 'Administrateur' : 'Utilisateur'}</p>
            </div>
            <button
              onClick={onLogout}
              title="Déconnexion"
              className="p-2 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors ml-1"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </header>
  );
}

// ── Module card ─────────────────────────────────────────────────────────────
function ModuleCard({ module: m, index, onOpen }: { module: Module; index: number; onOpen: () => void }) {
  const Icon = m.icon;
  const t = TONE_GRADIENTS[m.tone];

  return (
    <button
      onClick={onOpen}
      style={{ animationDelay: `${index * 40}ms` }}
      className={`group relative aegis-card aegis-card-edge text-left p-5 transition-all duration-300 hover:-translate-y-1 hover:border-white/15 hover:shadow-2xl ${t.glow} aegis-fade-in`}
    >
      {/* Background gradient mesh on hover */}
      <div className={`absolute inset-0 rounded-[inherit] bg-gradient-to-br ${t.from} ${t.to} opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none`} />

      <div className="relative flex items-start gap-3 mb-3">
        <div className={`w-11 h-11 rounded-xl bg-gradient-to-br ${t.from} ${t.to} ring-1 ${t.ring} flex items-center justify-center flex-shrink-0 transition-transform group-hover:scale-110`}>
          <Icon className={`w-5 h-5 ${t.text}`} />
        </div>
        {m.badge && (
          <div className="ml-auto">
            <Badge tone={m.badgeTone}>{m.badge}</Badge>
          </div>
        )}
        <ArrowUpRight className={`w-4 h-4 text-muted-foreground/40 group-hover:text-foreground transition-all ${m.badge ? 'absolute top-0 right-0' : 'ml-auto'} group-hover:translate-x-0.5 group-hover:-translate-y-0.5`} />
      </div>

      <div className="relative">
        <h3 className="text-foreground font-semibold text-base mb-1 tracking-tight">{m.name}</h3>
        {m.tagline && <p className="text-foreground/70 text-xs mb-2">{m.tagline}</p>}
        <p className="text-muted-foreground text-[11px] leading-relaxed">{m.description}</p>
      </div>
    </button>
  );
}

// ── Mini stat ───────────────────────────────────────────────────────────────
function MiniStat({ label, value, tone, pulse }: { label: string; value: React.ReactNode; tone: Tone; pulse?: boolean }) {
  const t = TONE_GRADIENTS[tone];
  return (
    <div className="aegis-card aegis-card-edge p-3 flex items-center gap-3">
      <div className={`w-2 h-2 rounded-full bg-current ${t.text} ${pulse ? 'aegis-pulse' : ''}`} />
      <div className="min-w-0 flex-1">
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground/70 font-semibold leading-none mb-0.5">{label}</p>
        <p className="text-foreground text-sm font-semibold tabular-nums truncate">{value}</p>
      </div>
    </div>
  );
}
