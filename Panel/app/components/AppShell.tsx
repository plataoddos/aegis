/**
 * Slim app shell — replaces the legacy Dashboard module grid.
 *
 *  Tabs: Renseignement · Discord Watcher · Fiches · Compte
 *
 * The wide module-grid Dashboard.tsx is kept on disk for reference but no
 * longer imported by App.tsx. To restore it, swap App.tsx back to render
 * <Dashboard /> instead of <AppShell />.
 */
import { useState } from 'react';
import {
  Telescope, Eye, Users as UsersIcon, User, LogOut, Crown, Zap, Shield,
  MessageSquare,
} from 'lucide-react';
import { OsintHub } from './OsintHub';
import { WatcherTool } from './WatcherTool';
import { PersonsTool } from './PersonsTool';
import { AccountPage } from './AccountPage';
import { ContactPage } from './ContactPage';
import { AdminPage } from './AdminPage';
import { useAuth } from '../lib/auth';

type TabId = 'osint' | 'watcher' | 'fiches' | 'contact' | 'account' | 'admin';

interface Tab {
  id: TabId;
  name: string;
  icon: any;
  Component: React.ComponentType;
  adminOnly?: boolean;
}

const TABS: Tab[] = [
  { id: 'osint',   name: 'Renseignement',  icon: Telescope,     Component: OsintHub },
  { id: 'watcher', name: 'Discord Watcher', icon: Eye,           Component: WatcherTool },
  { id: 'fiches',  name: 'Fiches',          icon: UsersIcon,     Component: PersonsTool },
  { id: 'contact', name: 'Contact',         icon: MessageSquare, Component: ContactPage },
  { id: 'account', name: 'Compte',          icon: User,          Component: AccountPage },
  { id: 'admin',   name: 'Admin',           icon: Shield,        Component: AdminPage, adminOnly: true },
];

export function AppShell() {
  const [active, setActive] = useState<TabId>('osint');
  const { user, logout } = useAuth();

  if (!user) return null;

  // Hide admin-only tabs from non-admins, and snap back to a safe tab if the
  // user lost their admin powers while sitting on the Admin tab.
  const visibleTabs = TABS.filter(t => !t.adminOnly || user.is_admin);
  const activeTab   = visibleTabs.find(t => t.id === active) || visibleTabs[0];
  const Active = activeTab.Component;
  const dl = user.premium_until ? Math.max(0, Math.ceil((user.premium_until - Date.now()) / 86400_000)) : 0;

  return (
    <div className="min-h-screen bg-background">
      {/* Top nav */}
      <header className="sticky top-0 z-40 backdrop-blur-xl bg-background/80 border-b border-border">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-14 flex items-center gap-4">
          <div className="flex items-center gap-2 mr-4 flex-shrink-0">
            <img src="/logo-plat-nb.png" alt="Aegis"
              className="h-5 w-auto drop-shadow-[0_0_10px_rgba(99,102,241,0.35)]" />
          </div>

          <nav className="flex items-center gap-1 flex-1 overflow-x-auto">
            {visibleTabs.map(t => {
              const Icon = t.icon;
              const isActive = active === t.id;
              return (
                <button key={t.id} onClick={() => setActive(t.id)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                    isActive
                      ? 'bg-primary/15 text-primary ring-1 ring-primary/30'
                      : 'text-muted-foreground hover:text-foreground hover:bg-white/5'
                  }`}>
                  <Icon className="w-3.5 h-3.5" />
                  {t.name}
                </button>
              );
            })}
          </nav>

          <div className="flex items-center gap-3">
            {/* Quota badge */}
            <button onClick={() => setActive('account')}
              title={`${user.quota.used}/${user.quota.limit} requêtes aujourd'hui`}
              className="hidden sm:flex items-center gap-1.5 text-[11px] px-2 py-1 rounded-md bg-white/5 hover:bg-white/10 ring-1 ring-white/10 transition-colors">
              <Zap className="w-3 h-3 text-amber-400" />
              <span className="tabular-nums font-semibold">{user.quota.used}/{user.quota.limit}</span>
            </button>

            {/* Premium badge */}
            {user.premium ? (
              <span className="hidden sm:flex items-center gap-1 text-[10px] uppercase tracking-wider bg-violet-500/15 text-violet-300 ring-1 ring-violet-500/30 rounded px-1.5 py-0.5 font-bold">
                <Crown className="w-2.5 h-2.5" /> {dl}j
              </span>
            ) : null}

            {/* User pill */}
            <button onClick={() => setActive('account')}
              className="flex items-center gap-2 text-xs hover:bg-white/5 rounded-lg px-2 py-1 transition-colors">
              <div className="w-6 h-6 rounded-md bg-gradient-to-br from-indigo-500/30 to-violet-500/10 ring-1 ring-indigo-500/40 flex items-center justify-center font-bold text-indigo-200">
                {user.username.slice(0, 1).toUpperCase()}
              </div>
              <span className="hidden md:inline font-medium">{user.username}</span>
            </button>

            <button onClick={logout} title="Déconnexion"
              className="text-muted-foreground hover:text-rose-400 transition-colors p-1.5">
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </header>

      {/* Active tool — wrapped in a centered container with comfortable side
          padding so content doesn't hug the viewport edges on wide screens. */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <Active />
      </main>
    </div>
  );
}
