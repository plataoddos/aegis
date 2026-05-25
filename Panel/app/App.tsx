import { useEffect } from 'react';
import { Toaster } from 'sonner';
import { Loader2 } from 'lucide-react';
import { AuthProvider, useAuth } from './lib/auth';
import { AuthPage } from './components/AuthPage';
import { AppShell } from './components/AppShell';

function Inner() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="flex flex-col items-center gap-3 text-muted-foreground">
          <Loader2 className="w-6 h-6 animate-spin" />
          <span className="text-xs uppercase tracking-wider">Chargement…</span>
        </div>
      </div>
    );
  }

  return user ? <AppShell /> : <AuthPage />;
}

export default function App() {
  useEffect(() => { document.documentElement.classList.add('dark'); }, []);
  return (
    <AuthProvider>
      <Toaster position="top-right" richColors />
      <Inner />
    </AuthProvider>
  );
}
