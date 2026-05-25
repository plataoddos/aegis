/**
 * Admin sub-page : "Statistiques" — consommation par API et par utilisateur.
 *
 * Lit /api/admin/stats?range=24h|7d|30d|all. Le backend journalise chaque
 * appel BrixHub / IP-lookup dans la table `api_usage`, ce qui permet d'agréger
 * la consommation par fournisseur, par endpoint et par utilisateur.
 */
import { useEffect, useMemo, useState } from 'react';
import {
  Activity, Loader2, RefreshCw, TrendingUp, Database, Users as UsersIcon,
  AlertTriangle, Server, Zap, Clock,
} from 'lucide-react';
import { toast } from 'sonner';
import { apiGet } from '../../lib/api';

type Range = '24h' | '7d' | '30d' | 'all';

interface Totals { calls: number; quota_used: number; cache_hits: number; errors: number }
interface ByApi  { api: string; calls: number; quota_used: number; cache_hits: number; errors: number }
interface ByEp   extends ByApi { endpoint: string }
interface ByUser { id: number; username: string; is_admin: 0 | 1; premium_until: number | null; calls: number; quota_used: number }
interface Daily  { day: string; calls: number; quota_used: number }
interface Recent {
  id: number; user_id: number; username: string | null;
  api: string; endpoint: string; cost: number;
  cached: 0 | 1; ok: 0 | 1; status: number | null; created_at: number;
}
interface BrixHub {
  remaining: number | null;
  limit: number | null;
  catalog: { key: string; path: string; method: string; cost: number }[];
}

interface StatsPayload {
  range: Range;
  since: number;
  now: number;
  totals: Totals;
  by_api: ByApi[];
  by_endpoint: ByEp[];
  by_user: ByUser[];
  daily: Daily[];
  recent: Recent[];
  brixhub: BrixHub;
  tiers: { free: number; premium: number };
  content: { fiches: number; watches: number; users: number };
}

const RANGES: { id: Range; label: string }[] = [
  { id: '24h', label: '24 h' },
  { id: '7d',  label: '7 jours' },
  { id: '30d', label: '30 jours' },
  { id: 'all', label: 'Tout' },
];

const fmtTime = (ts: number) =>
  new Date(ts).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });

export function AdminStats() {
  const [range, setRange] = useState<Range>('7d');
  const [data, setData]   = useState<StatsPayload | null>(null);
  const [loading, setLoading] = useState(true);

  const reload = async () => {
    setLoading(true);
    try {
      const d = await apiGet<StatsPayload>(`/api/admin/stats?range=${range}`);
      setData(d);
    } catch (e) {
      toast.error('Erreur de chargement', { description: (e as Error).message });
    } finally { setLoading(false); }
  };
  useEffect(() => { reload(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [range]);

  const maxDaily = useMemo(() =>
    Math.max(1, ...(data?.daily.map(d => d.calls) || [0])), [data]);

  if (loading && !data) {
    return (
      <div className="aegis-card aegis-card-edge p-10 text-center">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground mx-auto" />
      </div>
    );
  }
  if (!data) return null;

  // BrixHub publishes a 1000 req/day quota; show that as the floor even before
  // the first call of the day populates the X-RateLimit headers.
  const BRIX_DEFAULT_LIMIT = 1000;
  const brixLimit     = data.brixhub.limit     ?? BRIX_DEFAULT_LIMIT;
  const brixRemaining = data.brixhub.remaining ?? brixLimit;
  const brixPct       = Math.round(100 * (brixLimit - brixRemaining) / brixLimit);

  return (
    <div className="space-y-5">
      {/* Range selector + reload */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="aegis-card aegis-card-edge p-1 flex items-center gap-1">
          {RANGES.map(r => (
            <button key={r.id} onClick={() => setRange(r.id)}
              className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-all ${
                range === r.id
                  ? 'bg-primary/15 text-primary ring-1 ring-primary/30'
                  : 'text-muted-foreground hover:text-foreground hover:bg-white/5'
              }`}>
              {r.label}
            </button>
          ))}
        </div>
        <button onClick={reload} disabled={loading}
          className="ml-auto border border-white/10 hover:bg-white/5 hover:border-white/20 text-muted-foreground hover:text-foreground px-3 py-1.5 rounded-lg text-xs flex items-center gap-1.5 transition-all">
          {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
          Actualiser
        </button>
      </div>

      {/* Headline KPI cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi icon={Activity} tone="indigo"  label="Appels"        value={data.totals.calls} />
        <Kpi icon={Zap}      tone="amber"   label="Quota consommé" value={data.totals.quota_used} />
        <Kpi icon={Database} tone="emerald" label="Cache hits"     value={data.totals.cache_hits} />
        <Kpi icon={AlertTriangle} tone="rose" label="Erreurs"      value={data.totals.errors} />
      </div>

      {/* BrixHub upstream gauge */}
      <div className="aegis-card aegis-card-edge p-5">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-indigo-500/20 to-violet-500/0 ring-1 ring-indigo-500/30 flex items-center justify-center">
            <Server className="w-4 h-4 text-indigo-300" />
          </div>
          <div className="flex-1">
            <h3 className="text-sm font-bold text-foreground">BrixHub — quota global du jour</h3>
            <p className="text-[11px] text-muted-foreground">
              Restant : <span className="font-mono text-emerald-300">{brixRemaining}</span> / {brixLimit}
              {data.brixhub.limit == null && (
                <span className="ml-2 italic opacity-70">(estimation — pas encore de requête aujourd'hui)</span>
              )}
            </p>
          </div>
          <div className="text-right">
            <div className="text-lg font-bold tabular-nums">{brixPct}%</div>
            <div className="text-[9px] uppercase tracking-wider text-muted-foreground/70 font-semibold">Utilisé</div>
          </div>
        </div>
        <div className="h-2 rounded-full bg-white/5 overflow-hidden">
          <div
            className={`h-full ${brixPct > 80 ? 'bg-rose-500' : brixPct > 50 ? 'bg-amber-500' : 'bg-emerald-500'} transition-all`}
            style={{ width: `${brixPct}%` }}
          />
        </div>
        <div className="mt-3 text-[11px] text-muted-foreground">
          Tiers Aegis : <span className="text-emerald-300 font-mono">{data.tiers.free}</span> req/jour gratuit,
          {' '}<span className="text-amber-300 font-mono">{data.tiers.premium}</span> req/jour premium.
        </div>
      </div>

      {/* Daily timeline */}
      {data.daily.length > 0 && (
        <div className="aegis-card aegis-card-edge p-5">
          <div className="flex items-center gap-2 mb-4">
            <TrendingUp className="w-4 h-4 text-indigo-300" />
            <h3 className="text-sm font-bold text-foreground">Activité journalière</h3>
          </div>
          <div className="flex items-end gap-1 h-24">
            {data.daily.map(d => (
              <div key={d.day} className="flex-1 flex flex-col items-center gap-1 group">
                <div className="w-full bg-white/5 rounded-t-sm relative overflow-hidden" style={{ height: '100%' }}>
                  <div
                    className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-indigo-500 to-violet-400 rounded-t-sm transition-all"
                    style={{ height: `${(d.calls / maxDaily) * 100}%` }}
                    title={`${d.day} : ${d.calls} appels (${d.quota_used} quota)`}
                  />
                </div>
                <span className="text-[9px] font-mono text-muted-foreground/70 truncate max-w-full">
                  {d.day.slice(5)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Per-API table */}
      <Section title="Consommation par API" icon={Server}>
        {data.by_api.length === 0 ? (
          <Empty label="Aucun appel sur la période." />
        ) : (
          <table className="w-full text-xs">
            <thead>
              <tr className="text-[10px] uppercase tracking-wider text-muted-foreground/70 border-b border-white/5">
                <Th>API</Th><Th align="right">Appels</Th><Th align="right">Quota</Th><Th align="right">Cache</Th><Th align="right">Erreurs</Th>
              </tr>
            </thead>
            <tbody>
              {data.by_api.map(row => (
                <tr key={row.api} className="border-b border-white/5 hover:bg-white/[0.02]">
                  <Td><span className="font-mono text-indigo-300">{row.api}</span></Td>
                  <Td align="right">{row.calls}</Td>
                  <Td align="right" className="text-amber-300">{row.quota_used}</Td>
                  <Td align="right" className="text-emerald-300">{row.cache_hits}</Td>
                  <Td align="right" className={row.errors > 0 ? 'text-rose-400' : ''}>{row.errors}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>

      {/* Per-endpoint table */}
      <Section title="Consommation par endpoint" icon={Activity}>
        {data.by_endpoint.length === 0 ? (
          <Empty label="Aucun appel sur la période." />
        ) : (
          <table className="w-full text-xs">
            <thead>
              <tr className="text-[10px] uppercase tracking-wider text-muted-foreground/70 border-b border-white/5">
                <Th>API</Th><Th>Endpoint</Th><Th align="right">Appels</Th><Th align="right">Quota</Th><Th align="right">Cache</Th><Th align="right">Erreurs</Th>
              </tr>
            </thead>
            <tbody>
              {data.by_endpoint.map(row => (
                <tr key={row.api + row.endpoint} className="border-b border-white/5 hover:bg-white/[0.02]">
                  <Td><span className="font-mono text-indigo-300">{row.api}</span></Td>
                  <Td><span className="font-mono">{row.endpoint}</span></Td>
                  <Td align="right">{row.calls}</Td>
                  <Td align="right" className="text-amber-300">{row.quota_used}</Td>
                  <Td align="right" className="text-emerald-300">{row.cache_hits}</Td>
                  <Td align="right" className={row.errors > 0 ? 'text-rose-400' : ''}>{row.errors}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>

      {/* Per-user table */}
      <Section title="Top utilisateurs" icon={UsersIcon}>
        {data.by_user.length === 0 ? (
          <Empty label="Pas d'activité utilisateur sur la période." />
        ) : (
          <table className="w-full text-xs">
            <thead>
              <tr className="text-[10px] uppercase tracking-wider text-muted-foreground/70 border-b border-white/5">
                <Th>Utilisateur</Th><Th>Tier</Th><Th align="right">Appels</Th><Th align="right">Quota consommé</Th>
              </tr>
            </thead>
            <tbody>
              {data.by_user.map(u => {
                const isPrem = !!u.premium_until && u.premium_until > Date.now();
                return (
                  <tr key={u.id} className="border-b border-white/5 hover:bg-white/[0.02]">
                    <Td>
                      <span className="font-semibold">{u.username}</span>
                      {u.is_admin ? <span className="ml-1.5 text-[9px] uppercase text-amber-400 font-bold">admin</span> : null}
                    </Td>
                    <Td>
                      {isPrem ? (
                        <span className="text-[10px] uppercase tracking-wider text-amber-300 font-semibold">Premium</span>
                      ) : (
                        <span className="text-[10px] uppercase tracking-wider text-muted-foreground/70 font-semibold">Gratuit</span>
                      )}
                    </Td>
                    <Td align="right">{u.calls}</Td>
                    <Td align="right" className="text-amber-300">{u.quota_used}</Td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Section>

      {/* Recent calls log */}
      <Section title="Appels récents" icon={Clock}>
        {data.recent.length === 0 ? (
          <Empty label="Aucun appel encore enregistré." />
        ) : (
          <div className="max-h-80 overflow-y-auto">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-black/40 backdrop-blur">
                <tr className="text-[10px] uppercase tracking-wider text-muted-foreground/70 border-b border-white/5">
                  <Th>Date</Th><Th>User</Th><Th>API</Th><Th>Endpoint</Th><Th align="right">Status</Th><Th>Source</Th>
                </tr>
              </thead>
              <tbody>
                {data.recent.map(r => (
                  <tr key={r.id} className="border-b border-white/5 hover:bg-white/[0.02]">
                    <Td className="font-mono text-muted-foreground">{fmtTime(r.created_at)}</Td>
                    <Td>{r.username || <span className="text-muted-foreground/60 italic">supprimé</span>}</Td>
                    <Td><span className="font-mono text-indigo-300">{r.api}</span></Td>
                    <Td><span className="font-mono">{r.endpoint}</span></Td>
                    <Td align="right" className={r.ok ? 'text-emerald-400' : 'text-rose-400'}>{r.status ?? '—'}</Td>
                    <Td>{r.cached
                      ? <span className="text-[10px] uppercase tracking-wider text-emerald-300">Cache</span>
                      : <span className="text-[10px] uppercase tracking-wider text-amber-300">Live</span>}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>
    </div>
  );
}

// ── Helpers ────────────────────────────────────────────────────────────────
const TONES: Record<string, string> = {
  indigo:  'from-indigo-500/30 to-indigo-500/0 ring-indigo-500/30 text-indigo-300',
  amber:   'from-amber-500/30 to-amber-500/0 ring-amber-500/30 text-amber-300',
  emerald: 'from-emerald-500/30 to-emerald-500/0 ring-emerald-500/30 text-emerald-300',
  rose:    'from-rose-500/30 to-rose-500/0 ring-rose-500/30 text-rose-300',
};

function Kpi({ icon: Icon, label, value, tone }: { icon: any; label: string; value: number; tone: keyof typeof TONES | string }) {
  return (
    <div className="aegis-card aegis-card-edge p-4">
      <div className="flex items-center gap-2.5">
        <div className={`w-9 h-9 rounded-lg bg-gradient-to-br ring-1 flex items-center justify-center ${TONES[tone] || TONES.indigo}`}>
          <Icon className="w-4 h-4" />
        </div>
        <div>
          <div className="text-lg font-bold tabular-nums leading-none">{value.toLocaleString('fr-FR')}</div>
          <div className="text-[9px] uppercase tracking-wider text-muted-foreground/70 font-semibold mt-1">{label}</div>
        </div>
      </div>
    </div>
  );
}

function Section({ title, icon: Icon, children }: { title: string; icon: any; children: React.ReactNode }) {
  return (
    <div className="aegis-card aegis-card-edge overflow-hidden">
      <div className="px-5 py-3 border-b border-white/5 flex items-center gap-2">
        <Icon className="w-4 h-4 text-muted-foreground" />
        <h3 className="text-sm font-bold text-foreground">{title}</h3>
      </div>
      <div className="px-5 py-3">{children}</div>
    </div>
  );
}

function Empty({ label }: { label: string }) {
  return <p className="text-xs text-muted-foreground italic py-4 text-center">{label}</p>;
}

function Th({ children, align = 'left' }: { children: React.ReactNode; align?: 'left' | 'right' }) {
  return <th className={`px-2 py-2 font-semibold ${align === 'right' ? 'text-right' : 'text-left'}`}>{children}</th>;
}

function Td({ children, align = 'left', className = '' }: { children: React.ReactNode; align?: 'left' | 'right'; className?: string }) {
  return <td className={`px-2 py-2 ${align === 'right' ? 'text-right' : 'text-left'} ${className}`}>{children}</td>;
}
