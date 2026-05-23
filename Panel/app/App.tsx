import { useState, useEffect } from 'react';
import { Login } from './components/Login';
import { Dashboard } from './components/Dashboard';
import { AdminPanel } from './components/AdminPanel';
import { Toaster } from 'sonner';

export const ADMIN_KEY = (import.meta as any).env?.VITE_ADMIN_KEY as string;

if (!ADMIN_KEY) {
  // eslint-disable-next-line no-console
  console.error('[Aegis] VITE_ADMIN_KEY est manquant — créez un fichier .env.local à la racine de Panel/ avec VITE_ADMIN_KEY=...');
}

export default function App() {
  const [view, setView] = useState<'login' | 'dashboard' | 'admin'>('login');
  const [currentUserKey, setCurrentUserKey] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    document.documentElement.classList.add('dark');

    let users: any[] = JSON.parse(localStorage.getItem('osint_users') || '[]');

    // Migration: drop any stale admin entries that don't match the current ADMIN_KEY
    const cleaned = users.filter((u) => !(u.role === 'admin' && u.key !== ADMIN_KEY));
    if (cleaned.length !== users.length) {
      users = cleaned;
      localStorage.setItem('osint_users', JSON.stringify(users));
    }

    const ADMIN_USERNAME = 'Mullvd';
    const adminUser = users.find((u) => u.key === ADMIN_KEY);
    if (!adminUser) {
      users.push({
        username: ADMIN_USERNAME,
        key: ADMIN_KEY,
        role: 'admin',
        createdAt: new Date().toISOString(),
        expiresAt: null,
        duration: -1,
      });
      localStorage.setItem('osint_users', JSON.stringify(users));
    } else if (adminUser.username !== ADMIN_USERNAME) {
      adminUser.username = ADMIN_USERNAME;
      localStorage.setItem('osint_users', JSON.stringify(users));
    }

    const savedKey = localStorage.getItem('osint_current_key');
    if (savedKey) {
      const freshUsers = JSON.parse(localStorage.getItem('osint_users') || '[]');
      const user = freshUsers.find((u: any) => u.key === savedKey);
      if (user && (!user.expiresAt || new Date(user.expiresAt) > new Date())) {
        setCurrentUserKey(savedKey);
        setIsAdmin(user.role === 'admin');
        setView('dashboard');
      } else {
        localStorage.removeItem('osint_current_key');
      }
    }
  }, []);

  const handleLogin = (key: string) => {
    const users = JSON.parse(localStorage.getItem('osint_users') || '[]');
    const user = users.find((u: any) => u.key === key);
    setCurrentUserKey(key);
    setIsAdmin(user?.role === 'admin');
    localStorage.setItem('osint_current_key', key);
    setView('dashboard');
  };

  const handleLogout = () => {
    setCurrentUserKey(null);
    setIsAdmin(false);
    localStorage.removeItem('osint_current_key');
    setView('login');
  };

  const handleAdminAccess = () => {
    if (!isAdmin) return;
    setView('admin');
  };

  const handleBackToDashboard = () => {
    setView('dashboard');
  };

  return (
    <>
      <Toaster position="top-right" richColors />
      {view === 'admin' && <AdminPanel onBack={handleBackToDashboard} />}
      {view === 'dashboard' && currentUserKey && (
        <Dashboard
          userKey={currentUserKey}
          onLogout={handleLogout}
          onAdminAccess={handleAdminAccess}
          isAdmin={isAdmin}
        />
      )}
      {view === 'login' && <Login onLogin={handleLogin} />}
    </>
  );
}
