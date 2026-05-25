import { useState } from 'react';
import { Search, Loader2, Copy, Check, MapPin, Globe, Database, Network, Server, ExternalLink } from 'lucide-react';
import { toast } from 'sonner';

const API_URL   = ((import.meta as any).env?.VITE_WATCHER_API_URL  as string) || 'http://localhost:8787';
const API_TOKEN = ((import.meta as any).env?.VITE_WATCHER_API_TOKEN as string) || '';

async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(API_URL + path, {
    headers: { Authorization: `Bearer ${API_TOKEN}` },
  });
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try { msg = (await res.json()).error || msg; } catch {}
    throw new Error(msg);
  }
  return res.json() as Promise<T>;
}

const TOOLS = [
  { id: 'ip',         label: 'IP Lookup',     icon: MapPin,   placeholder: '8.8.8.8',          desc: 'Géolocalisation, ASN, organisation, ISP (ipwho.is)' },
  { id: 'dns',        label: 'DNS Records',   icon: Globe,    placeholder: 'example.com',      desc: 'Enregistrements DNS A/AAAA/MX/NS/TXT/SOA/CNAME (Cloudflare DoH)' },
  { id: 'whois',      label: 'WHOIS / RDAP',   icon: Database, placeholder: 'example.com',      desc: 'Registrar, dates, statut, nameservers (RDAP — protocole moderne WHOIS)' },
  { id: 'subdomains', label: 'Sous-domaines', icon: Network,  placeholder: 'example.com',      desc: 'Énumération via Certificate Transparency logs (crt.sh)' },
  { id: 'reverse',    label: 'Reverse DNS',    icon: Server,   placeholder: '8.8.8.8',          desc: 'PTR record (Cloudflare DoH)' },
];

// ── Free providers (no API key) ─────────────────────────────────────────────
const DNS_TYPES = ['A', 'AAAA', 'MX', 'NS', 'TXT', 'SOA', 'CNAME'];

async function dohQuery(name: string, type: string) {
  const r = await fetch(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(name)}&type=${type}`, {
    headers: { Accept: 'application/dns-json' },
  });
  if (!r.ok) throw new Error(`DoH ${type} HTTP ${r.status}`);
  return r.json() as Promise<{ Status: number; Answer?: { name: string; type: number; TTL: number; data: string }[] }>;
}

interface DnsRecord { name: string; ttl: number; data: string }
interface DnsResult { domain: string; groups: { type: string; records: DnsRecord[] }[] }

async function fetchDns(domain: string): Promise<DnsResult> {
  const results = await Promise.all(DNS_TYPES.map(async t => ({ t, j: await dohQuery(domain, t).catch(() => null) })));
  const groups: DnsResult['groups'] = [];
  for (const { t, j } of results) {
    if (!j || !j.Answer || j.Answer.length === 0) continue;
    groups.push({
      type: t,
      records: j.Answer.map(a => ({ name: a.name, ttl: a.TTL, data: a.data })),
    });
  }
  return { domain, groups };
}

interface WhoisResult {
  domain: string;
  handle?: string;
  status?: string[];
  events: { action: string; date: string }[];
  nameservers: string[];
  entities: { roles: string; name: string }[];
}

async function fetchWhois(domain: string): Promise<WhoisResult> {
  const r = await fetch(`https://rdap.org/domain/${encodeURIComponent(domain)}`);
  if (!r.ok) throw new Error(`RDAP HTTP ${r.status} — domaine introuvable ou TLD non supporté`);
  const j: any = await r.json();
  return {
    domain:      j.ldhName || domain,
    handle:      j.handle,
    status:      Array.isArray(j.status) ? j.status : undefined,
    events: (j.events || []).map((ev: any) => ({
      action: String(ev.eventAction || ''),
      date:   ev.eventDate ? new Date(ev.eventDate).toLocaleString('fr-FR') : '?',
    })),
    nameservers: (j.nameservers || []).map((n: any) => n.ldhName).filter(Boolean),
    entities: (j.entities || []).map((e: any) => {
      const roles = (e.roles || []).join(', ');
      const vcard = e.vcardArray?.[1] || [];
      const fn = vcard.find((v: any[]) => v[0] === 'fn')?.[3] || '';
      return { roles, name: fn };
    }).filter((e: any) => e.name),
  };
}

async function fetchSubdomains(domain: string): Promise<string[]> {
  const r = await fetch(`https://crt.sh/?q=${encodeURIComponent('%.' + domain)}&output=json`);
  if (!r.ok) throw new Error(`crt.sh HTTP ${r.status}`);
  const j = await r.json() as { name_value: string }[];
  const set = new Set<string>();
  for (const row of j) for (const n of String(row.name_value).split(/\n/)) {
    const v = n.trim().toLowerCase();
    if (v && !v.startsWith('*') && v.endsWith(domain.toLowerCase())) set.add(v);
  }
  return [...set].sort();
}

async function fetchReverse(ip: string): Promise<string[]> {
  const parts = ip.split('.');
  if (parts.length !== 4) throw new Error('IPv4 attendue (ex: 8.8.8.8)');
  const arpa = parts.reverse().join('.') + '.in-addr.arpa';
  const j = await dohQuery(arpa, 'PTR');
  if (!j.Answer || !j.Answer.length) return [];
  return j.Answer.map(a => a.data.replace(/\.$/, ''));
}

interface IPInfo {
  provider: string;
  ip: string;
  type?: string;
  city?: string;
  region?: string;
  country?: string;
  country_code?: string;
  continent?: string;
  latitude?: number;
  longitude?: number;
  postal?: string;
  flag_emoji?: string;
  asn?: number;
  org?: string;
  isp?: string;
  domain?: string;
  timezone?: string;
  utc_offset?: string;
  local_time?: string;
  calling_code?: string;
  capital?: string;
}

function Row({ label, value }: { label: string; value: string | number }) {
  if (value == null || value === '') return null;
  return (
    <div className="flex items-start justify-between py-2.5 border-b border-border last:border-0 gap-4">
      <span className="text-muted-foreground text-sm shrink-0">{label}</span>
      <span className="text-foreground text-sm flex-1 text-right break-all font-mono">{String(value)}</span>
    </div>
  );
}

export function DomaineTool() {
  const [activeTool, setActiveTool] = useState('ip');
  const [input, setInput]           = useState('');
  const [loading, setLoading]       = useState(false);
  type ResultType =
    | { kind: 'ip'; data: IPInfo }
    | { kind: 'dns'; data: DnsResult }
    | { kind: 'whois'; data: WhoisResult }
    | { kind: 'list'; data: string[] }
    | { kind: 'error'; message: string };
  const [result, setResult]         = useState<ResultType | null>(null);
  const [copied, setCopied]         = useState(false);

  const current = TOOLS.find(t => t.id === activeTool)!;

  const run = async () => {
    if (!input.trim() || loading) return;
    setLoading(true);
    setResult(null);
    try {
      const q = input.trim();

      if (activeTool === 'ip') {
        const json = await apiGet<{ ok: boolean; data: IPInfo; error?: string }>(`/api/ip-lookup/${encodeURIComponent(q)}`);
        if (!json.ok || !json.data) throw new Error(json.error || 'IP introuvable');
        setResult({ kind: 'ip', data: json.data });
      } else if (activeTool === 'dns') {
        setResult({ kind: 'dns', data: await fetchDns(q) });
      } else if (activeTool === 'whois') {
        setResult({ kind: 'whois', data: await fetchWhois(q) });
      } else if (activeTool === 'subdomains') {
        setResult({ kind: 'list', data: await fetchSubdomains(q) });
      } else if (activeTool === 'reverse') {
        setResult({ kind: 'list', data: await fetchReverse(q) });
      } else throw new Error('outil inconnu');
      toast.success('Recherche terminée');
    } catch (e: any) {
      toast.error('Erreur', { description: e.message });
      setResult({ kind: 'error', message: e.message });
    } finally {
      setLoading(false);
    }
  };

  const copy = () => {
    if (!result) return;
    let text = '';
    if (result.kind === 'ip')          text = JSON.stringify(result.data, null, 2);
    else if (result.kind === 'dns')    text = result.data.groups.flatMap(g => g.records.map(r => `${g.type.padEnd(6)} ${r.name.padEnd(40)} ${String(r.ttl).padStart(6)} ${r.data}`)).join('\n');
    else if (result.kind === 'whois')  text = JSON.stringify(result.data, null, 2);
    else if (result.kind === 'list')   text = result.data.join('\n');
    else                                text = result.message;
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="space-y-6">
      {/* Tabs */}
      <div className="flex gap-2 flex-wrap">
        {TOOLS.map(t => {
          const Icon = t.icon;
          return (
            <button key={t.id} onClick={() => { setActiveTool(t.id); setResult(null); setInput(''); }}
              className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm transition-all border ${
                activeTool === t.id ? 'bg-primary/10 text-primary border-primary/40' : 'bg-secondary/20 text-foreground border-border hover:bg-secondary'
              }`}>
              <Icon className="w-3.5 h-3.5" />{t.label}
            </button>
          );
        })}
      </div>

      <p className="text-xs text-muted-foreground px-1">{current.desc}</p>

      {/* Input */}
      <div className="bg-card border border-border rounded-lg p-6">
        <div className="flex gap-3">
          <input value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && run()}
            placeholder={current.placeholder}
            className="flex-1 bg-input border border-border rounded-md px-4 py-2.5 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary font-mono text-sm" />
          <button onClick={run} disabled={loading}
            className="bg-primary hover:bg-primary/90 disabled:opacity-60 disabled:cursor-not-allowed text-primary-foreground px-6 py-2.5 rounded-md flex items-center gap-2 whitespace-nowrap">
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
            {loading ? 'Recherche...' : 'Lancer'}
          </button>
        </div>
      </div>

      {/* Error */}
      {result?.kind === 'error' && (
        <div className="aegis-card aegis-card-edge p-5 flex items-start gap-3 border-rose-500/30">
          <div className="w-8 h-8 rounded-lg bg-rose-500/10 ring-1 ring-rose-500/30 flex items-center justify-center flex-shrink-0">
            <Server className="w-4 h-4 text-rose-400" />
          </div>
          <div>
            <p className="text-sm font-semibold text-foreground">Erreur</p>
            <p className="text-xs text-muted-foreground mt-0.5">{result.message}</p>
          </div>
        </div>
      )}

      {/* IP Lookup */}
      {result?.kind === 'ip' && (
        <IPResultCard ip={result.data} onCopy={copy} copied={copied} />
      )}

      {/* DNS Records */}
      {result?.kind === 'dns' && (
        <DnsResultCard result={result.data} onCopy={copy} copied={copied} />
      )}

      {/* WHOIS / RDAP */}
      {result?.kind === 'whois' && (
        <WhoisResultCard result={result.data} onCopy={copy} copied={copied} />
      )}

      {/* Subdomains / Reverse — list */}
      {result?.kind === 'list' && (
        <ListResultCard
          title={current.label}
          input={input}
          items={result.data}
          onCopy={copy}
          copied={copied}
          itemIcon={activeTool === 'subdomains' ? Globe : Server}
          tone={activeTool === 'subdomains' ? 'violet' : 'cyan'}
          emptyText={activeTool === 'subdomains' ? 'Aucun sous-domaine trouvé dans les CT logs' : 'Aucun PTR record'}
        />
      )}
    </div>
  );
}

// ── Result cards ───────────────────────────────────────────────────────────
function IPResultCard({ ip: r, onCopy, copied }: { ip: IPInfo; onCopy: () => void; copied: boolean }) {
  return (
    <div className="aegis-card aegis-card-edge overflow-hidden">
      <div className="relative px-6 py-5 border-b border-white/5 overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-cyan-500/10 via-transparent to-violet-500/5 pointer-events-none" />
        <div className="relative flex items-center gap-4">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-cyan-500/30 to-cyan-500/10 ring-1 ring-cyan-500/40 text-cyan-300 font-bold flex items-center justify-center text-2xl flex-shrink-0 shadow-lg shadow-cyan-500/20">
            {r.flag_emoji || '🌐'}
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-foreground font-bold text-xl tracking-tight font-mono truncate">{r.ip}</h2>
            <div className="flex items-center gap-3 mt-1 flex-wrap">
              {r.type && <span className="text-[10px] uppercase tracking-wider text-cyan-400 font-semibold px-1.5 py-0.5 rounded bg-cyan-500/10 border border-cyan-500/20">{r.type}</span>}
              {r.country && <span className="text-xs text-muted-foreground flex items-center gap-1"><Globe className="w-3 h-3" /> {r.country}{r.country_code && <span className="text-muted-foreground/60">· {r.country_code}</span>}</span>}
              {r.city && <span className="text-xs text-muted-foreground flex items-center gap-1"><MapPin className="w-3 h-3" /> {[r.city, r.region].filter(Boolean).join(', ')}</span>}
              <span className="text-[10px] text-muted-foreground/60 ml-auto">via {r.provider}</span>
            </div>
          </div>
          <button onClick={onCopy} title="Copier en JSON"
            className="border border-white/10 hover:bg-white/5 hover:border-white/20 text-muted-foreground hover:text-foreground p-2 rounded-lg transition-all">
            {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>

      <div className="px-6 py-5 grid gap-5 md:grid-cols-2">
        <IPSection title="Localisation" icon={MapPin} tone="cyan">
          <KV label="Pays"          value={r.country} hint={r.country_code} />
          <KV label="Région"        value={r.region} />
          <KV label="Ville"         value={r.city} />
          <KV label="Code postal"   value={r.postal} mono />
          <KV label="Continent"     value={r.continent} />
          <KV label="Coordonnées"   value={r.latitude && r.longitude ? `${r.latitude}, ${r.longitude}` : null} mono />
          <KV label="Capitale"      value={r.capital} />
          <KV label="Indicatif tél" value={r.calling_code ? `+${r.calling_code}` : null} mono />
        </IPSection>

        <IPSection title="Connexion" icon={Network} tone="violet">
          <KV label="ASN"          value={r.asn ? `AS${r.asn}` : null} mono />
          <KV label="Organisation" value={r.org} />
          <KV label="ISP"          value={r.isp} />
          <KV label="Domaine"      value={r.domain} mono />
          <KV label="Fuseau"       value={r.timezone} mono />
          <KV label="UTC"          value={r.utc_offset} mono />
          <KV label="Heure locale" value={r.local_time} mono />
        </IPSection>
      </div>

      {r.latitude && r.longitude && (
        <div className="px-6 pb-5 -mt-2 flex gap-2">
          <a href={`https://www.openstreetmap.org/?mlat=${r.latitude}&mlon=${r.longitude}#map=12/${r.latitude}/${r.longitude}`}
            target="_blank" rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-xs border border-white/10 hover:bg-white/5 hover:border-white/20 text-foreground rounded-lg px-3 py-1.5 transition-all">
            <MapPin className="w-3.5 h-3.5" /> OpenStreetMap <ExternalLink className="w-3 h-3 opacity-60" />
          </a>
          <a href={`https://www.google.com/maps/@${r.latitude},${r.longitude},12z`}
            target="_blank" rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-xs border border-white/10 hover:bg-white/5 hover:border-white/20 text-foreground rounded-lg px-3 py-1.5 transition-all">
            <MapPin className="w-3.5 h-3.5" /> Google Maps <ExternalLink className="w-3 h-3 opacity-60" />
          </a>
        </div>
      )}
    </div>
  );
}

const DNS_TONES: Record<string, string> = {
  A: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20',
  AAAA: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20',
  MX: 'text-amber-400 bg-amber-500/10 border-amber-500/20',
  NS: 'text-violet-400 bg-violet-500/10 border-violet-500/20',
  TXT: 'text-cyan-400 bg-cyan-500/10 border-cyan-500/20',
  SOA: 'text-rose-400 bg-rose-500/10 border-rose-500/20',
  CNAME: 'text-indigo-400 bg-indigo-500/10 border-indigo-500/20',
};

function DnsResultCard({ result, onCopy, copied }: { result: DnsResult; onCopy: () => void; copied: boolean }) {
  const total = result.groups.reduce((acc, g) => acc + g.records.length, 0);
  return (
    <div className="aegis-card aegis-card-edge overflow-hidden">
      <div className="px-6 py-4 border-b border-white/5 flex items-center gap-3">
        <div className="w-9 h-9 rounded-lg bg-violet-500/10 ring-1 ring-violet-500/30 flex items-center justify-center">
          <Globe className="w-4 h-4 text-violet-400" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-foreground truncate">{result.domain}</p>
          <p className="text-[11px] text-muted-foreground">
            <span className="text-foreground tabular-nums">{total}</span> enregistrement{total > 1 ? 's' : ''} · <span className="text-foreground tabular-nums">{result.groups.length}</span> type{result.groups.length > 1 ? 's' : ''}
          </p>
        </div>
        <button onClick={onCopy} className="border border-white/10 hover:bg-white/5 hover:border-white/20 text-muted-foreground hover:text-foreground p-2 rounded-lg transition-all">
          {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
        </button>
      </div>

      {result.groups.length === 0 ? (
        <div className="p-10 text-center text-sm text-muted-foreground">Aucun enregistrement DNS</div>
      ) : (
        <div className="divide-y divide-white/5">
          {result.groups.map(g => (
            <div key={g.type} className="px-6 py-4">
              <div className="flex items-center gap-2 mb-2.5">
                <span className={`text-[10px] uppercase tracking-wider font-bold px-2 py-0.5 rounded border ${DNS_TONES[g.type] || 'text-foreground bg-white/5 border-white/10'}`}>
                  {g.type}
                </span>
                <span className="text-[11px] text-muted-foreground">{g.records.length} entrée{g.records.length > 1 ? 's' : ''}</span>
              </div>
              <div className="space-y-1">
                {g.records.map((rec, i) => (
                  <div key={i} className="flex items-center gap-3 px-3 py-2 rounded-md bg-white/[0.02] hover:bg-white/[0.04] border border-white/5 text-xs">
                    <span className="font-mono text-muted-foreground/80 truncate flex-shrink-0 w-48">{rec.name.replace(/\.$/, '')}</span>
                    <span className="text-[10px] text-muted-foreground/60 tabular-nums w-14 flex-shrink-0">TTL {rec.ttl}</span>
                    <span className="font-mono text-foreground flex-1 break-all">{rec.data}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function WhoisResultCard({ result, onCopy, copied }: { result: WhoisResult; onCopy: () => void; copied: boolean }) {
  return (
    <div className="aegis-card aegis-card-edge overflow-hidden">
      <div className="px-6 py-4 border-b border-white/5 flex items-center gap-3">
        <div className="w-9 h-9 rounded-lg bg-rose-500/10 ring-1 ring-rose-500/30 flex items-center justify-center">
          <Database className="w-4 h-4 text-rose-400" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-foreground truncate">{result.domain}</p>
          {result.handle && <p className="text-[11px] text-muted-foreground font-mono">handle: {result.handle}</p>}
        </div>
        <button onClick={onCopy} className="border border-white/10 hover:bg-white/5 hover:border-white/20 text-muted-foreground hover:text-foreground p-2 rounded-lg transition-all">
          {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
        </button>
      </div>

      <div className="px-6 py-5 grid gap-5 md:grid-cols-2">
        {result.status && result.status.length > 0 && (
          <IPSection title="Statut" icon={Server} tone="cyan">
            <div className="px-3 py-2 flex flex-wrap gap-1.5">
              {result.status.map((s, i) => (
                <span key={i} className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 font-mono">{s}</span>
              ))}
            </div>
          </IPSection>
        )}

        {result.events.length > 0 && (
          <IPSection title="Événements" icon={Database} tone="violet">
            {result.events.map((ev, i) => <KV key={i} label={ev.action} value={ev.date} mono />)}
          </IPSection>
        )}

        {result.nameservers.length > 0 && (
          <div className="md:col-span-2">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-6 h-6 rounded-md bg-cyan-500/10 ring-1 ring-cyan-500/30 flex items-center justify-center">
                <Network className="w-3 h-3 text-cyan-400" />
              </div>
              <h3 className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">Nameservers</h3>
              <span className="text-[10px] text-muted-foreground/60">{result.nameservers.length}</span>
              <div className="flex-1 h-px bg-white/5" />
            </div>
            <div className="grid gap-1.5 sm:grid-cols-2">
              {result.nameservers.map((n, i) => (
                <div key={i} className="px-3 py-2 rounded-md bg-white/[0.02] border border-white/5 text-xs font-mono text-foreground">{n}</div>
              ))}
            </div>
          </div>
        )}

        {result.entities.length > 0 && (
          <div className="md:col-span-2">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-6 h-6 rounded-md bg-amber-500/10 ring-1 ring-amber-500/30 flex items-center justify-center">
                <Server className="w-3 h-3 text-amber-400" />
              </div>
              <h3 className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">Entités</h3>
              <div className="flex-1 h-px bg-white/5" />
            </div>
            <div className="rounded-lg bg-white/[0.02] border border-white/5 divide-y divide-white/5">
              {result.entities.map((e, i) => (
                <div key={i} className="px-3 py-2 flex items-center gap-3 text-xs">
                  <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold w-24 flex-shrink-0">{e.roles}</span>
                  <span className="text-foreground flex-1">{e.name}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function ListResultCard({ title, input, items, onCopy, copied, itemIcon: Icon, tone, emptyText }: {
  title: string; input: string; items: string[]; onCopy: () => void; copied: boolean;
  itemIcon: any; tone: 'cyan' | 'violet'; emptyText: string;
}) {
  const t = IP_TONES[tone];
  return (
    <div className="aegis-card aegis-card-edge overflow-hidden">
      <div className="px-6 py-4 border-b border-white/5 flex items-center gap-3">
        <div className={`w-9 h-9 rounded-lg ${t.bg} ring-1 ${t.ring} flex items-center justify-center`}>
          <Icon className={`w-4 h-4 ${t.text}`} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-foreground truncate">{title}</p>
          <p className="text-[11px] text-muted-foreground font-mono truncate">{input}</p>
        </div>
        <span className="text-xs text-muted-foreground tabular-nums">{items.length}</span>
        <button onClick={onCopy} className="border border-white/10 hover:bg-white/5 hover:border-white/20 text-muted-foreground hover:text-foreground p-2 rounded-lg transition-all">
          {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
        </button>
      </div>
      {items.length === 0 ? (
        <div className="p-10 text-center text-sm text-muted-foreground">{emptyText}</div>
      ) : (
        <div className="p-3 grid gap-1.5 sm:grid-cols-2 max-h-[480px] overflow-y-auto">
          {items.map((line, i) => (
            <div key={i} className="px-3 py-2 rounded-md bg-white/[0.02] hover:bg-white/[0.04] border border-white/5 text-xs font-mono text-foreground flex items-center gap-2">
              <Icon className={`w-3 h-3 ${t.text} flex-shrink-0`} />
              <span className="truncate">{line}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Visual sub-components ──────────────────────────────────────────────────
const IP_TONES: Record<string, { bg: string; ring: string; text: string }> = {
  cyan:   { bg: 'bg-cyan-500/10',   ring: 'ring-cyan-500/30',   text: 'text-cyan-400' },
  violet: { bg: 'bg-violet-500/10', ring: 'ring-violet-500/30', text: 'text-violet-400' },
};

function IPSection({ title, icon: Icon, tone, children }: {
  title: string; icon: any; tone: keyof typeof IP_TONES; children: React.ReactNode;
}) {
  const t = IP_TONES[tone];
  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        <div className={`w-6 h-6 rounded-md ${t.bg} ring-1 ${t.ring} flex items-center justify-center flex-shrink-0`}>
          <Icon className={`w-3 h-3 ${t.text}`} />
        </div>
        <h3 className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">{title}</h3>
        <div className="flex-1 h-px bg-white/5" />
      </div>
      <div className="rounded-lg bg-white/[0.02] border border-white/5 divide-y divide-white/5">
        {children}
      </div>
    </div>
  );
}

function KV({ label, value, hint, mono }: {
  label: string;
  value: string | number | null | undefined;
  hint?: string | null;
  mono?: boolean;
}) {
  const has = value != null && value !== '';
  return (
    <div className="flex items-start justify-between gap-3 px-3 py-2">
      <span className="text-[11px] text-muted-foreground/80 font-medium pt-0.5 flex-shrink-0">{label}</span>
      <span className={`text-xs flex-1 text-right break-all ${has ? 'text-foreground' : 'text-muted-foreground/40'} ${mono ? 'font-mono' : ''}`}>
        {has ? String(value) : '—'}
        {hint && has && <span className="text-muted-foreground/50 ml-1.5 font-normal">· {hint}</span>}
      </span>
    </div>
  );
}
