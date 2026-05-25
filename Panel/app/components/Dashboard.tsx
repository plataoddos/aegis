import { useState, useEffect } from 'react';
import {
  LogOut, Globe, Hash, Settings, FileJson, Wifi, MessageSquare, Code2,
  ShieldAlert, Eye, Users, Search, Telescope, ArrowLeft, ArrowUpRight,
  Sparkles, Flame,
} from 'lucide-react';
import { ReseauTool } from './ReseauTool';
import { WebTool } from './WebTool';
import { CryptoTool } from './CryptoTool';
import { VulnTool } from './VulnTool';
import { DiscordTool } from './DiscordTool';
import { DomaineTool } from './DomaineTool';
import { WatcherTool } from './WatcherTool';
import { PersonsTool } from './PersonsTool';
import { OsintHub } from './OsintHub';
import { CanaryTool } from './CanaryTool';

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
  group: 'recon' | 'people' | 'security' | 'utils';
  /** Headline featured on the home grid */
  tagline?: string;
}

const MODULES: Module[] = [
  // ── Renseignement (cible unique + multi-critères, OSINT + Seek API)
  { id: 'osint',   group: 'people', tone: 'violet', name: 'Renseignement',   icon: Telescope,     description: 'Cible unique (auto-détection) ou multi-critères (nom, prénom, naissance…) · sources publiques + Seek API', tagline: 'Recherche universelle multi-sources', badge: 'NEW', badgeTone: 'live', Component: OsintHub },
  // ── Reconnaissance & infra
  { id: 'domaine', group: 'recon', tone: 'sky',     name: 'Domaine',         icon: Globe,         description: 'IP, DNS, WHOIS, sous-domaines, reverse DNS',                 tagline: 'Cartographie réseau & infrastructure',     Component: DomaineTool },
  { id: 'reseau',  group: 'recon', tone: 'cyan',    name: 'Réseau',          icon: Wifi,          description: 'Ping, scan de ports, traceroute, SSL/TLS',                   tagline: 'Diagnostic temps réel des hôtes',          Component: ReseauTool },
  { id: 'web',     group: 'recon', tone: 'violet',  name: 'Web',             icon: Code2,         description: 'En-têtes, technologies, WAF, redirections',                  tagline: 'Empreinte technologique des sites',        Component: WebTool },
  { id: 'vuln',    group: 'recon', tone: 'rose',    name: 'Vulnérabilités',  icon: ShieldAlert,   description: 'Recherche CVE, Shodan InternetDB',                           tagline: 'Veille CVE et exposition publique',        Component: VulnTool },
  // ── People intelligence
  { id: 'fiches',  group: 'people', tone: 'indigo', name: 'Fiches',          icon: Users,         description: 'Identité, contact, allocataire, IBAN',                      tagline: 'Base de personnes structurée',             Component: PersonsTool },
  { id: 'discord', group: 'people', tone: 'sky',    name: 'Discord',         icon: MessageSquare, description: 'Snowflake, token, invitation, webhook, profil',             tagline: 'Décodage et profilage Discord',            Component: DiscordTool },
  { id: 'watcher', group: 'people', tone: 'emerald',name: 'Discord Watcher', icon: Eye,           description: 'Surveillance temps réel multi-tokens',                      tagline: 'Pool selfbot, push WS, événements live',   badge: 'LIVE', badgeTone: 'live', Component: WatcherTool },
  // ── Sécurité défensive
  { id: 'canary',  group: 'security', tone: 'rose', name: 'Canaris',         icon: Flame,         description: 'Honeytokens — URL invisible, pixel email, redirection. Alerte sur intrusion.', tagline: 'Triggers d\'alerte / honeytokens', badge: 'NEW', badgeTone: 'live', Component: CanaryTool },
  // ── Utilitaires
  { id: 'crypto',  group: 'utils',  tone: 'amber',  name: 'Crypto',          icon: Hash,          description: 'Hachage, encodage, mots de passe, JWT',                     tagline: 'Couteau-suisse cryptographique',           Component: CryptoTool },
];

const GROUPS: { id: Module['group']; label: string; description: string }[] = [
  { id: 'recon',  label: 'Reconnaissance', description: 'Cartographie infrastructure & réseau' },
  { id: 'people',   label: 'People Intel',  description: 'Recherche, surveillance et données personnelles' },
  { id: 'security', label: 'Sécurité',      description: 'Détection d\'intrusion & honeytokens' },
  { id: 'utils',    label: 'Utilitaires',   description: 'Outils transverses et import' },
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
      <div className="h-screen overflow-hidden flex flex-col">
        <TopBar
          username={username}
          userInitial={userInitial}
          isAdmin={isAdmin}
          onLogout={onLogout}
          onAdminAccess={onAdminAccess}
          onHome={() => setActiveId(null)}
          breadcrumb={active}
        />

        {/* Module scrolls internally — page never scrolls */}
        <main className="flex-1 overflow-y-auto">
          <div key={active.id} className="max-w-[1500px] mx-auto px-5 lg:px-8 pt-5 pb-5 aegis-fade-in">
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
    <div className="h-screen overflow-hidden flex flex-col">
      <TopBar
        username={username}
        userInitial={userInitial}
        isAdmin={isAdmin}
        onLogout={onLogout}
        onAdminAccess={onAdminAccess}
      />

      <main className="flex-1 max-w-[1500px] w-full mx-auto px-5 lg:px-8 pt-5 pb-5 aegis-fade-in flex flex-col overflow-hidden">
        {/* Hero — compact */}
        <section className="flex items-end justify-between gap-6 mb-5 flex-wrap">
          <div>
            <div className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border border-primary/20 bg-primary/5 mb-2">
              <Sparkles className="w-3 h-3 text-primary" />
              <span className="text-[10px] uppercase tracking-wider text-primary font-semibold">Intelligence Platform</span>
            </div>
            <h1 className="text-foreground text-2xl lg:text-3xl font-bold tracking-tight">
              Bienvenue, <span className="bg-gradient-to-r from-primary via-violet-400 to-primary bg-clip-text text-transparent">{username}</span>
            </h1>
            <p className="text-muted-foreground text-xs mt-1">Sélectionne un module pour commencer.</p>
          </div>

          {/* Search */}
          <div className="relative group w-full sm:w-auto sm:min-w-[280px]">
            <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground transition-colors group-focus-within:text-primary" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Rechercher un module…"
              className="w-full bg-card/40 backdrop-blur-md border border-white/8 rounded-lg pl-9 pr-3 py-2 text-xs text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:border-primary/40 transition-all shadow-lg shadow-black/30"
            />
          </div>
        </section>

        {/* Module groups — compact, all fits in viewport */}
        <div className="flex-1 flex flex-col justify-start gap-5">
          {GROUPS.map(group => {
            const items = filtered.filter(m => m.group === group.id);
            if (items.length === 0) return null;
            return (
              <section key={group.id}>
                <div className="flex items-center justify-between mb-2 px-1">
                  <div className="flex items-baseline gap-2">
                    <h2 className="text-foreground text-sm font-semibold tracking-tight">{group.label}</h2>
                    <span className="text-[10px] text-muted-foreground/60 tabular-nums">{items.length}</span>
                  </div>
                  <p className="text-muted-foreground text-[10px] hidden sm:block">{group.description}</p>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                  {items.map((m, i) => (
                    <ModuleCard key={m.id} module={m} index={i} onOpen={() => setActiveId(m.id)} />
                  ))}
                </div>
              </section>
            );
          })}

          {filtered.length === 0 && (
            <div className="text-center py-10">
              <Search className="w-8 h-8 text-muted-foreground/30 mx-auto mb-2" />
              <p className="text-muted-foreground text-sm">Aucun module ne correspond.</p>
            </div>
          )}
        </div>
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
      <div className="max-w-[1500px] mx-auto px-5 lg:px-8 h-16 flex items-center gap-4">
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
      style={{ animationDelay: `${index * 30}ms` }}
      className={`group relative aegis-card aegis-card-edge aegis-tilt text-left px-4 py-3 transition-all duration-300 hover:border-white/15 hover:shadow-2xl ${t.glow} aegis-fade-in`}
    >
      {/* Background gradient mesh on hover */}
      <div className={`absolute inset-0 rounded-[inherit] bg-gradient-to-br ${t.from} ${t.to} opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none`} />

      <div className="relative flex items-center gap-3">
        <div className={`w-10 h-10 rounded-lg bg-gradient-to-br ${t.from} ${t.to} ring-1 ${t.ring} flex items-center justify-center flex-shrink-0 transition-transform group-hover:scale-110`}>
          <Icon className={`w-4 h-4 ${t.text}`} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <h3 className="text-foreground font-semibold text-sm tracking-tight truncate">{m.name}</h3>
            {m.badge && <Badge tone={m.badgeTone}>{m.badge}</Badge>}
          </div>
          {m.tagline && <p className="text-muted-foreground text-[11px] truncate mt-0.5">{m.tagline}</p>}
        </div>
        <ArrowUpRight className="w-3.5 h-3.5 text-muted-foreground/40 group-hover:text-foreground transition-all group-hover:translate-x-0.5 group-hover:-translate-y-0.5 flex-shrink-0" />
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
