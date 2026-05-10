import { useState } from 'react';
import { Copy, Check, RefreshCw, Hash, Lock, Key, Code } from 'lucide-react';
import { toast } from 'sonner';

const TOOLS = [
  { id: 'hash',     label: 'Hachage',       icon: Hash, desc: 'Génère des hash SHA-1 / SHA-256 / SHA-384 / SHA-512 d\'un texte' },
  { id: 'encode',   label: 'Encodage',      icon: Code, desc: 'Encode / décode en Base64, Hex, URL' },
  { id: 'password', label: 'Mots de passe', icon: Lock, desc: 'Analyse la force d\'un mot de passe et génère des mots de passe sécurisés' },
  { id: 'jwt',      label: 'JWT',           icon: Key,  desc: 'Décode un JSON Web Token sans vérification de signature' },
];

async function hashText(text: string, algo: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const buf  = await crypto.subtle.digest(algo, data);
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function toHex(str: string): string {
  return Array.from(new TextEncoder().encode(str)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function fromHex(hex: string): string {
  const bytes = hex.match(/.{1,2}/g) || [];
  return new TextDecoder().decode(new Uint8Array(bytes.map(b => parseInt(b, 16))));
}

function checkStrength(pw: string): { score: number; label: string; color: string; checks: { label: string; ok: boolean }[] } {
  const checks = [
    { label: '≥ 8 caractères',           ok: pw.length >= 8 },
    { label: '≥ 12 caractères',          ok: pw.length >= 12 },
    { label: 'Majuscule (A-Z)',           ok: /[A-Z]/.test(pw) },
    { label: 'Minuscule (a-z)',           ok: /[a-z]/.test(pw) },
    { label: 'Chiffre (0-9)',             ok: /[0-9]/.test(pw) },
    { label: 'Symbole (!@#$...)',         ok: /[^A-Za-z0-9]/.test(pw) },
    { label: 'Pas de répétition simple', ok: !/(.)\1{2,}/.test(pw) },
  ];
  const score  = checks.filter(c => c.ok).length;
  const labels = ['Très faible', 'Très faible', 'Faible', 'Moyen', 'Fort', 'Très fort', 'Excellent'];
  const colors = ['text-red-500', 'text-red-500', 'text-orange-500', 'text-yellow-500', 'text-blue-400', 'text-green-400', 'text-emerald-400'];
  return { score, label: labels[score], color: colors[score], checks };
}

function generatePassword(length: number, upper: boolean, lower: boolean, digits: boolean, symbols: boolean): string {
  const chars = [
    upper   ? 'ABCDEFGHIJKLMNOPQRSTUVWXYZ' : '',
    lower   ? 'abcdefghijklmnopqrstuvwxyz' : '',
    digits  ? '0123456789' : '',
    symbols ? '!@#$%^&*()-_=+[]{}|;:,.<>?' : '',
  ].join('');
  if (!chars) return '';
  return Array.from(crypto.getRandomValues(new Uint32Array(length))).map(n => chars[n % chars.length]).join('');
}

function decodeJWT(token: string): { header: any; payload: any; signature: string } {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('JWT invalide — 3 parties attendues');
  const decode = (s: string) => {
    const pad  = s.replace(/-/g, '+').replace(/_/g, '/');
    const json = atob(pad + '==='.slice((pad.length % 4) || 4));
    return JSON.parse(json);
  };
  return { header: decode(parts[0]), payload: decode(parts[1]), signature: parts[2] };
}

function Row({ label, value, mono = true }: { label: string; value: string; mono?: boolean }) {
  const [c, setC] = useState(false);
  const copy = () => { navigator.clipboard.writeText(value); setC(true); setTimeout(() => setC(false), 1500); };
  return (
    <div className="flex items-start justify-between py-2.5 border-b border-border last:border-0 gap-4">
      <span className="text-muted-foreground text-sm shrink-0 w-28">{label}</span>
      <span className={`text-foreground text-sm flex-1 break-all ${mono ? 'font-mono' : ''}`}>{value}</span>
      <button onClick={copy} className="text-muted-foreground hover:text-primary shrink-0">
        {c ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
      </button>
    </div>
  );
}

export function CryptoTool() {
  const [activeTool, setActiveTool] = useState('hash');
  const [input, setInput]           = useState('');

  // Hash state
  const [hashes, setHashes]         = useState<Record<string, string>>({});
  const [hashing, setHashing]       = useState(false);

  // Encode state
  const [encodeMode, setEncodeMode] = useState<'encode' | 'decode'>('encode');
  const [encodeType, setEncodeType] = useState<'base64' | 'hex' | 'url'>('base64');
  const [encodeResult, setEncodeResult] = useState('');

  // Password state
  const [pwInput, setPwInput]       = useState('');
  const [pwLen, setPwLen]           = useState(16);
  const [pwUpper, setPwUpper]       = useState(true);
  const [pwLower, setPwLower]       = useState(true);
  const [pwDigits, setPwDigits]     = useState(true);
  const [pwSymbols, setPwSymbols]   = useState(true);
  const [generated, setGenerated]   = useState('');

  // JWT state
  const [jwtInput, setJwtInput]     = useState('');
  const [jwtResult, setJwtResult]   = useState<{ header: any; payload: any; signature: string } | null>(null);

  const current = TOOLS.find(t => t.id === activeTool)!;

  const runHash = async () => {
    if (!input.trim() || hashing) return;
    setHashing(true);
    try {
      const [sha1, sha256, sha384, sha512] = await Promise.all([
        hashText(input, 'SHA-1'),
        hashText(input, 'SHA-256'),
        hashText(input, 'SHA-384'),
        hashText(input, 'SHA-512'),
      ]);
      setHashes({ 'SHA-1': sha1, 'SHA-256': sha256, 'SHA-384': sha384, 'SHA-512': sha512 });
      toast.success('Hash généré');
    } catch { toast.error('Erreur de hachage'); }
    setHashing(false);
  };

  const runEncode = () => {
    try {
      let out = '';
      if (encodeType === 'base64') out = encodeMode === 'encode' ? btoa(unescape(encodeURIComponent(input))) : decodeURIComponent(escape(atob(input)));
      if (encodeType === 'hex')    out = encodeMode === 'encode' ? toHex(input) : fromHex(input);
      if (encodeType === 'url')    out = encodeMode === 'encode' ? encodeURIComponent(input) : decodeURIComponent(input);
      setEncodeResult(out);
      toast.success('Opération réussie');
    } catch (e: any) { toast.error('Erreur', { description: e.message }); }
  };

  const runJWT = () => {
    try {
      setJwtResult(decodeJWT(jwtInput.trim()));
      toast.success('JWT décodé');
    } catch (e: any) { toast.error('Erreur', { description: e.message }); }
  };

  const strength = pwInput ? checkStrength(pwInput) : null;

  return (
    <div className="space-y-4">
      {/* Tabs */}
      <div className="flex gap-2 flex-wrap">
        {TOOLS.map(t => {
          const Icon = t.icon;
          return (
            <button key={t.id} onClick={() => { setActiveTool(t.id); setHashes({}); setEncodeResult(''); setJwtResult(null); }}
              className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm transition-all border ${
                activeTool === t.id ? 'bg-primary/10 text-primary border-primary/40' : 'bg-secondary/20 text-foreground border-border hover:bg-secondary'
              }`}>
              <Icon className="w-3.5 h-3.5" />{t.label}
            </button>
          );
        })}
      </div>
      <p className="text-xs text-muted-foreground px-1">{current.desc}</p>

      {/* ── HASH ── */}
      {activeTool === 'hash' && (
        <div className="space-y-4">
          <div className="bg-card border border-border rounded-lg p-6">
            <div className="flex gap-3">
              <input value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && runHash()}
                placeholder="Texte à hacher..."
                className="flex-1 bg-input border border-border rounded-md px-4 py-2.5 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary font-mono text-sm" />
              <button onClick={runHash} disabled={hashing}
                className="bg-primary hover:bg-primary/90 disabled:opacity-60 text-primary-foreground px-6 py-2.5 rounded-md flex items-center gap-2">
                <Hash className="w-4 h-4" />{hashing ? 'Hash...' : 'Générer'}
              </button>
            </div>
          </div>
          {Object.keys(hashes).length > 0 && (
            <div className="bg-card border border-border rounded-lg p-6">
              {Object.entries(hashes).map(([algo, h]) => <Row key={algo} label={algo} value={h} />)}
            </div>
          )}
        </div>
      )}

      {/* ── ENCODAGE ── */}
      {activeTool === 'encode' && (
        <div className="space-y-4">
          <div className="bg-card border border-border rounded-lg p-6 space-y-4">
            <div className="flex gap-2 flex-wrap">
              {(['base64', 'hex', 'url'] as const).map(t => (
                <button key={t} onClick={() => setEncodeType(t)}
                  className={`px-3 py-1 rounded text-xs border uppercase ${encodeType === t ? 'bg-primary/10 text-primary border-primary/40' : 'border-border text-muted-foreground hover:bg-secondary'}`}>
                  {t}
                </button>
              ))}
              <div className="ml-auto flex gap-1">
                {(['encode', 'decode'] as const).map(m => (
                  <button key={m} onClick={() => setEncodeMode(m)}
                    className={`px-3 py-1 rounded text-xs border capitalize ${encodeMode === m ? 'bg-primary/10 text-primary border-primary/40' : 'border-border text-muted-foreground hover:bg-secondary'}`}>
                    {m}
                  </button>
                ))}
              </div>
            </div>
            <textarea value={input} onChange={e => setInput(e.target.value)} rows={3}
              placeholder={`Texte à ${encodeMode === 'encode' ? 'encoder' : 'décoder'}...`}
              className="w-full bg-input border border-border rounded-md px-4 py-2.5 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary font-mono text-sm resize-none" />
            <button onClick={runEncode}
              className="bg-primary hover:bg-primary/90 text-primary-foreground px-6 py-2.5 rounded-md flex items-center gap-2 text-sm">
              <Code className="w-4 h-4" />{encodeMode === 'encode' ? 'Encoder' : 'Décoder'}
            </button>
          </div>
          {encodeResult && (
            <div className="bg-card border border-border rounded-lg p-6">
              <Row label="Résultat" value={encodeResult} />
            </div>
          )}
        </div>
      )}

      {/* ── PASSWORD ── */}
      {activeTool === 'password' && (
        <div className="space-y-4">
          {/* Strength checker */}
          <div className="bg-card border border-border rounded-lg p-6 space-y-3">
            <p className="text-sm text-muted-foreground font-medium">Analyseur de force</p>
            <input value={pwInput} onChange={e => setPwInput(e.target.value)} type="text"
              placeholder="Collez un mot de passe..."
              className="w-full bg-input border border-border rounded-md px-4 py-2.5 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary font-mono text-sm" />
            {strength && (
              <div className="space-y-2">
                <div className="flex items-center gap-3">
                  <div className="flex-1 bg-secondary rounded-full h-2">
                    <div className="h-2 rounded-full bg-primary transition-all" style={{ width: `${(strength.score / 7) * 100}%` }} />
                  </div>
                  <span className={`text-sm font-semibold ${strength.color}`}>{strength.label}</span>
                </div>
                <div className="grid grid-cols-2 gap-1">
                  {strength.checks.map((c, i) => (
                    <div key={i} className="flex items-center gap-1.5 text-xs">
                      <span className={c.ok ? 'text-green-400' : 'text-muted-foreground'}>
                        {c.ok ? '✓' : '✗'}
                      </span>
                      <span className={c.ok ? 'text-foreground' : 'text-muted-foreground'}>{c.label}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Generator */}
          <div className="bg-card border border-border rounded-lg p-6 space-y-3">
            <p className="text-sm text-muted-foreground font-medium">Générateur de mot de passe</p>
            <div className="flex items-center gap-3">
              <span className="text-sm text-foreground">Longueur : <strong>{pwLen}</strong></span>
              <input type="range" min={8} max={64} value={pwLen} onChange={e => setPwLen(Number(e.target.value))} className="flex-1" />
            </div>
            <div className="flex gap-3 flex-wrap text-sm">
              {[
                { label: 'Majuscules', val: pwUpper,   set: setPwUpper },
                { label: 'Minuscules', val: pwLower,   set: setPwLower },
                { label: 'Chiffres',   val: pwDigits,  set: setPwDigits },
                { label: 'Symboles',   val: pwSymbols, set: setPwSymbols },
              ].map(({ label, val, set }) => (
                <label key={label} className="flex items-center gap-1.5 cursor-pointer text-foreground">
                  <input type="checkbox" checked={val} onChange={e => set(e.target.checked)} className="accent-primary" />
                  {label}
                </label>
              ))}
            </div>
            <div className="flex gap-3">
              <input readOnly value={generated}
                className="flex-1 bg-input border border-border rounded-md px-4 py-2.5 text-primary font-mono text-sm focus:outline-none" />
              <button onClick={() => setGenerated(generatePassword(pwLen, pwUpper, pwLower, pwDigits, pwSymbols))}
                className="bg-secondary hover:bg-secondary/80 text-foreground px-4 py-2.5 rounded-md flex items-center gap-2 text-sm border border-border">
                <RefreshCw className="w-4 h-4" />Générer
              </button>
              {generated && (
                <button onClick={() => { navigator.clipboard.writeText(generated); toast.success('Copié'); }}
                  className="bg-primary hover:bg-primary/90 text-primary-foreground px-4 py-2.5 rounded-md flex items-center gap-2 text-sm">
                  <Copy className="w-4 h-4" />Copier
                </button>
              )}
            </div>
            {generated && <div className="mt-1">{checkStrength(generated).label && (
              <span className={`text-xs ${checkStrength(generated).color}`}>Force : {checkStrength(generated).label}</span>
            )}</div>}
          </div>
        </div>
      )}

      {/* ── JWT ── */}
      {activeTool === 'jwt' && (
        <div className="space-y-4">
          <div className="bg-card border border-border rounded-lg p-6 space-y-3">
            <textarea value={jwtInput} onChange={e => setJwtInput(e.target.value)} rows={4}
              placeholder="Collez votre JWT ici (eyJ...)"
              className="w-full bg-input border border-border rounded-md px-4 py-2.5 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary font-mono text-xs resize-none" />
            <button onClick={runJWT}
              className="bg-primary hover:bg-primary/90 text-primary-foreground px-6 py-2.5 rounded-md flex items-center gap-2 text-sm">
              <Key className="w-4 h-4" />Décoder
            </button>
          </div>
          {jwtResult && (
            <div className="space-y-3">
              {[
                { label: 'Header', data: jwtResult.header, color: 'text-blue-400' },
                { label: 'Payload', data: jwtResult.payload, color: 'text-yellow-400' },
              ].map(({ label, data, color }) => (
                <div key={label} className="bg-card border border-border rounded-lg p-6">
                  <p className={`text-xs font-bold uppercase tracking-widest mb-3 ${color}`}>{label}</p>
                  {Object.entries(data).map(([k, v]) => {
                    let display = String(v);
                    if (k === 'iat' || k === 'exp' || k === 'nbf') {
                      const d = new Date(Number(v) * 1000);
                      display = `${v} → ${d.toLocaleString('fr-FR')}`;
                    }
                    return <Row key={k} label={k} value={display} />;
                  })}
                </div>
              ))}
              <div className="bg-card border border-border rounded-lg p-4">
                <p className="text-xs font-bold uppercase tracking-widest mb-2 text-red-400">Signature</p>
                <p className="text-xs text-muted-foreground font-mono break-all">{jwtResult.signature}</p>
                <p className="text-xs text-muted-foreground mt-2">⚠ La signature n'est pas vérifiée (aucune clé secrète)</p>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
