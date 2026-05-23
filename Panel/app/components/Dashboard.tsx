import { useState } from 'react';
import {
  LogOut, Globe, Hash, Settings, FileJson, Wifi, MessageSquare, Code2,
  ShieldAlert, Eye, Users, Search, Telescope,
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

interface Category {
  id: string;
  name: string;
  description: string;
  icon: any;
  badge?: string;
  badgeTone?: 'live' | 'pro' | 'api';
  Component: React.ComponentType;
  group: 'recon' | 'people' | 'utils';
}

const CATEGORIES: Category[] = [
  // ── Reconnaissance & infra
  { id: 'domaine', group: 'recon',  name: 'Domaine',         description: 'IP, DNS, WHOIS, sous-domaines, reverse DNS',                 icon: Globe,         Component: DomaineTool },
  { id: 'reseau',  group: 'recon',  name: 'Réseau',          description: 'Ping, scan de ports, traceroute, SSL/TLS',                   icon: Wifi,          Component: ReseauTool },
  { id: 'web',     group: 'recon',  name: 'Web',             description: 'En-têtes, technologies, WAF, redirections',                  icon: Code2,         Component: WebTool },
  { id: 'vuln',    group: 'recon',  name: 'Vulnérabilités',  description: 'Recherche CVE, Shodan InternetDB',                           icon: ShieldAlert,   Component: VulnTool },
  // ── People intelligence
  { id: 'fiches',  group: 'people', name: 'Fiches',          description: 'Base de fiches : identité, contact, allocataire, IBAN',     icon: Users,         Component: PersonsTool },
  { id: 'seek',    group: 'people', name: 'Seek',            description: 'Recherche multi-source via see-know.eu (cache 24h, proxy)', icon: Telescope,     badge: 'API',  badgeTone: 'api',  Component: SeekTool },
  { id: 'discord', group: 'people', name: 'Discord',         description: 'Snowflake, token, invitation, webhook, profil',             icon: MessageSquare, Component: DiscordTool },
  { id: 'watcher', group: 'people', name: 'Discord Watcher', description: 'Polling REST multi-tokens, présence/statut, push WS',       icon: Eye,           badge: 'LIVE', badgeTone: 'live', Component: WatcherTool },
  // ── Utilitaires
  { id: 'crypto',  group: 'utils',  name: 'Crypto',          description: 'Hachage, encodage, mots de passe, JWT',                     icon: Hash,          Component: CryptoTool },
  { id: 'xeyes',   group: 'utils',  name: 'Import xEyes',    description: 'Import et consolidation de rapports JSON xEyes',            icon: FileJson,      badge: 'PRO',  badgeTone: 'pro',  Component: XEyesImport },
];

const GROUPS: { id: Category['group']; label: string }[] = [
  { id: 'recon',  label: 'Reconnaissance' },
  { id: 'people', label: 'People intel' },
  { id: 'utils',  label: 'Utilitaires' },
];

function Badge({ tone, children }: { tone?: Category['badgeTone']; children: React.ReactNode }) {
  const map: Record<NonNullable<Category['badgeTone']>, string> = {
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
  const [activeId, setActiveId] = useState<string>('fiches');
  const [search, setSearch]     = useState('');

  const users       = JSON.parse(localStorage.getItem('osint_users') || '[]');
  const currentUser = users.find((u: any) => u.key === userKey);
  const username    = currentUser?.username || 'Utilisateur';
  const userInitial = username[0]?.toUpperCase() || '?';

  const active     = CATEGORIES.find(c => c.id === activeId)!;
  const Active     = active.Component;
  const ActiveIcon = active.icon;

  const q = search.trim().toLowerCase();
  const filtered = q
    ? CATEGORIES.filter(c => c.name.toLowerCase().includes(q) || c.description.toLowerCase().includes(q))
    : CATEGORIES;

  return (
    <div className="flex min-h-screen bg-background">
      {/* ── SIDEBAR ── */}
      <aside className="w-64 bg-sidebar border-r border-sidebar-border flex flex-col flex-shrink-0 relative">
        {/* Top edge accent */}
        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/30 to-transparent" />

        {/* Brand */}
        <div className="px-5 py-5">
          <div className="flex items-center gap-2">
            <img src="/aegis-logo.png" alt="Aegis" className="h-7 w-auto drop-shadow-[0_0_12px_rgba(99,102,241,0.4)]" />
            <span className="ml-auto text-[9px] uppercase tracking-wider text-muted-foreground/60 font-semibold border border-border rounded px-1.5 py-0.5">v1</span>
          </div>
        </div>

        {/* Search */}
        <div className="px-3 pb-3">
          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Rechercher un outil…"
              className="w-full bg-input/60 border border-border rounded-md pl-8 pr-2 py-1.5 text-xs text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-1 focus:ring-primary/40 focus:border-primary/40 transition-all"
            />
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-3 pb-3 overflow-y-auto">
          {GROUPS.map(group => {
            const items = filtered.filter(c => c.group === group.id);
            if (items.length === 0) return null;
            return (
              <div key={group.id} className="mb-4 last:mb-0">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground/70 font-semibold px-2 mb-1.5">
                  {group.label}
                </p>
                <div className="space-y-0.5">
                  {items.map((cat) => {
                    const Icon = cat.icon;
                    const isActive = cat.id === activeId;
                    return (
                      <button
                        key={cat.id}
                        onClick={() => setActiveId(cat.id)}
                        className={`group relative w-full flex items-center gap-2.5 px-2.5 py-2 rounded-md text-sm transition-all ${
                          isActive
                            ? 'bg-sidebar-accent text-foreground'
                            : 'text-muted-foreground hover:text-foreground hover:bg-sidebar-accent/50'
                        }`}
                      >
                        {isActive && (
                          <span className="absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-r bg-primary" />
                        )}
                        <Icon className={`w-4 h-4 flex-shrink-0 transition-colors ${isActive ? 'text-primary' : ''}`} />
                        <span className="flex-1 text-left truncate">{cat.name}</span>
                        {cat.badge && <Badge tone={cat.badgeTone}>{cat.badge}</Badge>}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
          {filtered.length === 0 && (
            <p className="text-xs text-muted-foreground/60 text-center py-6">Aucun outil trouvé</p>
          )}
        </nav>

        {/* User card */}
        <div className="border-t border-sidebar-border p-2 space-y-1">
          {isAdmin && (
            <button
              onClick={onAdminAccess}
              className="w-full flex items-center gap-3 px-3 py-2 rounded-md text-sm text-muted-foreground hover:text-foreground hover:bg-sidebar-accent/50 transition-colors"
            >
              <Settings className="w-4 h-4" />
              Administration
            </button>
          )}
          <div className="flex items-center gap-3 px-2 py-2 rounded-md hover:bg-sidebar-accent/40 transition-colors group">
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-primary to-primary/40 flex items-center justify-center text-primary-foreground font-semibold text-xs flex-shrink-0 ring-1 ring-primary/30">
              {userInitial}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-foreground text-sm font-medium truncate">{username}</p>
              <p className="text-muted-foreground text-[11px] truncate">{isAdmin ? 'Administrateur' : 'Utilisateur'}</p>
            </div>
            <button
              onClick={onLogout}
              className="text-muted-foreground hover:text-destructive p-1.5 rounded transition-colors opacity-60 group-hover:opacity-100"
              title="Déconnexion"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </aside>

      {/* ── MAIN ── */}
      <main className="flex-1 flex flex-col min-w-0">
        {/* Page header */}
        <header className="border-b border-border bg-background/60 backdrop-blur-md px-8 py-5 sticky top-0 z-10">
          <div className="max-w-7xl mx-auto flex items-center justify-between gap-6">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-9 h-9 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center flex-shrink-0">
                <ActiveIcon className="w-4 h-4 text-primary" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h1 className="text-foreground text-base font-semibold tracking-tight">{active.name}</h1>
                  {active.badge && <Badge tone={active.badgeTone}>{active.badge}</Badge>}
                </div>
                <p className="text-muted-foreground text-xs mt-0.5 truncate">{active.description}</p>
              </div>
            </div>
            <div className="hidden md:flex items-center gap-2 text-[11px] text-muted-foreground border border-border rounded-md px-2.5 py-1">
              <span className="relative flex w-1.5 h-1.5">
                <span className="absolute inset-0 rounded-full bg-emerald-400 animate-ping opacity-50" />
                <span className="relative w-1.5 h-1.5 rounded-full bg-emerald-400" />
              </span>
              Services opérationnels
            </div>
          </div>
        </header>

        {/* Tool content */}
        <div className="flex-1 overflow-y-auto">
          <div key={activeId} className="max-w-7xl mx-auto px-8 py-8 aegis-fade-in">
            <Active />
          </div>
        </div>
      </main>
    </div>
  );
}
