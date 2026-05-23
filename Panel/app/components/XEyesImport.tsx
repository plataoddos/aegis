import { useState, useRef } from 'react';
import { FileJson, Download } from 'lucide-react';
import html2canvas from 'html2canvas';

interface Parent {
  last_name?: string;
  first_name?: string;
  address?: string;
  postal_code?: string;
  city?: string;
  gender?: string;
  email?: string[];
  phone?: string[];
}

interface XEyesEntry {
  id: string;
  score: number;
  last_name?: string;
  first_name?: string;
  birthdate?: string;
  gender?: string;
  address?: string;
  postal_code?: string;
  city?: string;
  email?: string[];
  phone?: string[];
  iban?: string;
  bic?: string;
  parent_1?: Parent;
  parent_2?: Parent;
  file?: string;
  offset?: number;
}

interface XEyesData {
  outil: string;
  requete: string;
  ms: number;
  entrees: XEyesEntry[];
}

interface MergedProfile {
  firstName: string;
  lastName: string;
  birthdate: string;
  gender: string;
  emails: string[];
  phones: string[];
  addresses: string[];
  ibans: string[];
  bics: string[];
  parents: { key: string; name: string; gender: string; emails: string[]; phones: string[]; addresses: string[] }[];
  sources: string[];
}

function uniq(arr: (string | undefined)[]): string[] {
  const seen = new Set<string>();
  return arr.filter((v): v is string => {
    if (!v) return false;
    const n = v.trim().toLowerCase();
    if (seen.has(n)) return false;
    seen.add(n);
    return true;
  });
}

function mergeEntries(entries: XEyesEntry[]): MergedProfile[] {
  const map = new Map<string, XEyesEntry[]>();
  for (const e of entries) {
    const key = `${(e.first_name || '').toUpperCase().trim()}|${(e.last_name || '').toUpperCase().trim()}|${e.birthdate || ''}`;
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(e);
  }

  return Array.from(map.values()).map((group) => {
    const base = group[0];
    const allEmails = group.flatMap(e => e.email || []);
    const allPhones = group.flatMap(e => e.phone || []);
    const allAddresses = group.flatMap(e =>
      e.address ? [`${e.address}${e.postal_code ? ', ' + e.postal_code : ''}${e.city ? ' ' + e.city : ''}`] : []
    );
    const allIbans = group.flatMap(e => e.iban ? [e.iban] : []);
    const allBics = group.flatMap(e => e.bic ? [e.bic] : []);
    const allSources = group.flatMap(e => e.file ? [e.file] : []);

    // Merge parents
    const parentMap = new Map<string, { name: string; gender: string; emails: string[]; phones: string[]; addresses: string[] }>();
    for (const e of group) {
      for (const p of [e.parent_1, e.parent_2].filter(Boolean) as Parent[]) {
        const pKey = `${(p.first_name || '').toUpperCase()}|${(p.last_name || '').toUpperCase()}`;
        if (!parentMap.has(pKey)) {
          parentMap.set(pKey, { name: `${p.first_name || ''} ${p.last_name || ''}`.trim(), gender: p.gender || '', emails: [], phones: [], addresses: [] });
        }
        const pm = parentMap.get(pKey)!;
        pm.emails.push(...(p.email || []));
        pm.phones.push(...(p.phone || []));
        if (p.address) pm.addresses.push(`${p.address}${p.postal_code ? ', ' + p.postal_code : ''}${p.city ? ' ' + p.city : ''}`);
      }
    }

    return {
      firstName: base.first_name || '',
      lastName: base.last_name || '',
      birthdate: base.birthdate || '',
      gender: base.gender || '',
      emails: uniq(allEmails),
      phones: uniq(allPhones),
      addresses: uniq(allAddresses),
      ibans: uniq(allIbans),
      bics: uniq(allBics),
      sources: uniq(allSources),
      parents: Array.from(parentMap.entries()).map(([key, v]) => ({
        key,
        ...v,
        emails: uniq(v.emails),
        phones: uniq(v.phones),
        addresses: uniq(v.addresses),
      })),
    };
  });
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function generateRef(requete: string): string {
  let h = 5381;
  for (const c of requete) h = (((h << 5) + h) ^ c.charCodeAt(0)) >>> 0;
  const n = h % 1000000000;
  return `#${String(n % 100).padStart(2, '0')}EL${String((n >> 10) % 100).padStart(2, '0')}LTC${String(n % 100000).padStart(5, '0')}`;
}

function parentRole(gender?: string): string {
  const g = (gender || '').toLowerCase();
  if (g === 'f' || g.startsWith('fé') || g.startsWith('fe') || g === 'female') return 'Maman';
  if (g === 'm' || g.startsWith('ma') || g === 'male') return 'Papa';
  return 'Parent';
}

function splitAddress(addr: string): [string, string] {
  const comma = addr.indexOf(', ');
  if (comma === -1) return [addr, ''];
  return [addr.substring(0, comma), addr.substring(comma + 2)];
}

function initials(first: string, last: string): string {
  return ((first[0] || '') + (last[0] || '')).toUpperCase() || '?';
}

// ─── Main component ───────────────────────────────────────────────────────────

export function XEyesImport() {
  const [data, setData]           = useState<XEyesData | null>(null);
  const [error, setError]         = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const printRef = useRef<HTMLDivElement>(null);
  const fileRef  = useRef<HTMLInputElement>(null);

  const parseFile = (file: File) => {
    setError('');
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const json = JSON.parse(e.target?.result as string);
        if (!json.entrees || !Array.isArray(json.entrees)) {
          setError('Format invalide : champ "entrees" manquant.');
          return;
        }
        setData(json as XEyesData);
      } catch {
        setError('Fichier JSON invalide.');
      }
    };
    reader.readAsText(file);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) parseFile(file);
  };

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) parseFile(file);
  };

  const exportPNG = async () => {
    if (!printRef.current || !data) return;
    setIsGenerating(true);
    try {
      const canvas = await html2canvas(printRef.current, {
        scale: 2,
        backgroundColor: '#0d0d0d',
        useCORS: true,
        logging: false,
      });
      const link = document.createElement('a');
      link.download = `Aegis_${data.requete.replace(/[^a-zA-Z0-9]/g, '_').slice(0, 40)}.png`;
      link.href = canvas.toDataURL('image/png');
      link.click();
    } finally {
      setIsGenerating(false);
    }
  };

  const profiles = data ? mergeEntries(data.entrees) : [];
  const ref      = data ? generateRef(data.requete) : '';
  const dateStr  = new Date().toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });

  const S = {
    page:  { background: '#0d0d0d', padding: '32px', fontFamily: "'Inter','Segoe UI',Arial,sans-serif" } as React.CSSProperties,
    card:  { background: '#181818', border: '1px solid #2a2a2a', borderRadius: 12 } as React.CSSProperties,
    box:   { background: '#222', borderRadius: 8, padding: '10px 14px', fontFamily: 'monospace', fontSize: 13, color: '#f0f0f0', wordBreak: 'break-all' as const, marginTop: 4 } as React.CSSProperties,
    label: { color: '#777', fontSize: 11, marginBottom: 2, marginTop: 14 } as React.CSSProperties,
    sep:   { borderTop: '1px solid #2a2a2a', margin: '12px 0' } as React.CSSProperties,
  };

  return (
    <div className="space-y-6">
      {/* Drop zone */}
      <div
        onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
        onClick={() => fileRef.current?.click()}
        className={`border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition-all ${
          isDragging ? 'border-primary bg-primary/10' : 'border-border hover:border-primary/50 hover:bg-secondary/20'
        }`}
      >
        <input ref={fileRef} type="file" accept=".json" onChange={handleFileInput} className="hidden" />
        <FileJson className="w-10 h-10 text-primary mx-auto mb-3" />
        <p className="text-foreground font-medium">Glisser-déposer un fichier JSON xEyes</p>
        <p className="text-muted-foreground text-sm mt-1">ou cliquer pour sélectionner</p>
      </div>

      {error && (
        <div className="bg-destructive/10 border border-destructive/30 rounded-lg px-4 py-3 text-destructive text-sm">{error}</div>
      )}

      {data && (
        <>
          {/* Toolbar — outside the export area */}
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              <span className="text-foreground font-medium">{profiles.length} profil{profiles.length > 1 ? 's' : ''} consolidé{profiles.length > 1 ? 's' : ''}</span>
              <span className="ml-2">({data.entrees.length} entrées brutes)</span>
            </p>
            <button
              onClick={exportPNG}
              disabled={isGenerating}
              className="flex items-center gap-2 bg-white hover:bg-white/90 disabled:opacity-60 disabled:cursor-not-allowed text-black font-semibold px-5 py-2.5 rounded-full transition-colors text-sm"
            >
              <Download className="w-4 h-4" />
              {isGenerating ? 'Génération...' : 'Télécharger PNG'}
            </button>
          </div>

          {/* ── REPORT — PNG export target ── */}
          <div ref={printRef} style={S.page}>

            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 28 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                <div style={{ width: 48, height: 48, background: '#fff', borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <span style={{ color: '#000', fontWeight: 900, fontSize: 22, fontFamily: 'monospace' }}>A</span>
                </div>
                <div>
                  <p style={{ color: '#fff', fontWeight: 800, fontSize: 18, margin: 0, letterSpacing: 1 }}>AEGIS</p>
                  <p style={{ color: '#666', fontSize: 12, margin: 0 }}>Intelligence Platform</p>
                </div>
              </div>
              <div style={{ background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: 8, padding: '6px 14px' }}>
                <span style={{ color: '#888', fontFamily: 'monospace', fontSize: 12 }}>{ref}</span>
              </div>
            </div>

            {/* Title + requête */}
            <div style={{ marginBottom: 28 }}>
              <p style={{ color: '#fff', fontWeight: 800, fontSize: 28, margin: '0 0 10px' }}>Rapport OSINT</p>
              <p style={{ color: '#555', fontSize: 13, fontFamily: 'monospace', margin: 0 }}>{data.requete}</p>
            </div>

            {/* Profiles */}
            {profiles.map((p, i) => {
              const av = initials(p.firstName, p.lastName);
              const hasContact  = p.emails.length > 0 || p.phones.length > 0;
              const hasLocation = p.addresses.length > 0;
              const hasFinances = p.ibans.length > 0 || p.bics.length > 0;
              const hasFamily   = p.parents.length > 0;

              return (
                <div key={i} style={{ marginBottom: 36 }}>

                  {/* Profile banner */}
                  <div style={{ ...S.card, padding: '20px 24px', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 20 }}>
                    <div style={{ width: 64, height: 64, background: '#2a2a2a', borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      <span style={{ color: '#fff', fontWeight: 800, fontSize: 22, fontFamily: 'monospace' }}>{av}</span>
                    </div>
                    <div>
                      <p style={{ color: '#fff', fontWeight: 800, fontSize: 24, margin: 0 }}>{p.firstName} {p.lastName}</p>
                      <p style={{ color: '#666', fontSize: 13, margin: '4px 0 0' }}>
                        Sujet de l'enquête
                        {p.birthdate && <span style={{ color: '#444', marginLeft: 12 }}>né(e) le {p.birthdate}</span>}
                      </p>
                    </div>
                  </div>

                  {/* 2-col grid */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>

                    {/* Contact */}
                    {hasContact && (
                      <div style={{ ...S.card, padding: 20 }}>
                        <div style={{ color: '#fff', fontWeight: 700, fontSize: 15 }}>
                          <span style={{ marginRight: 8, fontSize: 14 }}>✉</span>Contact
                        </div>
                        <div style={S.sep} />
                        {p.emails.map((em, j) => (
                          <div key={j}>
                            <p style={S.label}>{j === 0 ? 'Email principal' : j === 1 ? 'Email secondaire' : `Email ${j + 1}`}</p>
                            <div style={S.box}>{em}</div>
                          </div>
                        ))}
                        {p.phones.map((ph, j) => (
                          <div key={j}>
                            <p style={S.label}>{j === 0 ? 'Téléphone' : `Téléphone ${j + 1}`}</p>
                            <div style={S.box}>{ph}</div>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Localisation */}
                    {hasLocation && (
                      <div style={{ ...S.card, padding: 20 }}>
                        <div style={{ color: '#fff', fontWeight: 700, fontSize: 15 }}>
                          <span style={{ marginRight: 8, fontSize: 14 }}>◉</span>Localisation
                        </div>
                        <div style={S.sep} />
                        <p style={S.label}>Domicile</p>
                        {p.addresses.map((a, j) => {
                          const [street, city] = splitAddress(a);
                          return (
                            <div key={j} style={{ background: '#222', borderRadius: 10, padding: '12px 14px', marginBottom: 8 }}>
                              <table style={{ borderCollapse: 'collapse', width: '100%' }}>
                                <tbody>
                                  <tr>
                                    <td style={{ width: 36, verticalAlign: 'middle', paddingRight: 12 }}>
                                      <div style={{ width: 36, height: 36, background: '#2a2a2a', borderRadius: 8, color: '#888', fontSize: 16, textAlign: 'center', lineHeight: '36px' }}>⌂</div>
                                    </td>
                                    <td style={{ verticalAlign: 'middle' }}>
                                      <p style={{ color: '#fff', fontWeight: 600, fontSize: 14, margin: 0, fontFamily: 'monospace' }}>{street || a}</p>
                                      {city && <p style={{ color: '#777', fontSize: 12, margin: '2px 0 0', fontFamily: 'monospace' }}>{city}</p>}
                                    </td>
                                  </tr>
                                </tbody>
                              </table>
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {/* Finances */}
                    {hasFinances && (
                      <div style={{ ...S.card, padding: 20 }}>
                        <div style={{ color: '#fff', fontWeight: 700, fontSize: 15 }}>
                          <span style={{ marginRight: 8, fontSize: 14 }}>◈</span>Finances
                        </div>
                        <div style={S.sep} />
                        {p.ibans.map((ib, j) => (
                          <div key={j}>
                            <p style={S.label}>IBAN</p>
                            <div style={S.box}>{ib}</div>
                          </div>
                        ))}
                        {p.bics.map((b, j) => (
                          <div key={j}>
                            <p style={S.label}>BIC</p>
                            <div style={S.box}>{b}</div>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Famille */}
                    {hasFamily && (
                      <div style={{ ...S.card, padding: 20 }}>
                        <div style={{ color: '#fff', fontWeight: 700, fontSize: 15 }}>
                          <span style={{ marginRight: 8, fontSize: 14 }}>♦</span>Famille
                        </div>
                        <div style={S.sep} />
                        {p.parents.map((par, j) => {
                          const role = parentRole(par.gender);
                          return (
                            <div key={j} style={{ background: '#222', borderRadius: 10, padding: '12px 14px', marginBottom: 10 }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                                <span style={{ color: '#fff', fontWeight: 700, fontSize: 14 }}>{par.name}</span>
                                <span style={{ background: '#2a2a2a', color: '#aaa', fontSize: 11, borderRadius: 6, padding: '2px 8px' }}>{role}</span>
                              </div>
                              {par.emails.map((em, k) => (
                                <p key={k} style={{ color: '#777', fontSize: 12, margin: '0 0 4px', fontFamily: 'monospace' }}>
                                  <span style={{ color: '#555' }}>Email: </span>{em}
                                </p>
                              ))}
                              {par.phones.map((ph, k) => (
                                <p key={k} style={{ color: '#777', fontSize: 12, margin: '0 0 4px', fontFamily: 'monospace' }}>
                                  <span style={{ color: '#555' }}>Tél: </span>{ph}
                                </p>
                              ))}
                              {par.addresses.map((a, k) => (
                                <p key={k} style={{ color: '#777', fontSize: 12, margin: '0 0 4px', fontFamily: 'monospace' }}>
                                  <span style={{ color: '#555' }}>Adresse: </span>{a}
                                </p>
                              ))}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  {/* Sources */}
                  {p.sources.length > 0 && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                      <span style={{ color: '#555', fontSize: 12 }}>Sources</span>
                      {p.sources.map((s, j) => (
                        <span key={j} style={{ background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: 6, color: '#666', fontSize: 11, padding: '4px 10px', fontFamily: 'monospace' }}>{s}</span>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}

            {/* Footer */}
            <div style={{ borderTop: '1px solid #1e1e1e', paddingTop: 16, marginTop: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ color: '#333', fontSize: 12 }}>Aegis Intel • {dateStr}</span>
              <span style={{ color: '#333', fontSize: 12 }}>{profiles.length} profil(s) consolidé(s)</span>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
