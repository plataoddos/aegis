import { useState } from 'react';
import {
  LogOut, Globe, Hash, Settings, FileJson, Wifi, Bug, MessageSquare, Code2, ShieldAlert, Eye
} from 'lucide-react';
import { XEyesImport } from './XEyesImport';
import { ReseauTool } from './ReseauTool';
import { WebTool } from './WebTool';
import { CryptoTool } from './CryptoTool';
import { VulnTool } from './VulnTool';
import { DiscordTool } from './DiscordTool';
import { DomaineTool } from './DomaineTool';
import { WatcherTool } from './WatcherTool';

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
  Component: React.ComponentType;
}

const CATEGORIES: Category[] = [
  { id: 'domaine', name: 'Domaine',         description: 'IP, DNS, WHOIS, sous-domaines, reverse DNS',          icon: Globe,         Component: DomaineTool },
  { id: 'reseau',  name: 'Réseau',           description: 'Ping, scan de ports, traceroute, SSL/TLS',             icon: Wifi,          Component: ReseauTool },
  { id: 'web',     name: 'Web',              description: 'En-têtes, technologies, WAF, redirections',           icon: Code2,         Component: WebTool },
  { id: 'crypto',  name: 'Crypto',           description: 'Hachage, encodage, mots de passe, JWT',               icon: Hash,          Component: CryptoTool },
  { id: 'vuln',    name: 'Vulnérabilités',   description: 'Recherche CVE, Shodan InternetDB',                    icon: ShieldAlert,   Component: VulnTool },
  { id: 'discord', name: 'Discord',          description: 'Snowflake, token, invitation, webhook, profil',       icon: MessageSquare, Component: DiscordTool },
  { id: 'watcher', name: 'Discord Watcher',  description: 'Polling REST multi-tokens, présence/statut, push WS', icon: Eye,         badge: 'LIVE', Component: WatcherTool },
  { id: 'xeyes',   name: 'Import xEyes',     description: 'Import et consolidation de rapports JSON xEyes',       icon: FileJson,      badge: 'Pro', Component: XEyesImport },
];

export function Dashboard({ userKey, onLogout, onAdminAccess, isAdmin = false }: DashboardProps) {
  const [activeId, setActiveId] = useState<string>('domaine');

  const users       = JSON.parse(localStorage.getItem('osint_users') || '[]');
  const currentUser = users.find((u: any) => u.key === userKey);
  const username    = currentUser?.username || 'Utilisateur';
  const userInitial = username[0]?.toUpperCase() || '?';

  const active   = CATEGORIES.find(c => c.id === activeId)!;
  const Active   = active.Component;
  const ActiveIcon = active.icon;

  return (
    <div className="flex min-h-screen bg-background">
      {/* ── SIDEBAR ── */}
      <aside className="w-64 bg-sidebar border-r border-sidebar-border flex flex-col flex-shrink-0">
        {/* Brand */}
        <div className="px-5 py-5 border-b border-sidebar-border">
          <img src="/nt3xnb.png" alt="NET.X" className="h-8 w-auto" />
        </div>

        {/* Nav */}
        <nav className="flex-1 px-3 py-4 overflow-y-auto">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold px-3 mb-2">Outils</p>
          <div className="space-y-0.5">
            {CATEGORIES.map((cat) => {
              const Icon = cat.icon;
              const isActive = cat.id === activeId;
              return (
                <button
                  key={cat.id}
                  onClick={() => setActiveId(cat.id)}
                  className={`group w-full flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-all ${
                    isActive
                      ? 'bg-sidebar-accent text-foreground'
                      : 'text-muted-foreground hover:text-foreground hover:bg-sidebar-accent/50'
                  }`}
                >
                  <Icon className={`w-4 h-4 flex-shrink-0 ${isActive ? 'text-foreground' : 'text-muted-foreground group-hover:text-foreground'}`} />
                  <span className="flex-1 text-left">{cat.name}</span>
                  {cat.badge && (
                    <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded bg-foreground text-background">{cat.badge}</span>
                  )}
                </button>
              );
            })}
          </div>
        </nav>

        {/* User card */}
        <div className="border-t border-sidebar-border p-3 space-y-1">
          {isAdmin && (
            <button
              onClick={onAdminAccess}
              className="w-full flex items-center gap-3 px-3 py-2 rounded-md text-sm text-muted-foreground hover:text-foreground hover:bg-sidebar-accent/50 transition-colors"
            >
              <Settings className="w-4 h-4" />
              Administration
            </button>
          )}
          <div className="flex items-center gap-3 px-3 py-2 rounded-md">
            <div className="w-7 h-7 rounded-full bg-muted flex items-center justify-center text-foreground font-medium text-xs flex-shrink-0">
              {userInitial}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-foreground text-sm font-medium truncate">{username}</p>
              <p className="text-muted-foreground text-xs">{isAdmin ? 'Administrateur' : 'Utilisateur'}</p>
            </div>
            <button onClick={onLogout} className="text-muted-foreground hover:text-foreground p-1 rounded transition-colors" title="Déconnexion">
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </aside>

      {/* ── MAIN ── */}
      <main className="flex-1 flex flex-col min-w-0">
        {/* Page header */}
        <header className="border-b border-border bg-background px-8 py-6">
          <div className="max-w-6xl mx-auto flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center">
                <ActiveIcon className="w-5 h-5 text-foreground" />
              </div>
              <div>
                <h1 className="text-foreground text-xl font-bold tracking-tight">{active.name}</h1>
                <p className="text-muted-foreground text-sm mt-0.5">{active.description}</p>
              </div>
            </div>
            <div className="hidden md:flex items-center gap-2 text-xs text-muted-foreground border border-border rounded-md px-3 py-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
              Tous les services opérationnels
            </div>
          </div>
        </header>

        {/* Tool content */}
        <div className="flex-1 overflow-y-auto bg-background">
          <div className="max-w-6xl mx-auto px-8 py-8">
            <Active />
          </div>
        </div>
      </main>
    </div>
  );
}
