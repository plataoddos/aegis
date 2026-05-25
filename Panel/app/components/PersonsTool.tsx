import { useEffect, useMemo, useState } from 'react';
import {
  Plus, Trash2, Search, X, User, MapPin, Mail, Calendar,
  CreditCard, FileText, Edit3, Copy, Code, Loader2, AlertCircle,
  Upload, FileUp, CheckCircle2,
} from 'lucide-react';
import { toast } from 'sonner';

const API_URL   = ((import.meta as any).env?.VITE_WATCHER_API_URL  as string) || 'http://localhost:8787';
const getApiToken = () => { try { return localStorage.getItem('aegis_session') || ''; } catch { return ''; } };

// ── Types ───────────────────────────────────────────────────────────────────
interface Person {
  id: number;
  nom: string;
  prenom: string;
  genre: string | null;
  date_naissance: string;
  adresse: string | null;
  complement: string | null;
  code_postal: string | null;
  ville: string | null;
  allocataire: string | null;
  matricule: string | null;
  email_alloc: string | null;
  tel_alloc: string | null;
  iban: string | null;
  bic: string | null;
  categorie: string | null;
  ext_id: string | null;
  notes: string | null;
  created_at: number;
  updated_at: number;
}

const EMPTY_FORM: Omit<Person, 'id' | 'created_at' | 'updated_at'> = {
  nom: '', prenom: '', genre: '', date_naissance: '',
  adresse: '', complement: '', code_postal: '', ville: '',
  allocataire: '', matricule: '', email_alloc: '', tel_alloc: '',
  iban: '', bic: '', categorie: '', ext_id: '', notes: '',
};

// ── Helpers ─────────────────────────────────────────────────────────────────
async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(API_URL + path, {
    ...init,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getApiToken()}`, ...(init?.headers || {}) },
  });
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try { msg = (await res.json()).error || msg; } catch {}
    throw new Error(msg);
  }
  return res.json() as Promise<T>;
}

function fmtDate(d: string | null): string {
  if (!d) return '';
  // Accept "YYYY-MM-DD" → "DD/MM/YYYY", else passthrough
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : d;
}

function initials(p: Person): string {
  return ((p.prenom?.[0] || '') + (p.nom?.[0] || '')).toUpperCase();
}

// ── Import normalization ────────────────────────────────────────────────────
function normalizeDate(d: any): string {
  if (!d) return '';
  const s = String(d).trim();
  // ISO 8601: 2009-08-23T00:00:00.000+02:00 or 2009-08-23
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (iso) return `${iso[3]}/${iso[2]}/${iso[1]}`;
  // Already DD/MM/YYYY
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(s)) return s;
  // DD-MM-YYYY → DD/MM/YYYY
  const dash = /^(\d{2})-(\d{2})-(\d{4})$/.exec(s);
  if (dash) return `${dash[1]}/${dash[2]}/${dash[3]}`;
  return s;
}

function normalizeGenre(g: any): string | null {
  if (!g) return null;
  const s = String(g).trim().toLowerCase();
  if (['m', 'h', 'male', 'homme', 'm.'].includes(s)) return 'Homme';
  if (['f', 'female', 'femme', 'mme', 'mlle'].includes(s)) return 'Femme';
  if (s === 'autre' || s === 'other' || s === 'x') return 'Autre';
  return null;
}

function joinList(v: any): string | null {
  if (!v) return null;
  if (Array.isArray(v)) return v.filter(Boolean).map(String).join(' | ') || null;
  return String(v);
}

/** Normalize one raw JSON record into PersonInput. Returns null if missing required fields. */
function normalizeRecord(raw: any): Omit<Person, 'id' | 'created_at' | 'updated_at'> | null {
  if (!raw || typeof raw !== 'object') return null;

  const nom         = raw.last_name  || raw.nom    || raw.lastName;
  const prenom      = raw.first_name || raw.prenom || raw.firstName;
  const dob         = raw.birth_date || raw.birthdate || raw.date_naissance || raw.dateNaissance;
  if (!nom || !prenom || !dob) return null;

  // Allocataire: prefer native `allocataire` field; otherwise reconstruct from xEyes-style parts
  const allocPrenom = raw.allocataire_prenom || raw.parent_1?.prenom;
  const allocNom    = raw.allocataire_nom    || raw.parent_1?.nom;
  const allocaire =
    raw.allocataire ||
    ((allocPrenom || allocNom) ? [allocPrenom, allocNom].filter(Boolean).join(' ') : null);

  return {
    nom:            String(nom).toUpperCase(),
    prenom:         String(prenom).toUpperCase(),
    genre:          normalizeGenre(raw.gender || raw.genre || raw.allocataire_qualite),
    date_naissance: normalizeDate(dob),
    adresse:        raw.voie || raw.address || raw.adresse || null,
    complement:     raw.complement || null,
    code_postal:    raw.postal_code || raw.code_postal || raw.cp || null,
    ville:          raw.city || raw.ville || null,
    allocataire:    allocaire,
    matricule:      raw.allocataire_matricule || raw.matricule || raw.parent_1?.matricule || null,
    // Native `email_alloc`/`tel_alloc` first (round-trip), fall back to xEyes-style keys
    email_alloc:    raw.email_alloc || joinList(raw.allocataire_email || raw.email || raw.parent_1?.email),
    tel_alloc:      raw.tel_alloc   || joinList(raw.allocataire_phone || raw.phone || raw.parent_1?.phone),
    iban:           raw.iban || null,
    bic:            raw.bic  || null,
    categorie:      raw.categorie || raw.provider || raw.outil || null,
    ext_id:         raw.ext_id || raw.identifier || raw.id || null,
    notes:          raw.notes || raw.source_file || raw.file || null,
  };
}

/** Extract array of raw records from any structure (array, single, xEyes wrapper, etc.) */
function extractRecords(parsed: any): any[] {
  if (Array.isArray(parsed)) return parsed;
  if (!parsed || typeof parsed !== 'object') return [];
  if (Array.isArray(parsed.entrees)) return parsed.entrees;
  if (Array.isArray(parsed.entries)) return parsed.entries;
  if (Array.isArray(parsed.results)) return parsed.results;
  if (Array.isArray(parsed.records)) return parsed.records;
  if (Array.isArray(parsed.data))    return parsed.data;
  return [parsed];
}

/** Parse JSON or JSONL (one object per line). Returns array of raw records or throws. */
function parseInput(text: string): any[] {
  const trimmed = text.trim();
  if (!trimmed) throw new Error('Entrée vide');
  // Try JSON first
  try {
    const parsed = JSON.parse(trimmed);
    return extractRecords(parsed);
  } catch (jsonErr) {
    // Try JSONL
    const lines = trimmed.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    if (lines.length > 1) {
      const out: any[] = [];
      for (const line of lines) {
        try {
          const obj = JSON.parse(line);
          out.push(...extractRecords(obj));
        } catch { /* skip bad line */ }
      }
      if (out.length) return out;
    }
    throw new Error('JSON invalide');
  }
}

// ── Component ───────────────────────────────────────────────────────────────
export function PersonsTool() {
  const [list, setList] = useState<Person[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [search, setSearch] = useState('');
  const [showEdit, setShowEdit] = useState(false);
  const [editMode, setEditMode] = useState<'create' | 'update'>('create');
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showImport, setShowImport] = useState(false);

  const refresh = async () => {
    try {
      setError(null);
      const data = await apiFetch<Person[]>('/api/persons');
      setList(data);
      if (selectedId === null && data.length > 0) setSelectedId(data[0].id);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { refresh(); /* eslint-disable-next-line */ }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return list;
    return list.filter(p => {
      const hay = [p.nom, p.prenom, p.ville, p.code_postal, p.matricule, p.email_alloc, p.categorie, p.ext_id]
        .filter(Boolean).join(' ').toLowerCase();
      return hay.includes(q);
    });
  }, [list, search]);

  const selected = list.find(p => p.id === selectedId) || null;

  // ── Actions ───────────────────────────────────────────────────────────────
  const openCreate = () => {
    setForm(EMPTY_FORM);
    setEditMode('create');
    setShowEdit(true);
  };
  const openEdit = (p: Person) => {
    setForm({
      nom: p.nom, prenom: p.prenom, genre: p.genre || '', date_naissance: p.date_naissance,
      adresse: p.adresse || '', complement: p.complement || '', code_postal: p.code_postal || '', ville: p.ville || '',
      allocataire: p.allocataire || '', matricule: p.matricule || '', email_alloc: p.email_alloc || '', tel_alloc: p.tel_alloc || '',
      iban: p.iban || '', bic: p.bic || '', categorie: p.categorie || '', ext_id: p.ext_id || '', notes: p.notes || '',
    });
    setEditMode('update');
    setShowEdit(true);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.nom.trim() || !form.prenom.trim() || !form.date_naissance.trim()) {
      toast.error('Nom, prénom et date de naissance requis');
      return;
    }
    setSaving(true);
    try {
      if (editMode === 'create') {
        const p = await apiFetch<Person>('/api/persons', { method: 'POST', body: JSON.stringify(form) });
        toast.success('Fiche créée');
        setSelectedId(p.id);
      } else if (selected) {
        await apiFetch<Person>(`/api/persons/${selected.id}`, { method: 'PATCH', body: JSON.stringify(form) });
        toast.success('Fiche mise à jour');
      }
      setShowEdit(false);
      refresh();
    } catch (err: any) {
      toast.error('Erreur', { description: err.message });
    } finally {
      setSaving(false);
    }
  };

  const remove = async (p: Person) => {
    if (!confirm(`Supprimer la fiche de ${p.prenom} ${p.nom} ?`)) return;
    try {
      await apiFetch(`/api/persons/${p.id}`, { method: 'DELETE' });
      toast.success('Fiche supprimée');
      if (selectedId === p.id) setSelectedId(null);
      refresh();
    } catch (err: any) {
      toast.error('Erreur', { description: err.message });
    }
  };

  const copyJSON = (p: Person) => {
    navigator.clipboard.writeText(JSON.stringify(p, null, 2));
    toast.success('JSON copié');
  };
  const copyAll = (p: Person) => {
    const lines = [
      `${p.prenom} ${p.nom}`,
      p.genre && `Genre: ${p.genre}`,
      `Né(e) le ${fmtDate(p.date_naissance)}`,
      '',
      p.adresse && `${p.adresse}`,
      p.complement && p.complement,
      [p.code_postal, p.ville].filter(Boolean).join(' '),
      '',
      p.allocataire && `Allocataire: ${p.allocataire}`,
      p.matricule && `Matricule: ${p.matricule}`,
      p.email_alloc && `Email: ${p.email_alloc}`,
      p.tel_alloc && `Tél: ${p.tel_alloc}`,
      '',
      p.iban && `IBAN: ${p.iban}`,
      p.bic && `BIC: ${p.bic}`,
    ].filter(Boolean).join('\n');
    navigator.clipboard.writeText(lines);
    toast.success('Fiche copiée');
  };

  // ── Render ────────────────────────────────────────────────────────────────
  if (error) {
    return (
      <div className="aegis-card aegis-card-edge p-10 text-center">
        <AlertCircle className="w-10 h-10 text-destructive mx-auto mb-3" />
        <h3 className="text-foreground font-semibold mb-1">Erreur</h3>
        <p className="text-sm text-muted-foreground mb-4 font-mono">{error}</p>
        <button onClick={refresh}
          className="aegis-btn-primary text-primary-foreground rounded-lg px-4 py-2 text-sm font-medium">
          Réessayer
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4 h-full flex flex-col" style={{ height: 'calc(100vh - 112px)' }}>
      {/* Header — glass card with stats + search + actions */}
      <div className="aegis-card aegis-card-edge px-5 py-3 flex items-center gap-4 flex-wrap flex-shrink-0">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-indigo-500/20 to-indigo-500/0 ring-1 ring-indigo-500/40 flex items-center justify-center">
            <User className="w-4 h-4 text-indigo-400" />
          </div>
          <div>
            <p className="text-sm font-semibold text-foreground leading-tight">Fiches</p>
            <p className="text-[11px] text-muted-foreground leading-tight">
              <span className="text-foreground font-semibold tabular-nums">{list.length}</span> {list.length > 1 ? 'fiches enregistrées' : 'fiche enregistrée'}
            </p>
          </div>
        </div>

        <div className="relative flex-1 min-w-[200px] max-w-md">
          <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Rechercher nom, ville, email, matricule…"
            className="w-full text-xs bg-input/60 border border-white/8 rounded-lg pl-9 pr-8 py-2 text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:border-primary/40" />
          {search && (
            <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground p-0.5 rounded">
              <X className="w-3 h-3" />
            </button>
          )}
        </div>

        <div className="ml-auto flex items-center gap-2">
          <button onClick={() => setShowImport(true)}
            className="border border-white/10 hover:bg-white/5 hover:border-white/15 text-foreground px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-all">
            <Upload className="w-3.5 h-3.5" /> Importer JSON
          </button>
          <button onClick={openCreate}
            className="aegis-btn-primary text-primary-foreground px-3.5 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5">
            <Plus className="w-3.5 h-3.5" /> Nouvelle fiche
          </button>
        </div>
      </div>

      {/* Main grid — fills remaining vertical space */}
      <div className="grid gap-4 lg:grid-cols-[320px_1fr] flex-1 min-h-0">

        {/* List */}
        <aside className="aegis-card aegis-card-edge flex flex-col overflow-hidden">
          <div className="overflow-y-auto flex-1">
            {loading ? (
              <div className="p-8 text-center text-sm text-muted-foreground">
                <Loader2 className="w-5 h-5 animate-spin mx-auto mb-2" /> Chargement…
              </div>
            ) : filtered.length === 0 ? (
              <div className="p-10 text-center">
                <div className="w-12 h-12 rounded-xl bg-indigo-500/10 ring-1 ring-indigo-500/20 flex items-center justify-center mx-auto mb-3">
                  <User className="w-5 h-5 text-indigo-400/60" />
                </div>
                <p className="text-sm text-foreground font-medium mb-1">
                  {list.length === 0 ? 'Aucune fiche' : 'Aucun résultat'}
                </p>
                <p className="text-xs text-muted-foreground mb-4">
                  {list.length === 0 ? 'Crée ta première fiche pour commencer' : 'Essaie un autre terme'}
                </p>
                {list.length === 0 && (
                  <button onClick={openCreate}
                    className="aegis-btn-primary text-primary-foreground rounded-lg px-4 py-2 text-xs font-semibold inline-flex items-center gap-1.5">
                    <Plus className="w-3.5 h-3.5" /> Créer la première
                  </button>
                )}
              </div>
            ) : (
              <div className="p-2 space-y-0.5">
                {filtered.map((p, idx) => {
                  const isActive = selectedId === p.id;
                  return (
                    <div key={p.id} className={`group relative rounded-lg transition-all ${
                      isActive
                        ? 'bg-indigo-500/10 ring-1 ring-indigo-500/30'
                        : 'hover:bg-white/[0.03]'
                    }`}>
                      <button onClick={() => setSelectedId(p.id)} className="w-full px-2.5 py-2 pr-9 flex items-center gap-3 text-left">
                        <div className={`w-9 h-9 rounded-lg flex items-center justify-center text-xs font-semibold flex-shrink-0 transition-colors ${
                          isActive
                            ? 'bg-gradient-to-br from-indigo-500/30 to-indigo-500/10 ring-1 ring-indigo-500/40 text-indigo-300'
                            : 'bg-white/[0.04] text-muted-foreground group-hover:text-foreground'
                        }`}>
                          {initials(p) || (idx + 1)}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className={`text-sm font-medium truncate transition-colors ${
                            isActive ? 'text-foreground' : 'text-foreground/90'
                          }`}>
                            {p.prenom} {p.nom}
                          </p>
                          <p className="text-[11px] text-muted-foreground truncate">
                            {[p.ville, fmtDate(p.date_naissance)].filter(Boolean).join(' · ') || p.categorie || '—'}
                          </p>
                        </div>
                      </button>
                      <button onClick={(e) => { e.stopPropagation(); remove(p); }}
                        title="Supprimer"
                        className="absolute opacity-0 group-hover:opacity-100 right-2 top-1/2 -translate-y-1/2 p-1.5 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-all">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </aside>

        {/* Detail */}
        <section className="aegis-card aegis-card-edge overflow-y-auto">
          {selected ? (
            <PersonDetail
              person={selected}
              index={list.findIndex(x => x.id === selected.id) + 1}
              onEdit={() => openEdit(selected)}
              onCopyJSON={() => copyJSON(selected)}
              onCopyAll={() => copyAll(selected)}
            />
          ) : (
            <div className="h-full flex flex-col items-center justify-center text-center px-6 py-12">
              <div className="w-16 h-16 rounded-2xl bg-indigo-500/10 ring-1 ring-indigo-500/20 flex items-center justify-center mb-4">
                <User className="w-7 h-7 text-indigo-400/60" />
              </div>
              <p className="text-foreground font-medium mb-1">Aucune fiche sélectionnée</p>
              <p className="text-xs text-muted-foreground">Sélectionne une fiche à gauche ou crée-en une nouvelle.</p>
            </div>
          )}
        </section>
      </div>

      {/* Edit modal */}
      {showEdit && (
        <PersonForm
          form={form}
          setForm={setForm}
          onSubmit={submit}
          onClose={() => setShowEdit(false)}
          mode={editMode}
          saving={saving}
        />
      )}

      {/* Import modal */}
      {showImport && (
        <ImportModal
          onClose={() => setShowImport(false)}
          onDone={() => { setShowImport(false); refresh(); }}
        />
      )}
    </div>
  );
}

// ── Detail panel ────────────────────────────────────────────────────────────
function PersonDetail({ person, index, onEdit, onCopyJSON, onCopyAll }: {
  person: Person; index: number;
  onEdit: () => void; onCopyJSON: () => void; onCopyAll: () => void;
}) {
  const p = person;
  return (
    <div>
      {/* Hero header */}
      <div className="relative px-6 py-5 border-b border-white/5 overflow-hidden">
        {/* gradient backdrop */}
        <div className="absolute inset-0 bg-gradient-to-br from-indigo-500/10 via-transparent to-violet-500/5 pointer-events-none" />
        <div className="relative flex items-center gap-4">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-indigo-500/30 to-indigo-500/10 ring-1 ring-indigo-500/40 text-indigo-300 font-bold flex items-center justify-center text-lg flex-shrink-0 shadow-lg shadow-indigo-500/20">
            {initials(p) || `#${index}`}
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-foreground font-bold text-xl tracking-tight truncate">
              {p.prenom} {p.nom}
            </h2>
            <div className="flex items-center gap-3 mt-1 flex-wrap">
              {p.date_naissance && (
                <span className="text-xs text-muted-foreground flex items-center gap-1">
                  <Calendar className="w-3 h-3" /> {fmtDate(p.date_naissance)}
                </span>
              )}
              {p.ville && (
                <span className="text-xs text-muted-foreground flex items-center gap-1">
                  <MapPin className="w-3 h-3" /> {p.ville}
                </span>
              )}
              {p.categorie && (
                <span className="text-[10px] uppercase tracking-wider text-indigo-400 font-semibold px-1.5 py-0.5 rounded bg-indigo-500/10 border border-indigo-500/20">
                  {p.categorie}
                </span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-1.5 flex-shrink-0">
            <button onClick={onEdit} title="Modifier"
              className="border border-white/10 hover:bg-white/5 hover:border-white/20 text-foreground px-2.5 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-all">
              <Edit3 className="w-3.5 h-3.5" /> Modifier
            </button>
            <button onClick={onCopyAll} title="Copier la fiche"
              className="border border-white/10 hover:bg-white/5 hover:border-white/20 text-muted-foreground hover:text-foreground p-1.5 rounded-lg transition-all">
              <Copy className="w-3.5 h-3.5" />
            </button>
            <button onClick={onCopyJSON} title="Copier en JSON"
              className="border border-primary/30 bg-primary/10 hover:bg-primary/20 text-primary px-2.5 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-all">
              <Code className="w-3.5 h-3.5" /> JSON
            </button>
          </div>
        </div>
      </div>

      {/* Sections */}
      <div className="px-6 py-5 space-y-5">
        <Section title="Identité" icon={User} tone="indigo">
          <Field label="Nom"               value={p.nom} />
          <Field label="Prénom"            value={p.prenom} />
          <Field label="Genre"             value={p.genre} />
          <Field label="Date de naissance" value={fmtDate(p.date_naissance)} />
        </Section>

        <Section title="Contact" icon={MapPin} tone="orange">
          <Field label="Adresse"     value={p.adresse} />
          <Field label="Complément"  value={p.complement} />
          <Field label="Code postal" value={p.code_postal} />
          <Field label="Ville"       value={p.ville} />
        </Section>

        {(p.allocataire || p.matricule || p.email_alloc || p.tel_alloc) && (
          <Section title="Allocataire" icon={Mail} tone="emerald">
            <Field label="Allocataire"  value={p.allocataire} />
            <Field label="Matricule"    value={p.matricule}    mono />
            <Field label="Email alloc." value={p.email_alloc}  full />
            <Field label="Tél. alloc."  value={p.tel_alloc}    multiline full />
          </Section>
        )}

        {(p.iban || p.bic) && (
          <Section title="Bancaire" icon={CreditCard} tone="rose">
            <Field label="IBAN" value={p.iban} mono full />
            <Field label="BIC"  value={p.bic}  mono />
          </Section>
        )}

        {(p.ext_id || p.notes) && (
          <Section title="Extra" icon={FileText} tone="zinc">
            <Field label="ID externe" value={p.ext_id} mono full />
            <Field label="Notes"      value={p.notes}  multiline full />
          </Section>
        )}
      </div>
    </div>
  );
}

const TONE_STYLE: Record<string, { bg: string; ring: string; text: string }> = {
  indigo:  { bg: 'bg-indigo-500/10',  ring: 'ring-indigo-500/30',  text: 'text-indigo-400' },
  orange:  { bg: 'bg-orange-500/10',  ring: 'ring-orange-500/30',  text: 'text-orange-400' },
  emerald: { bg: 'bg-emerald-500/10', ring: 'ring-emerald-500/30', text: 'text-emerald-400' },
  rose:    { bg: 'bg-rose-500/10',    ring: 'ring-rose-500/30',    text: 'text-rose-400' },
  zinc:    { bg: 'bg-zinc-500/10',    ring: 'ring-zinc-500/30',    text: 'text-zinc-400' },
};

function Section({ title, icon: Icon, tone, children }: {
  title: string; icon: any; tone: keyof typeof TONE_STYLE; children: React.ReactNode;
}) {
  const t = TONE_STYLE[tone];
  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        <div className={`w-6 h-6 rounded-md ${t.bg} ring-1 ${t.ring} flex items-center justify-center flex-shrink-0`}>
          <Icon className={`w-3 h-3 ${t.text}`} />
        </div>
        <h3 className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">{title}</h3>
        <div className="flex-1 h-px bg-white/5" />
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 rounded-lg bg-white/[0.02] border border-white/5 p-3">
        {children}
      </div>
    </div>
  );
}

function Field({ label, value, mono, multiline, full }: {
  label: string; value: string | null | undefined;
  mono?: boolean; multiline?: boolean; full?: boolean;
}) {
  const has = value && value !== '';
  return (
    <div className={full ? 'col-span-2 md:col-span-4' : ''}>
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground/70 font-semibold mb-1">{label}</p>
      <p className={`text-sm ${has ? 'text-foreground' : 'text-muted-foreground/40'} ${mono ? 'font-mono text-xs' : ''} ${multiline ? 'whitespace-pre-wrap break-words' : 'truncate'}`}>
        {has ? value : '—'}
      </p>
    </div>
  );
}

// ── Edit form ───────────────────────────────────────────────────────────────
function PersonForm({ form, setForm, onSubmit, onClose, mode, saving }: {
  form: typeof EMPTY_FORM;
  setForm: (f: typeof EMPTY_FORM) => void;
  onSubmit: (e: React.FormEvent) => void;
  onClose: () => void;
  mode: 'create' | 'update';
  saving: boolean;
}) {
  const upd = (k: keyof typeof form, v: string) => setForm({ ...form, [k]: v });

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={onClose}>
      <form onSubmit={onSubmit} className="bg-card border border-border rounded-xl w-full max-w-2xl shadow-2xl max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}>
        <div className="px-6 py-4 border-b border-border flex items-center gap-2 sticky top-0 bg-card z-10">
          <User className="w-4 h-4 text-muted-foreground" />
          <h3 className="text-foreground font-semibold">{mode === 'create' ? 'Nouvelle fiche' : 'Modifier la fiche'}</h3>
          <button type="button" onClick={onClose} className="ml-auto p-1 rounded hover:bg-muted text-muted-foreground">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-6 space-y-5">
          <FormSection title="Identité (requis)">
            <Input label="Nom *"          value={form.nom}    onChange={v => upd('nom', v)} required />
            <Input label="Prénom *"       value={form.prenom} onChange={v => upd('prenom', v)} required />
            <Select label="Genre" value={form.genre} onChange={v => upd('genre', v)}
              options={[{ v: '', l: '—' }, { v: 'Homme', l: 'Homme' }, { v: 'Femme', l: 'Femme' }, { v: 'Autre', l: 'Autre' }]} />
            <Input label="Date de naissance *" value={form.date_naissance} onChange={v => upd('date_naissance', v)}
              placeholder="JJ/MM/AAAA ou AAAA-MM-JJ" required />
          </FormSection>

          <FormSection title="Contact">
            <Input label="Adresse"     value={form.adresse}     onChange={v => upd('adresse', v)} />
            <Input label="Complément"  value={form.complement}  onChange={v => upd('complement', v)} />
            <Input label="Code postal" value={form.code_postal} onChange={v => upd('code_postal', v)} />
            <Input label="Ville"       value={form.ville}       onChange={v => upd('ville', v)} />
          </FormSection>

          <FormSection title="Allocataire">
            <Input label="Allocataire" value={form.allocataire} onChange={v => upd('allocataire', v)} />
            <Input label="Matricule"   value={form.matricule}   onChange={v => upd('matricule', v)} mono />
            <Input label="Email alloc." value={form.email_alloc} onChange={v => upd('email_alloc', v)} type="email" full />
            <Input label="Tél. alloc."  value={form.tel_alloc}   onChange={v => upd('tel_alloc', v)} full
              placeholder="0600000000 | 0700000000" />
          </FormSection>

          <FormSection title="Bancaire (optionnel)">
            <Input label="IBAN" value={form.iban} onChange={v => upd('iban', v)} mono full />
            <Input label="BIC"  value={form.bic}  onChange={v => upd('bic', v)}  mono />
            <Input label="Catégorie" value={form.categorie} onChange={v => upd('categorie', v)} placeholder="CAF, Pôle Emploi…" />
          </FormSection>

          <FormSection title="Extra">
            <Input label="ID externe" value={form.ext_id} onChange={v => upd('ext_id', v)} mono full />
            <Textarea label="Notes" value={form.notes} onChange={v => upd('notes', v)} />
          </FormSection>
        </div>

        <div className="px-6 py-4 border-t border-border flex gap-2 sticky bottom-0 bg-card">
          <button type="button" onClick={onClose}
            className="flex-1 border border-border hover:bg-muted text-foreground py-2 rounded-md text-sm transition-colors">
            Annuler
          </button>
          <button type="submit" disabled={saving}
            className="flex-1 bg-primary hover:bg-primary/90 disabled:opacity-60 text-primary-foreground font-medium py-2 rounded-md text-sm flex items-center justify-center gap-2 transition-colors">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
            {mode === 'create' ? 'Créer' : 'Enregistrer'}
          </button>
        </div>
      </form>
    </div>
  );
}

function FormSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-2">{title}</p>
      <div className="grid grid-cols-2 gap-3">{children}</div>
    </div>
  );
}

function Input({ label, value, onChange, required, placeholder, type, mono, full }: {
  label: string; value: string | null | undefined; onChange: (v: string) => void;
  required?: boolean; placeholder?: string; type?: string; mono?: boolean; full?: boolean;
}) {
  return (
    <div className={full ? 'col-span-2' : ''}>
      <label className="block mb-1 text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">{label}</label>
      <input type={type || 'text'} value={value ?? ''} onChange={e => onChange(e.target.value)}
        required={required} placeholder={placeholder}
        className={`w-full bg-input border border-border rounded-md px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-1 focus:ring-ring ${mono ? 'font-mono text-xs' : ''}`} />
    </div>
  );
}

function Textarea({ label, value, onChange }: { label: string; value: string | null | undefined; onChange: (v: string) => void }) {
  return (
    <div className="col-span-2">
      <label className="block mb-1 text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">{label}</label>
      <textarea value={value ?? ''} onChange={e => onChange(e.target.value)} rows={3}
        className="w-full bg-input border border-border rounded-md px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-1 focus:ring-ring resize-y" />
    </div>
  );
}

function Select({ label, value, onChange, options }: {
  label: string; value: string | null | undefined; onChange: (v: string) => void;
  options: { v: string; l: string }[];
}) {
  return (
    <div>
      <label className="block mb-1 text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">{label}</label>
      <select value={value ?? ''} onChange={e => onChange(e.target.value)}
        className="w-full bg-input border border-border rounded-md px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring">
        {options.map(o => <option key={o.v} value={o.v}>{o.l}</option>)}
      </select>
    </div>
  );
}

// ── Import modal ────────────────────────────────────────────────────────────
type Normalized = Omit<Person, 'id' | 'created_at' | 'updated_at'>;
interface PreviewItem { ok: true; data: Normalized; raw: any }
interface PreviewError { ok: false; reason: string; raw: any }
type Preview = PreviewItem | PreviewError;

function ImportModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [text, setText] = useState('');
  const [preview, setPreview] = useState<Preview[] | null>(null);
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0, ok: 0, fail: 0 });
  const [parseError, setParseError] = useState<string | null>(null);

  const onFile = async (file: File) => {
    const t = await file.text();
    setText(t);
    analyze(t);
  };

  const analyze = (raw: string) => {
    setParseError(null);
    try {
      const records = parseInput(raw);
      const items: Preview[] = records.map((r: any) => {
        const norm = normalizeRecord(r);
        if (!norm) return { ok: false, reason: 'champs requis manquants (nom, prenom, date_naissance)', raw: r };
        return { ok: true, data: norm, raw: r };
      });
      setPreview(items);
    } catch (e: any) {
      setParseError(e.message || 'parse error');
      setPreview(null);
    }
  };

  const doImport = async () => {
    if (!preview) return;
    const valid = preview.filter((p): p is PreviewItem => p.ok);
    if (!valid.length) { toast.error('Rien à importer'); return; }

    setImporting(true);
    setProgress({ done: 0, total: valid.length, ok: 0, fail: 0 });

    let ok = 0, fail = 0;
    for (let i = 0; i < valid.length; i++) {
      try {
        await apiFetch<Person>('/api/persons', { method: 'POST', body: JSON.stringify(valid[i].data) });
        ok++;
      } catch {
        fail++;
      }
      setProgress({ done: i + 1, total: valid.length, ok, fail });
    }

    setImporting(false);
    if (ok > 0) toast.success(`${ok} fiche${ok > 1 ? 's' : ''} importée${ok > 1 ? 's' : ''}`,
      fail ? { description: `${fail} échec${fail > 1 ? 's' : ''}` } : undefined);
    if (ok === 0 && fail > 0) toast.error('Aucune fiche importée');
    onDone();
  };

  const validCount = preview?.filter(p => p.ok).length ?? 0;
  const errCount   = preview?.filter(p => !p.ok).length ?? 0;

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-card border border-border rounded-xl w-full max-w-3xl shadow-2xl max-h-[90vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="px-6 py-4 border-b border-border flex items-center gap-2 flex-shrink-0">
          <Upload className="w-4 h-4 text-muted-foreground" />
          <h3 className="text-foreground font-semibold">Importer des fiches depuis JSON</h3>
          <button onClick={onClose} className="ml-auto p-1 rounded hover:bg-muted text-muted-foreground">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-6 flex-1 overflow-y-auto space-y-4">
          {!preview && (
            <>
              <div>
                <p className="text-xs text-muted-foreground mb-2">
                  Formats acceptés : <strong className="text-foreground">JSON</strong> (objet, tableau, ou wrapper xEyes avec <code className="bg-muted px-1 py-0.5 rounded text-[10px]">entrees</code>) et <strong className="text-foreground">JSONL</strong> (un objet par ligne).
                </p>
                <p className="text-[11px] text-muted-foreground">
                  Champs reconnus : <code className="text-[10px]">last_name/nom</code>, <code className="text-[10px]">first_name/prenom</code>, <code className="text-[10px]">birth_date/birthdate</code>, <code className="text-[10px]">address/voie</code>, <code className="text-[10px]">postal_code</code>, <code className="text-[10px]">city</code>, <code className="text-[10px]">gender</code>, <code className="text-[10px]">provider/outil</code>, <code className="text-[10px]">identifier</code>, allocataire_*…
                </p>
              </div>

              <label className="block">
                <div className="border-2 border-dashed border-border hover:border-primary/50 rounded-lg p-6 text-center cursor-pointer transition-colors">
                  <FileUp className="w-6 h-6 text-muted-foreground mx-auto mb-2" />
                  <p className="text-sm text-foreground">Glisser un fichier .json/.jsonl ici, ou cliquer pour parcourir</p>
                  <input type="file" accept=".json,.jsonl,application/json" className="hidden"
                    onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
                </div>
              </label>

              <div className="text-center text-xs text-muted-foreground">— ou —</div>

              <div>
                <label className="block mb-1.5 text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">Coller le JSON</label>
                <textarea value={text} onChange={e => setText(e.target.value)} rows={8}
                  placeholder='{"last_name": "BUTEZ", "first_name": "AMBROISE", "birth_date": "2009-08-23T00:00:00.000+02:00", ...}'
                  className="w-full bg-input border border-border rounded-md px-3 py-2 text-xs font-mono text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-1 focus:ring-ring resize-y" />
              </div>

              {parseError && (
                <div className="flex items-start gap-2 p-3 rounded-md bg-destructive/10 border border-destructive/30 text-destructive text-sm">
                  <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                  <span>{parseError}</span>
                </div>
              )}
            </>
          )}

          {preview && (
            <>
              <div className="flex items-center gap-3 flex-wrap p-3 rounded-md bg-muted/40 border border-border">
                <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                <span className="text-sm text-foreground">
                  <strong className="tabular-nums">{validCount}</strong> fiche{validCount > 1 ? 's' : ''} prête{validCount > 1 ? 's' : ''} à importer
                </span>
                {errCount > 0 && (
                  <span className="text-xs text-amber-400">
                    · {errCount} ignorée{errCount > 1 ? 's' : ''} (champs manquants)
                  </span>
                )}
                <button onClick={() => { setPreview(null); setText(''); }}
                  className="ml-auto text-xs border border-border rounded-md px-2.5 py-1 hover:bg-muted text-foreground">
                  Recommencer
                </button>
              </div>

              {importing && (
                <div className="p-3 rounded-md border border-border">
                  <div className="flex items-center justify-between text-xs text-muted-foreground mb-2">
                    <span>Import en cours…</span>
                    <span className="tabular-nums">{progress.done}/{progress.total}</span>
                  </div>
                  <div className="w-full h-1.5 bg-muted rounded-full overflow-hidden">
                    <div className="h-full bg-primary transition-all"
                      style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%` }} />
                  </div>
                </div>
              )}

              <div className="border border-border rounded-md overflow-hidden">
                <div className="px-3 py-2 bg-muted/40 border-b border-border text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
                  Aperçu
                </div>
                <div className="max-h-[40vh] overflow-y-auto">
                  {preview.map((p, i) => (
                    <div key={i} className={`px-3 py-2 border-b border-border last:border-0 text-xs flex items-center gap-3 ${
                      p.ok ? '' : 'bg-amber-500/5'
                    }`}>
                      <span className="w-6 text-muted-foreground tabular-nums text-right">{i + 1}</span>
                      {p.ok ? (
                        <>
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" />
                          <span className="font-medium text-foreground truncate">
                            {p.data.prenom} {p.data.nom}
                          </span>
                          <span className="text-muted-foreground truncate">
                            · {p.data.date_naissance}
                            {p.data.ville && ` · ${p.data.ville}`}
                            {p.data.categorie && ` · ${p.data.categorie}`}
                          </span>
                        </>
                      ) : (
                        <>
                          <AlertCircle className="w-3.5 h-3.5 text-amber-400 flex-shrink-0" />
                          <span className="text-amber-400">{p.reason}</span>
                        </>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>

        <div className="px-6 py-4 border-t border-border flex gap-2 flex-shrink-0">
          <button type="button" onClick={onClose} disabled={importing}
            className="flex-1 border border-border hover:bg-muted disabled:opacity-50 text-foreground py-2 rounded-md text-sm transition-colors">
            Fermer
          </button>
          {!preview ? (
            <button onClick={() => analyze(text)} disabled={!text.trim()}
              className="flex-1 bg-primary hover:bg-primary/90 disabled:opacity-50 text-primary-foreground font-medium py-2 rounded-md text-sm transition-colors">
              Analyser
            </button>
          ) : (
            <button onClick={doImport} disabled={importing || validCount === 0}
              className="flex-1 bg-primary hover:bg-primary/90 disabled:opacity-50 text-primary-foreground font-medium py-2 rounded-md text-sm flex items-center justify-center gap-2 transition-colors">
              {importing
                ? <><Loader2 className="w-4 h-4 animate-spin" /> Import…</>
                : <><Upload className="w-4 h-4" /> Importer {validCount} fiche{validCount > 1 ? 's' : ''}</>}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
