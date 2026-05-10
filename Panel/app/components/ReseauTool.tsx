import { useState } from 'react';
import { Search, Loader2, Copy, Check, Wifi, Shield, Route, Zap } from 'lucide-react';
import { toast } from 'sonner';

const TOOLS = [
  { id: 'ping',   label: 'HTTP Ping',     icon: Zap,    placeholder: 'example.com',              desc: 'Mesure la latence HTTP (5 requêtes HEAD) — alternative browser à ICMP' },
  { id: 'ports',  label: 'Scan Ports',    icon: Wifi,   placeholder: 'example.com',              desc: 'Sonde les ports HTTP/HTTPS courants depuis le navigateur (limité aux ports web)' },
  { id: 'asn',    label: 'AS / Réseau',   icon: Route,  placeholder: '8.8.8.8 ou example.com',  desc: 'Préfixe BGP, ASN et réseau (RIPEstat) — alternative browser à traceroute' },
  { id: 'ssl',    label: 'SSL / Certs',   icon: Shield, placeholder: 'example.com',              desc: 'Historique des certificats SSL/TLS via Certificate Transparency (crt.sh)' },
];

const COMMON_PORTS: { port: number; proto: 'http' | 'https'; name: string }[] = [
  { port: 80,    proto: 'http',  name: 'HTTP' },
  { port: 443,   proto: 'https', name: 'HTTPS' },
  { port: 8080,  proto: 'http',  name: 'HTTP-alt' },
  { port: 8443,  proto: 'https', name: 'HTTPS-alt' },
  { port: 3000,  proto: 'http',  name: 'Dev' },
  { port: 5000,  proto: 'http',  name: 'Dev' },
  { port: 8000,  proto: 'http',  name: 'HTTP-alt' },
  { port: 8888,  proto: 'http',  name: 'HTTP-alt' },
];

const PING_SAMPLES = 5;
const PORT_TIMEOUT_MS = 3500;

async function httpPing(host: string): Promise<string> {
  const clean = host.replace(/^https?:\/\//, '').split('/')[0];
  const url   = `https://${clean}/?_=${Date.now()}`;
  const samples: number[] = [];
  let fails = 0;
  for (let i = 0; i < PING_SAMPLES; i++) {
    const t0 = performance.now();
    try {
      await fetch(url + i, { method: 'HEAD', mode: 'no-cors', cache: 'no-store' });
      samples.push(performance.now() - t0);
    } catch {
      fails++;
    }
    await new Promise(r => setTimeout(r, 200));
  }
  if (samples.length === 0) return `Aucune réponse — ${clean} injoignable en HTTPS depuis le navigateur (peut-être bloqué par CORS strict, mais un échec total indique un host down)`;
  const min = Math.min(...samples);
  const max = Math.max(...samples);
  const avg = samples.reduce((a, b) => a + b, 0) / samples.length;
  const lines = [
    `Cible    : ${clean}`,
    `Méthode  : HTTPS HEAD (${PING_SAMPLES} requêtes)`,
    `Reçues   : ${samples.length}/${PING_SAMPLES}${fails ? `  (${fails} timeout)` : ''}`,
    '',
    `min  = ${min.toFixed(1)} ms`,
    `avg  = ${avg.toFixed(1)} ms`,
    `max  = ${max.toFixed(1)} ms`,
    '',
    'Échantillons :',
    ...samples.map((s, i) => `  #${i + 1}  ${s.toFixed(1)} ms`),
  ];
  return lines.join('\n');
}

async function checkPort(host: string, port: number, proto: 'http' | 'https'): Promise<{ open: boolean; ms: number }> {
  const url = `${proto}://${host}:${port}/?_=${Date.now()}`;
  const t0  = performance.now();
  try {
    await Promise.race([
      fetch(url, { method: 'HEAD', mode: 'no-cors', cache: 'no-store' }),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error('timeout')), PORT_TIMEOUT_MS)),
    ]);
    return { open: true, ms: performance.now() - t0 };
  } catch {
    return { open: false, ms: performance.now() - t0 };
  }
}

async function scanPorts(host: string): Promise<string> {
  const clean = host.replace(/^https?:\/\//, '').split('/')[0];
  const results = await Promise.all(
    COMMON_PORTS.map(async p => ({ ...p, ...(await checkPort(clean, p.port, p.proto)) }))
  );
  const lines = [
    `Cible       : ${clean}`,
    `Ports testés: ${COMMON_PORTS.length} (HTTP/HTTPS uniquement — limitation browser)`,
    '',
    'PORT   PROTO  SERVICE     ÉTAT     TEMPS',
    ''.padEnd(50, '─'),
  ];
  for (const r of results) {
    const state = r.open ? '🟢 ouvert ' : '⚪ fermé  ';
    lines.push(
      `${String(r.port).padEnd(6)} ${r.proto.padEnd(6)} ${r.name.padEnd(11)} ${state} ${r.ms.toFixed(0)}ms`
    );
  }
  lines.push('');
  lines.push(`Ouverts: ${results.filter(r => r.open).length}/${results.length}`);
  lines.push('');
  lines.push('Note: le navigateur ne peut sonder que les ports HTTP/HTTPS via fetch.');
  lines.push('      Pour un scan complet (TCP/UDP, top 1000 ports), un backend nmap est requis.');
  return lines.join('\n');
}

async function fetchAsn(target: string): Promise<string> {
  const t = target.trim();
  // RIPEstat accepte IP ou ASN. Pour un domaine, on résout d'abord en A via DoH.
  let ip = t;
  const isIp = /^\d+\.\d+\.\d+\.\d+$/.test(t) || t.includes(':');
  if (!isIp) {
    const r = await fetch(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(t)}&type=A`, {
      headers: { Accept: 'application/dns-json' },
    });
    const j = await r.json();
    const a = j.Answer?.find((x: any) => x.type === 1);
    if (!a) throw new Error('Impossible de résoudre le domaine en IPv4');
    ip = a.data;
  }
  const r = await fetch(`https://stat.ripe.net/data/network-info/data.json?resource=${encodeURIComponent(ip)}`);
  if (!r.ok) throw new Error(`RIPEstat HTTP ${r.status}`);
  const j: any = await r.json();
  const data = j.data || {};
  const lines: string[] = [];
  lines.push(`Cible      : ${t}${!isIp ? `  →  ${ip}` : ''}`);
  lines.push(`Préfixe BGP: ${data.prefix || '?'}`);
  lines.push(`ASN(s)     : ${(data.asns || []).map((n: number) => `AS${n}`).join(', ') || '?'}`);

  // Détails de chaque ASN
  for (const asn of data.asns || []) {
    try {
      const r2 = await fetch(`https://stat.ripe.net/data/as-overview/data.json?resource=AS${asn}`);
      const j2: any = await r2.json();
      const ov = j2.data || {};
      lines.push('');
      lines.push(`── AS${asn} ──`);
      lines.push(`Holder     : ${ov.holder || '?'}`);
      lines.push(`Type       : ${ov.type || '?'}`);
      lines.push(`Annonce    : ${ov.announced ? 'oui' : 'non'}`);
      if (ov.block) lines.push(`Block      : ${ov.block.resource} (${ov.block.desc || ''})`);
    } catch {}
  }
  return lines.join('\n');
}

async function fetchSsl(domain: string): Promise<string> {
  const clean = domain.replace(/^https?:\/\//, '').split('/')[0];
  const r = await fetch(`https://crt.sh/?q=${encodeURIComponent(clean)}&output=json`);
  if (!r.ok) throw new Error(`crt.sh HTTP ${r.status}`);
  const j = await r.json() as Array<{
    issuer_name: string; common_name: string; name_value: string;
    not_before: string; not_after: string; entry_timestamp: string; serial_number: string;
  }>;
  if (!j.length) return 'Aucun certificat trouvé pour ce domaine';
  // Dédupe par serial_number, garde les 20 plus récents
  const seen = new Set<string>();
  const certs = j
    .filter(c => { if (seen.has(c.serial_number)) return false; seen.add(c.serial_number); return true; })
    .sort((a, b) => +new Date(b.not_before) - +new Date(a.not_before))
    .slice(0, 20);

  const now = Date.now();
  const lines: string[] = [];
  lines.push(`Domaine: ${clean}`);
  lines.push(`Total  : ${j.length} certificats CT logs (${certs.length} uniques affichés)`);
  lines.push('');
  for (const c of certs) {
    const expired = +new Date(c.not_after) < now;
    const issuer  = (c.issuer_name.match(/O=([^,]+)/)?.[1] || c.issuer_name).trim();
    lines.push(`${expired ? '🔴' : '🟢'}  ${c.common_name || '(no CN)'}`);
    lines.push(`     Issuer : ${issuer}`);
    lines.push(`     Valide : ${new Date(c.not_before).toLocaleDateString('fr-FR')} → ${new Date(c.not_after).toLocaleDateString('fr-FR')}${expired ? '  (EXPIRÉ)' : ''}`);
    const sans = c.name_value.split(/\n/).map(s => s.trim()).filter(Boolean);
    if (sans.length > 1) lines.push(`     SANs   : ${sans.slice(0, 6).join(', ')}${sans.length > 6 ? ` (+${sans.length - 6})` : ''}`);
    lines.push('');
  }
  return lines.join('\n');
}

export function ReseauTool() {
  const [activeTool, setActiveTool] = useState('ping');
  const [input, setInput]           = useState('');
  const [result, setResult]         = useState('');
  const [loading, setLoading]       = useState(false);
  const [copied, setCopied]         = useState(false);

  const current = TOOLS.find(t => t.id === activeTool)!;

  const run = async () => {
    if (!input.trim() || loading) return;
    setLoading(true);
    setResult('');
    try {
      const q = input.trim();
      let text: string;
      if      (activeTool === 'ping')  text = await httpPing(q);
      else if (activeTool === 'ports') text = await scanPorts(q);
      else if (activeTool === 'asn')   text = await fetchAsn(q);
      else if (activeTool === 'ssl')   text = await fetchSsl(q);
      else throw new Error('outil inconnu');
      setResult(text);
      toast.success('Scan terminé');
    } catch (e: any) {
      const msg = e.message || 'Erreur réseau';
      toast.error('Erreur', { description: msg });
      setResult('⚠ ' + msg);
    } finally {
      setLoading(false);
    }
  };

  const copy = () => {
    navigator.clipboard.writeText(result);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="space-y-4">
      {/* Tab bar */}
      <div className="flex gap-2 flex-wrap">
        {TOOLS.map(t => {
          const Icon = t.icon;
          return (
            <button
              key={t.id}
              onClick={() => { setActiveTool(t.id); setResult(''); setInput(''); }}
              className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm transition-all border ${
                activeTool === t.id
                  ? 'bg-primary/10 text-primary border-primary/40'
                  : 'bg-secondary/20 text-foreground border-border hover:bg-secondary'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              {t.label}
            </button>
          );
        })}
      </div>

      {/* Description */}
      <p className="text-xs text-muted-foreground px-1">{current.desc}</p>

      {/* Input */}
      <div className="bg-card border border-border rounded-lg p-6">
        <div className="flex gap-3">
          <input
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && run()}
            placeholder={current.placeholder}
            className="flex-1 bg-input border border-border rounded-md px-4 py-2.5 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary font-mono text-sm"
          />
          <button
            onClick={run}
            disabled={loading}
            className="bg-primary hover:bg-primary/90 disabled:opacity-60 disabled:cursor-not-allowed text-primary-foreground px-6 py-2.5 rounded-md flex items-center gap-2 whitespace-nowrap"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
            {loading ? 'En cours...' : 'Lancer'}
          </button>
        </div>
      </div>

      {/* Results */}
      {result && (
        <div className="bg-card border border-border rounded-lg p-6">
          <div className="flex justify-between items-center mb-4">
            <span className="text-foreground font-medium text-sm">
              Résultats — <span className="text-primary">{current.label}</span>
              <span className="text-muted-foreground ml-2 font-mono">{input}</span>
            </span>
            <button onClick={copy} className="flex items-center gap-1 text-sm text-muted-foreground hover:text-primary transition-colors">
              {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
              {copied ? 'Copié' : 'Copier'}
            </button>
          </div>
          <pre className="text-xs text-green-400 font-mono whitespace-pre-wrap bg-black/40 border border-green-900/30 rounded-md p-4 max-h-[480px] overflow-y-auto leading-relaxed">
            {result}
          </pre>
        </div>
      )}
    </div>
  );
}
