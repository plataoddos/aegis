import { useState } from 'react';
import { Search, Loader2, Copy, Check, Globe, Cpu, Shield, ArrowRight } from 'lucide-react';
import { toast } from 'sonner';

const TOOLS = [
  { id: 'headers',  label: 'En-têtes HTTP', icon: Globe,     placeholder: 'https://example.com', desc: 'Affiche tous les en-têtes HTTP de la réponse' },
  { id: 'technos',  label: 'Technologies',  icon: Cpu,       placeholder: 'https://example.com', desc: 'Détecte les technologies du serveur via les en-têtes' },
  { id: 'waf',      label: 'WAF Detection', icon: Shield,    placeholder: 'https://example.com', desc: 'Détecte la présence d\'un Web Application Firewall' },
  { id: 'redirect', label: 'Redirections',  icon: ArrowRight,placeholder: 'https://example.com', desc: 'Analyse la chaîne de redirections HTTP' },
];

function detectTechnologies(raw: string): { name: string; category: string }[] {
  const h = raw.toLowerCase();
  const techs: { name: string; category: string }[] = [];

  const serverMatch = raw.match(/Server:\s*([^\r\n]+)/i);
  if (serverMatch) techs.push({ name: serverMatch[1].trim(), category: 'Serveur Web' });

  const pwrMatch = raw.match(/X-Powered-By:\s*([^\r\n]+)/i);
  if (pwrMatch) techs.push({ name: pwrMatch[1].trim(), category: 'Backend' });

  if (h.includes('cf-ray') || h.includes('server: cloudflare'))
    techs.push({ name: 'Cloudflare', category: 'CDN / WAF' });
  if (h.includes('x-vercel') || h.includes('server: vercel'))
    techs.push({ name: 'Vercel', category: 'Hébergement' });
  if (h.includes('x-amzn-requestid') || h.includes('x-amz-cf-id'))
    techs.push({ name: 'Amazon AWS / CloudFront', category: 'Cloud' });
  if (h.includes('x-azure-ref') || h.includes('arr-disable-session-affinity'))
    techs.push({ name: 'Microsoft Azure', category: 'Cloud' });
  if (h.includes('x-github-request-id'))
    techs.push({ name: 'GitHub Pages', category: 'Hébergement' });
  if (h.includes('x-fastly-request-id'))
    techs.push({ name: 'Fastly CDN', category: 'CDN' });
  if (h.includes('x-drupal-cache') || h.includes('x-generator: drupal'))
    techs.push({ name: 'Drupal', category: 'CMS' });
  if (h.includes('x-wp-') || h.includes('wp-super-cache') || h.includes('wordpress'))
    techs.push({ name: 'WordPress', category: 'CMS' });
  if (h.includes('x-shopify-stage') || h.includes('powered by shopify'))
    techs.push({ name: 'Shopify', category: 'E-commerce' });
  if (h.includes('phpsessid'))
    techs.push({ name: 'PHP Sessions', category: 'Session' });
  if (h.includes('asp.net_sessionid') || h.includes('aspnet'))
    techs.push({ name: 'ASP.NET Sessions', category: 'Session' });
  if (h.includes('jsessionid'))
    techs.push({ name: 'Java Servlet', category: 'Session' });
  if (h.includes('laravel_session'))
    techs.push({ name: 'Laravel (PHP)', category: 'Framework' });
  if (h.includes('x-cache') || h.includes('x-cache-hits'))
    techs.push({ name: 'Varnish Cache', category: 'Cache' });
  if (h.includes('strict-transport-security'))
    techs.push({ name: 'HSTS activé', category: 'Sécurité' });
  if (h.includes('content-security-policy'))
    techs.push({ name: 'CSP activé', category: 'Sécurité' });
  if (h.includes('x-frame-options'))
    techs.push({ name: 'X-Frame-Options', category: 'Sécurité' });

  return techs;
}

function parseRedirects(raw: string): string[] {
  const lines = raw.split('\n');
  const redirects: string[] = [];
  lines.forEach(line => {
    if (/^HTTP\//i.test(line) && (line.includes('301') || line.includes('302') || line.includes('307') || line.includes('308')))
      redirects.push(line.trim());
    if (/^location:/i.test(line))
      redirects.push('  → ' + line.replace(/^location:\s*/i, '').trim());
  });
  return redirects;
}

export function WebTool() {
  const [activeTool, setActiveTool] = useState('headers');
  const [input, setInput]           = useState('');
  const [rawResult, setRawResult]   = useState('');
  const [loading, setLoading]       = useState(false);
  const [copied, setCopied]         = useState(false);

  const current = TOOLS.find(t => t.id === activeTool)!;

  const run = async () => {
    if (!input.trim() || loading) return;
    setLoading(true);
    setRawResult('');
    try {
      let url = input.trim();
      if (activeTool === 'waf') {
        url = url.replace(/^https?:\/\//, '');
      }
      const endpoint = activeTool === 'waf'
        ? `https://api.hackertarget.com/wafw00f/?q=${encodeURIComponent(url)}`
        : `https://api.hackertarget.com/httpheaders/?q=${encodeURIComponent(url)}`;

      const res  = await fetch(endpoint);
      const text = await res.text();
      if (text.toLowerCase().startsWith('error')) throw new Error(text);
      setRawResult(text);
      toast.success('Analyse terminée');
    } catch (e: any) {
      const msg = e.message || 'Erreur réseau';
      toast.error('Erreur', { description: msg });
      setRawResult('⚠ ' + msg);
    } finally {
      setLoading(false);
    }
  };

  const copy = () => {
    navigator.clipboard.writeText(rawResult);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const techs    = activeTool === 'technos'  && rawResult ? detectTechnologies(rawResult) : [];
  const redirects = activeTool === 'redirect' && rawResult ? parseRedirects(rawResult) : [];

  return (
    <div className="space-y-4">
      <div className="flex gap-2 flex-wrap">
        {TOOLS.map(t => {
          const Icon = t.icon;
          return (
            <button key={t.id} onClick={() => { setActiveTool(t.id); setRawResult(''); setInput(''); }}
              className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm transition-all border ${
                activeTool === t.id ? 'bg-primary/10 text-primary border-primary/40' : 'bg-secondary/20 text-foreground border-border hover:bg-secondary'
              }`}>
              <Icon className="w-3.5 h-3.5" />{t.label}
            </button>
          );
        })}
      </div>
      <p className="text-xs text-muted-foreground px-1">{current.desc}</p>

      <div className="bg-card border border-border rounded-lg p-6">
        <div className="flex gap-3">
          <input value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && run()}
            placeholder={current.placeholder}
            className="flex-1 bg-input border border-border rounded-md px-4 py-2.5 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary font-mono text-sm" />
          <button onClick={run} disabled={loading}
            className="bg-primary hover:bg-primary/90 disabled:opacity-60 disabled:cursor-not-allowed text-primary-foreground px-6 py-2.5 rounded-md flex items-center gap-2 whitespace-nowrap">
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
            {loading ? 'Analyse...' : 'Analyser'}
          </button>
        </div>
      </div>

      {/* Technologies view */}
      {activeTool === 'technos' && rawResult && (
        <div className="bg-card border border-border rounded-lg p-6">
          <div className="flex justify-between items-center mb-4">
            <span className="text-foreground font-medium text-sm">Technologies détectées <span className="text-primary ml-1">{techs.length} trouvée{techs.length > 1 ? 's' : ''}</span></span>
            <button onClick={copy} className="flex items-center gap-1 text-sm text-muted-foreground hover:text-primary">
              {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}{copied ? 'Copié' : 'Copier raw'}
            </button>
          </div>
          {techs.length === 0 ? (
            <p className="text-muted-foreground text-sm">Aucune technologie identifiée depuis les en-têtes.</p>
          ) : (
            <div className="space-y-2">
              {techs.map((t, i) => (
                <div key={i} className="flex items-center justify-between py-2 border-b border-border last:border-0">
                  <span className="text-foreground font-mono text-sm">{t.name}</span>
                  <span className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded">{t.category}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Redirections view */}
      {activeTool === 'redirect' && rawResult && (
        <div className="bg-card border border-border rounded-lg p-6">
          <div className="flex justify-between items-center mb-4">
            <span className="text-foreground font-medium text-sm">Chaîne de redirections</span>
            <button onClick={copy} className="flex items-center gap-1 text-sm text-muted-foreground hover:text-primary">
              {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}{copied ? 'Copié' : 'Copier'}
            </button>
          </div>
          {redirects.length === 0 ? (
            <p className="text-muted-foreground text-sm">Aucune redirection détectée — réponse directe.</p>
          ) : (
            <pre className="text-xs text-yellow-400 font-mono whitespace-pre-wrap bg-black/40 border border-yellow-900/30 rounded-md p-4">{redirects.join('\n')}</pre>
          )}
          <details className="mt-4">
            <summary className="text-xs text-muted-foreground cursor-pointer hover:text-primary">Voir les en-têtes bruts</summary>
            <pre className="text-xs text-green-400 font-mono whitespace-pre-wrap bg-black/40 border border-green-900/30 rounded-md p-4 mt-2 max-h-64 overflow-y-auto">{rawResult}</pre>
          </details>
        </div>
      )}

      {/* Raw view (headers & WAF) */}
      {(activeTool === 'headers' || activeTool === 'waf') && rawResult && (
        <div className="bg-card border border-border rounded-lg p-6">
          <div className="flex justify-between items-center mb-4">
            <span className="text-foreground font-medium text-sm">Résultats — <span className="text-primary">{current.label}</span></span>
            <button onClick={copy} className="flex items-center gap-1 text-sm text-muted-foreground hover:text-primary">
              {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}{copied ? 'Copié' : 'Copier'}
            </button>
          </div>
          <pre className="text-xs text-green-400 font-mono whitespace-pre-wrap bg-black/40 border border-green-900/30 rounded-md p-4 max-h-[480px] overflow-y-auto leading-relaxed">{rawResult}</pre>
        </div>
      )}
    </div>
  );
}
