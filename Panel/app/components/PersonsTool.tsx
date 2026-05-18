import { useEffect, useMemo, useState } from 'react';
import {
  Plus, Trash2, Search, X, User, MapPin, Mail, Phone, Calendar, Hash,
  CreditCard, Building2, FileText, Edit3, Copy, Code, Loader2, AlertCircle,
  Upload, FileUp, CheckCircle2,
} from 'lucide-react';
import { toast } from 'sonner';

const API_URL   = ((import.meta as any).env?.VITE_WATCHER_API_URL  as string) || 'http://localhost:8787';
const API_TOKEN = ((import.meta as any).env?.VITE_WATCHER_API_TOKEN as string) || '';

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
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${API_TOKEN}`, ...(init?.headers || {}) },
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

  const allocPrenom = raw.allocataire_prenom || raw.parent_1?.prenom;
  const allocNom    = raw.allocataire_nom    || raw.parent_1?.nom;
  const allocaire   = (allocPrenom || allocNom)
    ? [allocPrenom, allocNom].filter(Boolean).join(' ')
    : null;

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
    email_alloc:    joinList(raw.allocataire_email || raw.email || raw.parent_1?.email),
    tel_alloc:      joinList(raw.allocataire_phone || raw.phone   || raw.parent_1?.phone),
    iban:           raw.iban || null,
    bic:            raw.bic  || null,
    categorie:      raw.provider || raw.categorie || raw.outil || null,
    ext_id:         raw.identifier || raw.id || null,
    notes:          raw.source_file || raw.file || null,
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
      <div className="bg-card border border-border rounded-xl p-10 text-center">
        <AlertCircle className="w-10 h-10 text-destructive mx-auto mb-3" />
        <h3 className="text-foreground font-semibold mb-1">Erreur</h3>
        <p className="text-sm text-muted-foreground mb-4 font-mono">{error}</p>
        <button onClick={refresh} className="text-sm border border-border rounded-md px-4 py-2 hover:bg-muted text-foreground">
          Réessayer
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="bg-card border border-border rounded-xl px-5 py-3 flex items-center gap-4 flex-wrap">
        <div className="flex items-center gap-2">
          <User className="w-4 h-4 text-muted-foreground" />
          <span className="text-sm font-medium text-foreground">Fiches</span>
        </div>
        <div className="h-5 w-px bg-border" />
        <span className="text-sm text-muted-foreground">
          <span className="text-foreground font-semibold tabular-nums">{list.length}</span> {list.length > 1 ? 'fiches' : 'fiche'}
        </span>
        <div className="ml-auto flex items-center gap-2">
          <button onClick={() => setShowImport(true)}
            className="border border-border hover:bg-muted text-foreground px-3 py-2 rounded-md text-sm font-medium flex items-center gap-2 transition-colors">
            <Upload className="w-4 h-4" /> Importer JSON
          </button>
          <button onClick={openCreate}
            className="bg-primary hover:bg-primary/90 text-primary-foreground px-4 py-2 rounded-md text-sm font-medium flex items-center gap-2 transition-colors">
            <Plus className="w-4 h-4" /> Nouvelle fiche
          </button>
        </div>
      </div>

      {/* Main grid */}
      <div className="grid gap-4 lg:grid-cols-[300px_1fr]">

        {/* List */}
        <aside className="bg-card border border-border rounded-xl flex flex-col overflow-hidden h-[calc(100vh-220px)] min-h-[480px]">
          <div className="p-3 border-b border-border flex-shrink-0">
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input value={search} onChange={e => setSearch(e.target.value)}
                placeholder="Rechercher…"
                className="w-full text-xs bg-input border border-border rounded-md pl-8 pr-7 py-2 text-foreground placeholder:text-muted-foreground/70 focus:outline-none focus:ring-1 focus:ring-ring" />
              {search && (
                <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>
          </div>

          <div className="overflow-y-auto flex-1">
            {loading ? (
              <div className="p-8 text-center text-sm text-muted-foreground">
                <Loader2 className="w-5 h-5 animate-spin mx-auto mb-2" /> Chargement…
              </div>
            ) : filtered.length === 0 ? (
              <div className="p-8 text-center">
                <User className="w-8 h-8 text-muted-foreground/40 mx-auto mb-2" />
                <p className="text-sm text-muted-foreground mb-3">
                  {list.length === 0 ? 'Aucune fiche' : 'Aucun résultat'}
                </p>
                {list.length === 0 && (
                  <button onClick={openCreate} className="text-xs text-foreground border border-border rounded-md px-3 py-1.5 hover:bg-muted">
                    Créer la première
                  </button>
                )}
              </div>
            ) : filtered.map((p, idx) => {
              const active = selectedId === p.id;
              return (
                <div key={p.id} className={`group relative border-b border-border last:border-0 transition-colors ${
                  active ? 'bg-muted' : 'hover:bg-muted/40'
                }`}>
                  <button onClick={() => setSelectedId(p.id)} className="w-full px-3 py-3 pr-9 flex items-center gap-3 text-left">
                    <div className="w-9 h-9 rounded-md bg-primary/15 flex items-center justify-center text-xs text-primary font-semibold flex-shrink-0">
                      {initials(p) || (idx + 1)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-foreground text-sm font-medium truncate">
                        {p.prenom} {p.nom}
                      </p>
                      <p className="text-xs text-muted-foreground truncate">
                        {p.categorie || fmtDate(p.date_naissance) || p.ville || '—'}
                      </p>
                    </div>
                  </button>
                  <button onClick={(e) => { e.stopPropagation(); remove(p); }}
                    title="Supprimer"
                    className="absolute opacity-0 group-hover:opacity-100 right-2 top-1/2 -translate-y-1/2 p-1.5 rounded text-muted-foreground hover:text-destructive hover:bg-background transition-all">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              );
            })}
          </div>
        </aside>

        {/* Detail */}
        <section className="bg-card border border-border rounded-xl overflow-hidden h-[calc(100vh-220px)] min-h-[480px] overflow-y-auto">
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
              <User className="w-10 h-10 text-muted-foreground/40 mb-3" />
              <p className="text-sm text-muted-foreground mb-1">Aucune fiche sélectionnée</p>
              <p className="text-xs text-muted-foreground/70">Sélectionne une fiche à gauche ou crée-en une nouvelle.</p>
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
      {/* Top bar */}
      <div className="px-6 py-4 flex items-center gap-4 border-b border-border">
        <div className="w-10 h-10 rounded-md bg-primary/15 text-primary font-semibold flex items-center justify-center text-sm">
          {index}
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="text-foreground font-bold text-lg uppercase tracking-wide truncate">
            {p.prenom} {p.nom}
          </h2>
          {p.categorie && <p className="text-xs text-muted-foreground uppercase tracking-wider mt-0.5">{p.categorie}</p>}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <button onClick={onEdit} title="Modifier"
            className="border border-border hover:bg-muted text-foreground px-3 py-1.5 rounded-md text-xs flex items-center gap-1.5 transition-colors">
            <Edit3 className="w-3.5 h-3.5" /> Modifier
          </button>
          <button onClick={onCopyAll} title="Copier la fiche"
            className="border border-border hover:bg-muted text-foreground px-3 py-1.5 rounded-md text-xs flex items-center gap-1.5 transition-colors">
            <Copy className="w-3.5 h-3.5" /> Copier
          </button>
          <button onClick={onCopyJSON} title="Copier en JSON"
            className="border border-primary/40 bg-primary/10 hover:bg-primary/20 text-primary px-3 py-1.5 rounded-md text-xs flex items-center gap-1.5 transition-colors">
            <Code className="w-3.5 h-3.5" /> JSON
          </button>
        </div>
      </div>

      {/* Sections */}
      <Section title="Identité">
        <Field icon={User}     iconBg="bg-primary/10"    iconColor="text-primary"     label="Nom"             value={p.nom} />
        <Field icon={User}     iconBg="bg-primary/10"    iconColor="text-primary"     label="Prénom"          value={p.prenom} />
        <Field icon={User}     iconBg="bg-primary/10"    iconColor="text-primary"     label="Genre"           value={p.genre} />
        <Field icon={Calendar} iconBg="bg-purple-500/15" iconColor="text-purple-400"  label="Date de naissance" value={fmtDate(p.date_naissance)} />
      </Section>

      <Section title="Contact">
        <Field icon={MapPin} iconBg="bg-orange-500/15" iconColor="text-orange-400" label="Adresse"     value={p.adresse} />
        <Field icon={MapPin} iconBg="bg-orange-500/15" iconColor="text-orange-400" label="Complément"  value={p.complement} />
        <Field icon={Hash}   iconBg="bg-amber-500/15"  iconColor="text-amber-400"  label="Code postal" value={p.code_postal} />
        <Field icon={Building2} iconBg="bg-yellow-500/15" iconColor="text-yellow-400" label="Ville"   value={p.ville} />
      </Section>

      <Section title="Allocataire">
        <Field icon={User}  iconBg="bg-emerald-500/15" iconColor="text-emerald-400" label="Allocataire" value={p.allocataire} />
        <Field icon={Hash}  iconBg="bg-zinc-500/15"    iconColor="text-zinc-400"    label="Matricule"   value={p.matricule}  mono />
        <Field icon={Mail}  iconBg="bg-sky-500/15"     iconColor="text-sky-400"     label="Email alloc." value={p.email_alloc} />
        <Field icon={Phone} iconBg="bg-emerald-500/15" iconColor="text-emerald-400" label="Tél. alloc." value={p.tel_alloc} multiline />
      </Section>

      {(p.iban || p.bic) && (
        <Section title="Bancaire">
          <Field icon={CreditCard} iconBg="bg-rose-500/15" iconColor="text-rose-400" label="IBAN" value={p.iban} mono />
          <Field icon={CreditCard} iconBg="bg-rose-500/15" iconColor="text-rose-400" label="BIC"  value={p.bic}  mono />
        </Section>
      )}

      <Section title="Extra">
        <Field icon={Hash}     iconBg="bg-zinc-500/15" iconColor="text-zinc-400" label="ID"    value={p.ext_id} mono />
        <Field icon={FileText} iconBg="bg-zinc-500/15" iconColor="text-zinc-400" label="Notes" value={p.notes} multiline />
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <>
      <div className="px-6 py-2 bg-muted/40 border-b border-border">
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">{title}</p>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 border-b border-border">
        {children}
      </div>
    </>
  );
}

function Field({ icon: Icon, iconBg, iconColor, label, value, mono, multiline }: {
  icon: any; iconBg: string; iconColor: string; label: string;
  value: string | null | undefined; mono?: boolean; multiline?: boolean;
}) {
  const has = value && value !== '';
  return (
    <div className="px-4 py-3 border-r border-border last:border-r-0 last:[&_*]:break-words">
      <div className="flex items-center gap-1.5 mb-1.5">
        <div className={`w-5 h-5 rounded ${iconBg} flex items-center justify-center flex-shrink-0`}>
          <Icon className={`w-3 h-3 ${iconColor}`} />
        </div>
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">{label}</span>
      </div>
      <p className={`text-sm ${has ? 'text-foreground font-medium' : 'text-muted-foreground/40'} ${mono ? 'font-mono text-xs' : ''} ${multiline ? 'whitespace-pre-line' : 'truncate'}`}>
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
