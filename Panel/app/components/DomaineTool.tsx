import { useState } from 'react';
import { Search, Loader2, Copy, Check, MapPin, Globe, Database, Network, Server } from 'lucide-react';
import { toast } from 'sonner';

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

async function fetchDns(domain: string): Promise<string> {
  const lines: string[] = [];
  const results = await Promise.all(DNS_TYPES.map(async t => ({ t, j: await dohQuery(domain, t).catch(() => null) })));
  for (const { t, j } of results) {
    if (!j || !j.Answer || j.Answer.length === 0) continue;
    lines.push(`── ${t} ──`);
    for (const a of j.Answer) lines.push(`${a.name.padEnd(40)} ${String(a.TTL).padStart(6)}  ${a.data}`);
    lines.push('');
  }
  return lines.length ? lines.join('\n') : 'Aucun enregistrement DNS trouvé';
}

async function fetchWhois(domain: string): Promise<string> {
  const r = await fetch(`https://rdap.org/domain/${encodeURIComponent(domain)}`);
  if (!r.ok) throw new Error(`RDAP HTTP ${r.status} — domaine introuvable ou TLD non supporté`);
  const j: any = await r.json();
  const lines: string[] = [];
  lines.push(`Domaine        : ${j.ldhName || domain}`);
  if (j.handle)     lines.push(`Handle         : ${j.handle}`);
  if (j.status)     lines.push(`Statut         : ${(j.status as string[]).join(', ')}`);
  for (const ev of j.events || []) {
    const date = ev.eventDate ? new Date(ev.eventDate).toLocaleString('fr-FR') : '?';
    lines.push(`${(ev.eventAction as string).padEnd(15)}: ${date}`);
  }
  const ns = (j.nameservers || []).map((n: any) => n.ldhName).filter(Boolean);
  if (ns.length) { lines.push('', 'Nameservers:'); for (const n of ns) lines.push(`  ${n}`); }
  for (const e of j.entities || []) {
    const roles = (e.roles || []).join(', ');
    const vcard = e.vcardArray?.[1] || [];
    const fn = vcard.find((v: any[]) => v[0] === 'fn')?.[3];
    if (fn) lines.push('', `${roles}: ${fn}`);
  }
  return lines.join('\n');
}

async function fetchSubdomains(domain: string): Promise<string> {
  const r = await fetch(`https://crt.sh/?q=${encodeURIComponent('%.' + domain)}&output=json`);
  if (!r.ok) throw new Error(`crt.sh HTTP ${r.status}`);
  const j = await r.json() as { name_value: string }[];
  const set = new Set<string>();
  for (const row of j) for (const n of String(row.name_value).split(/\n/)) {
    const v = n.trim().toLowerCase();
    if (v && !v.startsWith('*') && v.endsWith(domain.toLowerCase())) set.add(v);
  }
  const list = [...set].sort();
  return list.length ? list.join('\n') : 'Aucun sous-domaine trouvé dans les CT logs';
}

async function fetchReverse(ip: string): Promise<string> {
  const parts = ip.split('.');
  if (parts.length !== 4) throw new Error('IPv4 attendue (ex: 8.8.8.8)');
  const arpa = parts.reverse().join('.') + '.in-addr.arpa';
  const j = await dohQuery(arpa, 'PTR');
  if (!j.Answer || !j.Answer.length) return 'Aucun PTR record';
  return j.Answer.map(a => a.data.replace(/\.$/, '')).join('\n');
}

interface IPInfo {
  ip: string;
  type: string;
  success: boolean;
  city?: string;
  region?: string;
  country?: string;
  country_code?: string;
  continent?: string;
  latitude?: number;
  longitude?: number;
  is_eu?: boolean;
  postal?: string;
  calling_code?: string;
  capital?: string;
  borders?: string;
  flag?: { emoji: string; img: string };
  connection?: { asn: number; org: string; isp: string; domain: string };
  timezone?: { id: string; abbr: string; utc: string; current_time: string };
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
  const [result, setResult]         = useState<string | IPInfo | null>(null);
  const [copied, setCopied]         = useState(false);

  const current = TOOLS.find(t => t.id === activeTool)!;

  const run = async () => {
    if (!input.trim() || loading) return;
    setLoading(true);
    setResult(null);
    try {
      const q = input.trim();

      if (activeTool === 'ip') {
        const res  = await fetch(`https://ipwho.is/${encodeURIComponent(q)}`);
        const json = await res.json() as IPInfo;
        if (!json.success) throw new Error((json as any).message || 'IP introuvable');
        setResult(json);
      } else {
        let text: string;
        if      (activeTool === 'dns')        text = await fetchDns(q);
        else if (activeTool === 'whois')      text = await fetchWhois(q);
        else if (activeTool === 'subdomains') text = await fetchSubdomains(q);
        else if (activeTool === 'reverse')    text = await fetchReverse(q);
        else throw new Error('outil inconnu');
        setResult(text);
      }
      toast.success('Recherche terminée');
    } catch (e: any) {
      toast.error('Erreur', { description: e.message });
      setResult('⚠ ' + e.message);
    } finally {
      setLoading(false);
    }
  };

  const copy = () => {
    const text = typeof result === 'string' ? result : JSON.stringify(result, null, 2);
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

      {/* IP Lookup result (structured) */}
      {activeTool === 'ip' && result && typeof result === 'object' && (
        <div className="bg-card border border-border rounded-lg overflow-hidden">
          <div className="px-6 py-4 border-b border-border flex items-center justify-between">
            <div className="flex items-center gap-3">
              {result.flag?.emoji && <span className="text-2xl">{result.flag.emoji}</span>}
              <div>
                <p className="font-mono text-foreground font-medium">{result.ip}</p>
                <p className="text-xs text-muted-foreground">{result.type}</p>
              </div>
            </div>
            <button onClick={copy} className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors">
              {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}{copied ? 'Copié' : 'Copier'}
            </button>
          </div>

          <div className="grid md:grid-cols-2 gap-x-8 px-6 py-4">
            <div>
              <p className="text-xs uppercase tracking-wider text-muted-foreground font-semibold mb-2 mt-2">Localisation</p>
              <Row label="Pays"          value={`${result.country || ''} (${result.country_code || ''})`} />
              <Row label="Région"        value={result.region || ''} />
              <Row label="Ville"         value={result.city || ''} />
              <Row label="Code postal"   value={result.postal || ''} />
              <Row label="Continent"     value={result.continent || ''} />
              <Row label="Coordonnées"   value={result.latitude && result.longitude ? `${result.latitude}, ${result.longitude}` : ''} />
              <Row label="Capitale"      value={result.capital || ''} />
              <Row label="Indicatif tél" value={result.calling_code ? `+${result.calling_code}` : ''} />
            </div>
            <div>
              <p className="text-xs uppercase tracking-wider text-muted-foreground font-semibold mb-2 mt-2">Connexion</p>
              <Row label="ASN"           value={result.connection?.asn ? `AS${result.connection.asn}` : ''} />
              <Row label="Organisation"  value={result.connection?.org || ''} />
              <Row label="ISP"           value={result.connection?.isp || ''} />
              <Row label="Domaine"       value={result.connection?.domain || ''} />

              <p className="text-xs uppercase tracking-wider text-muted-foreground font-semibold mb-2 mt-6">Fuseau horaire</p>
              <Row label="Fuseau"        value={result.timezone?.id || ''} />
              <Row label="UTC"           value={result.timezone?.utc || ''} />
              <Row label="Heure locale"  value={result.timezone?.current_time || ''} />
            </div>
          </div>

          {result.latitude && result.longitude && (
            <div className="px-6 pb-6 pt-2">
              <a
                href={`https://www.openstreetmap.org/?mlat=${result.latitude}&mlon=${result.longitude}#map=12/${result.latitude}/${result.longitude}`}
                target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-sm text-foreground hover:text-muted-foreground border border-border rounded-md px-3 py-1.5 hover:bg-muted transition-colors"
              >
                <MapPin className="w-3.5 h-3.5" />
                Voir sur OpenStreetMap
              </a>
            </div>
          )}
        </div>
      )}

      {/* Text-based results (DNS, WHOIS, subdomains, reverse) */}
      {activeTool !== 'ip' && result && typeof result === 'string' && (
        <div className="bg-card border border-border rounded-lg overflow-hidden">
          <div className="px-6 py-3 border-b border-border flex items-center justify-between">
            <span className="text-sm text-foreground font-medium">
              {current.label} <span className="text-muted-foreground font-mono ml-2">{input}</span>
            </span>
            <button onClick={copy} className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors">
              {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}{copied ? 'Copié' : 'Copier'}
            </button>
          </div>
          <pre className="text-xs text-foreground/90 font-mono whitespace-pre-wrap p-6 max-h-[480px] overflow-y-auto leading-relaxed">
            {result}
          </pre>
          {(activeTool === 'subdomains' || activeTool === 'reverse') && (
            <div className="px-6 py-3 border-t border-border text-xs text-muted-foreground">
              {result.split('\n').filter(l => l.trim()).length} ligne{result.split('\n').filter(l => l.trim()).length > 1 ? 's' : ''} trouvée{result.split('\n').filter(l => l.trim()).length > 1 ? 's' : ''}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
