/**
 * Admin sub-page : premium key management.
 *
 *   - Generate keys (duration + count + note, with quick presets)
 *   - List existing keys with filters / search
 *   - Copy or delete unused keys
 */
import { useEffect, useMemo, useState } from 'react';
import {
  KeyRound, Plus, Copy, Check, Trash2, Search, Loader2, Sparkles,
} from 'lucide-react';
import { toast } from 'sonner';
import { apiGet, apiPost, apiDelete } from '../../lib/api';
import type { AdminKey, AdminUser } from './adminTypes';

function fmtDate(ts: number | null): string {
  if (!ts) return '—';
  return new Date(ts).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
}

export function AdminKeys() {
  const [keys, setKeys]   = useState<AdminKey[]>([]);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = async () => {
    setLoading(true);
    try {
      const [k, u] = await Promise.all([
        apiGet<AdminKey[]>('/api/admin/keys'),
        apiGet<AdminUser[]>('/api/admin/users'),
      ]);
      setKeys(k);
      setUsers(u);
    } catch (e) {
      toast.error('Erreur', { description: (e as Error).message });
    } finally { setLoading(false); }
  };
  useEffect(() => { reload(); }, []);

  return (
    <div className="space-y-5">
      <KeyGenerator onGenerated={reload} />
      <KeysList keys={keys} users={users} onChange={reload} loading={loading} />
    </div>
  );
}

// ─── Key generator ─────────────────────────────────────────────────────────
function KeyGenerator({ onGenerated }: { onGenerated: () => Promise<void> }) {
  const [days, setDays]     = useState(30);
  const [count, setCount]   = useState(1);
  const [note, setNote]     = useState('');
  const [generating, setGenerating] = useState(false);
  const [generated, setGenerated]   = useState<{ key: string; days: number }[]>([]);
  const [copied, setCopied] = useState<string | null>(null);

  const PRESETS = [7, 30, 90, 365];

  const generate = async () => {
    if (days < 1 || days > 3650) return toast.error('Durée invalide (1 à 3650 jours)');
    if (count < 1 || count > 50)  return toast.error('Quantité invalide (1 à 50)');
    setGenerating(true);
    try {
      const r = await apiPost<{ keys: { key: string; days: number }[] }>('/api/admin/keys', {
        days, count, note: note.trim() || null,
      });
      setGenerated(r.keys);
      toast.success(`${r.keys.length} clé${r.keys.length > 1 ? 's' : ''} générée${r.keys.length > 1 ? 's' : ''}`);
      setNote('');
      if (r.keys.length === 1) {
        navigator.clipboard.writeText(r.keys[0].key);
        toast.success('Copiée dans le presse-papiers');
      }
      await onGenerated();
    } catch (e) {
      toast.error('Erreur', { description: (e as Error).message });
    } finally { setGenerating(false); }
  };

  const copyAll = () => {
    navigator.clipboard.writeText(generated.map(k => k.key).join('\n'));
    toast.success(`${generated.length} clé${generated.length > 1 ? 's' : ''} copiée${generated.length > 1 ? 's' : ''}`);
  };

  return (
    <div className="aegis-card aegis-card-edge p-5">
      <h2 className="text-base font-semibold flex items-center gap-2 mb-1">
        <Plus className="w-4 h-4 text-amber-400" />
        Générer des clés
      </h2>
      <p className="text-xs text-muted-foreground mb-4">
        Chaque clé débloque <strong className="text-foreground">N jours</strong> de premium (100 req/jour) pour le compte qui la consomme.
      </p>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div>
          <label className="block text-[10px] uppercase tracking-wider text-muted-foreground/70 font-semibold mb-1.5">Durée (jours)</label>
          <input type="number" min={1} max={3650} value={days}
            onChange={e => setDays(parseInt(e.target.value, 10) || 0)}
            className="w-full bg-input/60 border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/40 focus:border-amber-500/40" />
          <div className="flex gap-1 mt-2">
            {PRESETS.map(p => (
              <button key={p} type="button" onClick={() => setDays(p)}
                className={`text-[10px] uppercase tracking-wider px-2 py-0.5 rounded transition-colors ${
                  days === p
                    ? 'bg-amber-500/20 text-amber-300 ring-1 ring-amber-500/40'
                    : 'bg-white/5 text-muted-foreground hover:bg-white/10'
                }`}>
                {p}j
              </button>
            ))}
          </div>
        </div>
        <div>
          <label className="block text-[10px] uppercase tracking-wider text-muted-foreground/70 font-semibold mb-1.5">Quantité</label>
          <input type="number" min={1} max={50} value={count}
            onChange={e => setCount(parseInt(e.target.value, 10) || 0)}
            className="w-full bg-input/60 border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/40 focus:border-amber-500/40" />
          <p className="text-[10px] text-muted-foreground/70 mt-2">1 à 50 clés par batch.</p>
        </div>
        <div>
          <label className="block text-[10px] uppercase tracking-wider text-muted-foreground/70 font-semibold mb-1.5">Note (optionnel)</label>
          <input type="text" value={note} onChange={e => setNote(e.target.value)} maxLength={200}
            placeholder="ex: distribué à @toto"
            className="w-full bg-input/60 border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/40 focus:border-amber-500/40" />
          <p className="text-[10px] text-muted-foreground/70 mt-2">Visible uniquement dans la liste admin.</p>
        </div>
      </div>

      <button onClick={generate} disabled={generating}
        className="mt-4 aegis-btn-primary text-primary-foreground px-4 py-2 rounded-lg text-sm font-semibold flex items-center gap-1.5 disabled:opacity-50">
        {generating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
        Générer {count > 1 ? `${count} clés` : 'la clé'}
      </button>

      {generated.length > 0 && (
        <div className="mt-4 bg-emerald-500/[0.05] border border-emerald-500/20 rounded-lg p-3">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs uppercase tracking-wider text-emerald-400 font-semibold flex items-center gap-1.5">
              <Check className="w-3 h-3" />
              {generated.length} clé{generated.length > 1 ? 's' : ''} fraîchement générée{generated.length > 1 ? 's' : ''}
            </p>
            {generated.length > 1 && (
              <button onClick={copyAll}
                className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-300 ring-1 ring-emerald-500/30 hover:bg-emerald-500/20">
                <Copy className="w-3 h-3 inline mr-1" /> Tout copier
              </button>
            )}
          </div>
          <div className="space-y-1 max-h-40 overflow-y-auto">
            {generated.map(g => (
              <div key={g.key} className="flex items-center gap-2 text-xs font-mono">
                <code className="flex-1 truncate text-foreground">{g.key}</code>
                <span className="text-[10px] text-muted-foreground tabular-nums">{g.days}j</span>
                <button onClick={() => {
                  navigator.clipboard.writeText(g.key);
                  setCopied(g.key);
                  setTimeout(() => setCopied(null), 1200);
                  toast.success('Copiée');
                }} className="text-muted-foreground hover:text-foreground">
                  {copied === g.key ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Keys list ─────────────────────────────────────────────────────────────
function KeysList({ keys, users, onChange, loading }: {
  keys: AdminKey[];
  users: AdminUser[];
  onChange: () => Promise<void>;
  loading: boolean;
}) {
  const [filter, setFilter] = useState<'unused' | 'used' | 'all'>('unused');
  const [search, setSearch] = useState('');
  const [copied, setCopied] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return keys.filter(k => {
      if (filter === 'unused' && k.used_at) return false;
      if (filter === 'used'   && !k.used_at) return false;
      if (q && !k.key.toLowerCase().includes(q) && !(k.note || '').toLowerCase().includes(q)) return false;
      return true;
    });
  }, [keys, filter, search]);

  const copyKey = (k: string) => {
    navigator.clipboard.writeText(k);
    setCopied(k);
    setTimeout(() => setCopied(null), 1200);
    toast.success('Clé copiée');
  };

  const removeKey = async (k: string) => {
    if (!confirm('Supprimer cette clé ?')) return;
    try {
      await apiDelete(`/api/admin/keys/${encodeURIComponent(k)}`);
      toast.success('Clé supprimée');
      await onChange();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <div className="aegis-card aegis-card-edge p-5">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <h2 className="text-base font-semibold flex items-center gap-2">
          <KeyRound className="w-4 h-4 text-violet-400" />
          Clés ({filtered.length})
        </h2>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex gap-1 p-0.5 bg-black/30 rounded-md border border-white/5">
            {(['unused', 'used', 'all'] as const).map(f => (
              <button key={f} onClick={() => setFilter(f)}
                className={`text-[10px] uppercase tracking-wider px-2 py-1 rounded transition-all ${
                  filter === f ? 'bg-white/10 text-foreground' : 'text-muted-foreground hover:text-foreground'
                }`}>
                {f === 'unused' ? 'Disponibles' : f === 'used' ? 'Utilisées' : 'Toutes'}
              </button>
            ))}
          </div>
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground pointer-events-none" />
            <input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder="Filtrer…"
              className="bg-black/30 border border-white/5 rounded-md pl-7 pr-2 py-1 text-xs w-40 focus:outline-none focus:border-white/20" />
          </div>
        </div>
      </div>

      {loading ? (
        <p className="text-xs text-muted-foreground/70 italic text-center py-6">
          <Loader2 className="w-3 h-3 inline animate-spin mr-1" /> Chargement…
        </p>
      ) : filtered.length === 0 ? (
        <p className="text-sm text-muted-foreground italic text-center py-6">Aucune clé.</p>
      ) : (
        <div className="bg-black/20 rounded-lg border border-white/5 max-h-96 overflow-y-auto">
          {filtered.map(k => {
            const usedBy = users.find(u => u.id === k.used_by);
            const isUsed = !!k.used_at;
            return (
              <div key={k.key} className={`flex items-center gap-3 px-3 py-2 border-b border-white/5 last:border-0 hover:bg-white/[0.02] ${isUsed ? 'opacity-70' : ''}`}>
                <code className={`text-xs font-mono flex-1 truncate ${isUsed ? 'text-muted-foreground line-through' : 'text-foreground'}`}>
                  {k.key}
                </code>
                <span className="text-[10px] text-muted-foreground tabular-nums px-1.5 py-0.5 rounded bg-white/5">{k.days}j</span>
                {k.note && (
                  <span className="text-[10px] text-muted-foreground italic truncate max-w-[160px] hidden sm:inline" title={k.note}>
                    {k.note}
                  </span>
                )}
                {isUsed ? (
                  <span className="text-[10px] text-emerald-400 hidden md:inline">→ {usedBy?.username || `#${k.used_by}`}</span>
                ) : (
                  <span className="text-[10px] uppercase tracking-wider text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded ring-1 ring-emerald-500/20">Disponible</span>
                )}
                <span className="text-[10px] text-muted-foreground/70 tabular-nums hidden lg:inline">{fmtDate(k.created_at)}</span>
                {!isUsed && (
                  <>
                    <button onClick={() => copyKey(k.key)} className="text-muted-foreground hover:text-foreground p-0.5">
                      {copied === k.key ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                    </button>
                    <button onClick={() => removeKey(k.key)} className="text-muted-foreground hover:text-rose-400 p-0.5">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
