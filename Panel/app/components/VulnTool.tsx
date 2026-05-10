import { useState } from 'react';
import { Search, Loader2, Copy, Check, AlertTriangle, Wifi } from 'lucide-react';
import { toast } from 'sonner';

const TOOLS = [
  { id: 'cve',    label: 'Recherche CVE',   icon: AlertTriangle, placeholder: 'CVE-2021-44228 ou mot-clé (ex: apache, log4j)', desc: 'Recherche dans la base NVD (NIST) — gratuit, sans clé API' },
  { id: 'shodan', label: 'Shodan InternetDB', icon: Wifi,         placeholder: 'IP publique (ex: 1.1.1.1)',                    desc: 'Infos Shodan sur une IP publique — ports, CVE, hostnames, tags' },
];

interface NVDItem {
  id: string;
  descriptions: { lang: string; value: string }[];
  metrics?: {
    cvssMetricV31?: { cvssData: { baseScore: number; baseSeverity: string; vectorString: string } }[];
    cvssMetricV2?:  { cvssData: { baseScore: number } }[];
  };
  published: string;
  lastModified: string;
  references?: { url: string }[];
}

interface ShodanDB {
  ip: string;
  ports?: number[];
  hostnames?: string[];
  cpes?: string[];
  vulns?: string[];
  tags?: string[];
}

function severityColor(s: string): string {
  const m: Record<string, string> = { CRITICAL: 'text-red-500', HIGH: 'text-orange-500', MEDIUM: 'text-yellow-400', LOW: 'text-blue-400' };
  return m[s?.toUpperCase()] || 'text-muted-foreground';
}

function severityBg(s: string): string {
  const m: Record<string, string> = { CRITICAL: 'bg-red-500/10 border-red-500/30', HIGH: 'bg-orange-500/10 border-orange-500/30', MEDIUM: 'bg-yellow-400/10 border-yellow-400/30', LOW: 'bg-blue-400/10 border-blue-400/30' };
  return m[s?.toUpperCase()] || 'bg-secondary/20 border-border';
}

export function VulnTool() {
  const [activeTool, setActiveTool] = useState('cve');
  const [input, setInput]           = useState('');
  const [loading, setLoading]       = useState(false);
  const [cveList, setCveList]       = useState<NVDItem[]>([]);
  const [shodanData, setShodanData] = useState<ShodanDB | null>(null);
  const [copied, setCopied]         = useState(false);
  const [totalResults, setTotalResults] = useState(0);

  const current = TOOLS.find(t => t.id === activeTool)!;

  const runCVE = async () => {
    if (!input.trim() || loading) return;
    setLoading(true);
    setCveList([]);
    setTotalResults(0);
    try {
      const query = input.trim();
      const isCVEId = /^CVE-\d{4}-\d+$/i.test(query);
      const url = isCVEId
        ? `https://services.nvd.nist.gov/rest/json/cves/2.0?cveId=${query}`
        : `https://services.nvd.nist.gov/rest/json/cves/2.0?keywordSearch=${encodeURIComponent(query)}&resultsPerPage=15`;

      const res  = await fetch(url, { headers: { 'Accept': 'application/json' } });
      if (!res.ok) throw new Error(`NVD API: HTTP ${res.status}`);
      const json = await res.json();

      if (!json.vulnerabilities || json.vulnerabilities.length === 0)
        throw new Error('Aucun CVE trouvé pour cette recherche');

      setTotalResults(json.totalResults || json.vulnerabilities.length);
      setCveList(json.vulnerabilities.map((v: any) => v.cve as NVDItem));
      toast.success(`${json.vulnerabilities.length} CVE trouvé(s)`);
    } catch (e: any) {
      toast.error('Erreur', { description: e.message });
    } finally {
      setLoading(false);
    }
  };

  const runShodan = async () => {
    if (!input.trim() || loading) return;
    setLoading(true);
    setShodanData(null);
    try {
      const ip  = input.trim();
      const res = await fetch(`https://internetdb.shodan.io/${ip}`);
      if (res.status === 404) throw new Error('IP non trouvée dans Shodan');
      if (!res.ok) throw new Error(`Erreur HTTP ${res.status}`);
      const json = await res.json() as ShodanDB & { detail?: string };
      if (json.detail) throw new Error(String(json.detail));
      setShodanData(json);
      toast.success('Données Shodan récupérées');
    } catch (e: any) {
      toast.error('Erreur', { description: e.message });
    } finally {
      setLoading(false);
    }
  };

  const run = activeTool === 'cve' ? runCVE : runShodan;

  const copyAll = () => {
    const text = activeTool === 'cve'
      ? JSON.stringify(cveList, null, 2)
      : JSON.stringify(shodanData, null, 2);
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="space-y-4">
      {/* Tabs */}
      <div className="flex gap-2 flex-wrap">
        {TOOLS.map(t => {
          const Icon = t.icon;
          return (
            <button key={t.id} onClick={() => { setActiveTool(t.id); setCveList([]); setShodanData(null); setInput(''); }}
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
            {loading ? 'Recherche...' : 'Rechercher'}
          </button>
        </div>
      </div>

      {/* ── CVE Results ── */}
      {activeTool === 'cve' && cveList.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between px-1">
            <span className="text-sm text-muted-foreground">
              {cveList.length} résultat{cveList.length > 1 ? 's' : ''} affichés
              {totalResults > cveList.length && ` sur ${totalResults.toLocaleString()} au total`}
            </span>
            <button onClick={copyAll} className="flex items-center gap-1 text-sm text-muted-foreground hover:text-primary">
              {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}{copied ? 'Copié' : 'Copier JSON'}
            </button>
          </div>
          {cveList.map((cve) => {
            const v31    = cve.metrics?.cvssMetricV31?.[0]?.cvssData;
            const v2     = cve.metrics?.cvssMetricV2?.[0]?.cvssData;
            const score  = v31?.baseScore ?? v2?.baseScore;
            const sev    = v31?.baseSeverity ?? '';
            const desc   = cve.descriptions?.find(d => d.lang === 'en')?.value || 'No description';
            return (
              <div key={cve.id} className={`border rounded-lg p-5 space-y-3 ${severityBg(sev)}`}>
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <span className="font-mono font-bold text-foreground text-sm">{cve.id}</span>
                    {sev && (
                      <span className={`text-xs font-bold uppercase px-2 py-0.5 rounded border ${severityBg(sev)} ${severityColor(sev)}`}>
                        {sev}
                      </span>
                    )}
                  </div>
                  {score !== undefined && (
                    <span className={`text-lg font-bold tabular-nums ${severityColor(sev)}`}>{score.toFixed(1)}</span>
                  )}
                </div>
                <p className="text-sm text-muted-foreground leading-relaxed line-clamp-3">{desc}</p>
                <div className="flex gap-6 text-xs text-muted-foreground flex-wrap">
                  <span>Publié : <span className="text-foreground">{new Date(cve.published).toLocaleDateString('fr-FR')}</span></span>
                  <span>Modifié : <span className="text-foreground">{new Date(cve.lastModified).toLocaleDateString('fr-FR')}</span></span>
                  {v31?.vectorString && <span className="font-mono text-blue-400/80">{v31.vectorString}</span>}
                </div>
                {cve.references && cve.references.length > 0 && (
                  <details className="text-xs">
                    <summary className="text-muted-foreground cursor-pointer hover:text-primary">{cve.references.length} référence{cve.references.length > 1 ? 's' : ''}</summary>
                    <div className="mt-2 space-y-1">
                      {cve.references.slice(0, 5).map((r, i) => (
                        <a key={i} href={r.url} target="_blank" rel="noopener noreferrer"
                          className="block text-blue-400 hover:underline truncate">{r.url}</a>
                      ))}
                    </div>
                  </details>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ── Shodan InternetDB Results ── */}
      {activeTool === 'shodan' && shodanData && (
        <div className="bg-card border border-border rounded-lg p-6 space-y-4">
          <div className="flex items-center justify-between">
            <span className="text-foreground font-medium">Shodan InternetDB — <span className="text-primary font-mono">{shodanData.ip}</span></span>
            <button onClick={copyAll} className="flex items-center gap-1 text-sm text-muted-foreground hover:text-primary">
              {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}{copied ? 'Copié' : 'Copier JSON'}
            </button>
          </div>

          {shodanData.ports && shodanData.ports.length > 0 && (
            <div>
              <p className="text-xs text-primary font-bold uppercase tracking-widest mb-2">Ports ouverts ({shodanData.ports.length})</p>
              <div className="flex flex-wrap gap-2">
                {shodanData.ports.map(p => (
                  <span key={p} className="bg-blue-500/10 border border-blue-500/30 text-blue-400 text-xs font-mono px-2 py-1 rounded">{p}</span>
                ))}
              </div>
            </div>
          )}

          {shodanData.hostnames && shodanData.hostnames.length > 0 && (
            <div>
              <p className="text-xs text-primary font-bold uppercase tracking-widest mb-2">Hostnames ({shodanData.hostnames.length})</p>
              <div className="space-y-1">
                {shodanData.hostnames.map(h => (
                  <p key={h} className="text-sm font-mono text-foreground">{h}</p>
                ))}
              </div>
            </div>
          )}

          {shodanData.vulns && shodanData.vulns.length > 0 && (
            <div>
              <p className="text-xs text-red-400 font-bold uppercase tracking-widest mb-2">Vulnérabilités détectées ({shodanData.vulns.length})</p>
              <div className="flex flex-wrap gap-2">
                {shodanData.vulns.map(v => (
                  <a key={v} href={`https://nvd.nist.gov/vuln/detail/${v}`} target="_blank" rel="noopener noreferrer"
                    className="bg-red-500/10 border border-red-500/30 text-red-400 text-xs font-mono px-2 py-1 rounded hover:bg-red-500/20 transition-colors">
                    {v}
                  </a>
                ))}
              </div>
            </div>
          )}

          {shodanData.cpes && shodanData.cpes.length > 0 && (
            <div>
              <p className="text-xs text-primary font-bold uppercase tracking-widest mb-2">CPE / Software ({shodanData.cpes.length})</p>
              <div className="space-y-1">
                {shodanData.cpes.map(c => (
                  <p key={c} className="text-xs font-mono text-muted-foreground">{c}</p>
                ))}
              </div>
            </div>
          )}

          {shodanData.tags && shodanData.tags.length > 0 && (
            <div>
              <p className="text-xs text-primary font-bold uppercase tracking-widest mb-2">Tags</p>
              <div className="flex flex-wrap gap-2">
                {shodanData.tags.map(t => (
                  <span key={t} className="bg-secondary text-foreground text-xs px-2 py-1 rounded border border-border">{t}</span>
                ))}
              </div>
            </div>
          )}

          {(!shodanData.ports?.length && !shodanData.hostnames?.length && !shodanData.vulns?.length) && (
            <p className="text-muted-foreground text-sm">Aucune donnée significative trouvée pour cette IP.</p>
          )}
        </div>
      )}
    </div>
  );
}
