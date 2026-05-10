import { useState } from 'react';
import { Search, Loader2, Copy, Check, Hash, Key, Link, Webhook, User } from 'lucide-react';
import { toast } from 'sonner';

const TOOLS = [
  { id: 'snowflake', label: 'Snowflake',  icon: Hash,    placeholder: '1234567890123456789',          desc: 'Décode un ID Discord (Snowflake) — extrait la date de création, worker, process' },
  { id: 'token',     label: 'Token',      icon: Key,     placeholder: 'eyJ... ou MTI...',             desc: 'Décode un token Discord — extrait l\'user ID, la date de création' },
  { id: 'invite',    label: 'Invite',     icon: Link,    placeholder: 'discord.gg/CODE ou juste CODE',desc: 'Infos sur une invitation — serveur, membres, statut' },
  { id: 'webhook',   label: 'Webhook',    icon: Webhook, placeholder: 'https://discord.com/api/webhooks/...', desc: 'Inspecte un webhook Discord — nom, canal, serveur' },
  { id: 'profil',    label: 'Profil',     icon: User,    placeholder: 'User ID (snowflake)',           desc: 'Infos publiques d\'un utilisateur via son Snowflake' },
];

const DISCORD_EPOCH = 1420070400000n;

function decodeSnowflake(id: string) {
  const bigId     = BigInt(id);
  const timestamp = Number((bigId >> 22n) + DISCORD_EPOCH);
  const workerId  = Number((bigId & 0x3E0000n) >> 17n);
  const processId = Number((bigId & 0x1F000n) >> 12n);
  const increment = Number(bigId & 0xFFFn);
  const date      = new Date(timestamp);
  return { timestamp, date: date.toLocaleString('fr-FR'), dateISO: date.toISOString(), workerId, processId, increment };
}

function decodeToken(token: string) {
  const parts = token.split('.');
  if (parts.length < 2) throw new Error('Token invalide');
  const userIdB64 = parts[0];
  const userIdDecoded = atob(userIdB64.replace(/-/g, '+').replace(/_/g, '/'));
  const userId = userIdDecoded;

  let tokenTimestamp: string | null = null;
  if (parts[1]) {
    try {
      const hmacPart = parts[1];
      const padded   = hmacPart + '==='.slice(hmacPart.length % 4 || 4);
      const bytes    = atob(padded.replace(/-/g, '+').replace(/_/g, '/'));
      const ts       = new DataView(new Uint8Array([...bytes].map(c => c.charCodeAt(0))).buffer).getInt32(0, false);
      tokenTimestamp = new Date((ts + 1293840000) * 1000).toLocaleString('fr-FR');
    } catch { tokenTimestamp = 'Non décodable'; }
  }

  const snowflake = /^\d{17,19}$/.test(userId) ? decodeSnowflake(userId) : null;
  return { userId, tokenTimestamp, snowflake };
}

function Row({ label, value }: { label: string; value: string }) {
  const [c, setC] = useState(false);
  return (
    <div className="flex items-start justify-between py-2.5 border-b border-border last:border-0 gap-4">
      <span className="text-muted-foreground text-sm shrink-0 w-36">{label}</span>
      <span className="text-foreground text-sm flex-1 break-all font-mono">{value}</span>
      <button onClick={() => { navigator.clipboard.writeText(value); setC(true); setTimeout(() => setC(false), 1500); }}
        className="text-muted-foreground hover:text-primary shrink-0">
        {c ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
      </button>
    </div>
  );
}

export function DiscordTool() {
  const [activeTool, setActiveTool] = useState('snowflake');
  const [input, setInput]           = useState('');
  const [loading, setLoading]       = useState(false);
  const [result, setResult]         = useState<Record<string, string> | null>(null);
  const [rawJson, setRawJson]       = useState<any>(null);

  const current = TOOLS.find(t => t.id === activeTool)!;

  const reset = () => { setResult(null); setRawJson(null); setInput(''); };

  const run = async () => {
    if (!input.trim() || loading) return;
    setResult(null);
    setRawJson(null);

    // ── Client-side tools ──
    if (activeTool === 'snowflake') {
      try {
        const s = decodeSnowflake(input.trim());
        setResult({
          'ID Snowflake':     input.trim(),
          'Date de création': s.date,
          'Date ISO':         s.dateISO,
          'Timestamp (ms)':   String(s.timestamp),
          'Worker ID':        String(s.workerId),
          'Process ID':       String(s.processId),
          'Incrément':        String(s.increment),
        });
        toast.success('Snowflake décodé');
      } catch { toast.error('ID invalide'); }
      return;
    }

    if (activeTool === 'token') {
      try {
        const t = decodeToken(input.trim());
        const r: Record<string, string> = {
          'User ID (brut)': t.userId,
        };
        if (t.snowflake) {
          r['Date de création'] = t.snowflake.date;
          r['Timestamp ISO']    = t.snowflake.dateISO;
        }
        if (t.tokenTimestamp) r['Token émis ~'] = t.tokenTimestamp;
        r['⚠ Avertissement'] = 'Ne jamais partager un token Discord — invalidez-le immédiatement si exposé';
        setResult(r);
        toast.success('Token analysé');
      } catch (e: any) { toast.error('Erreur', { description: e.message }); }
      return;
    }

    // ── API tools ──
    setLoading(true);
    try {
      if (activeTool === 'invite') {
        const code = input.trim().replace(/^.*discord\.gg\//i, '').replace(/^.*discord\.com\/invite\//i, '').trim();
        const res  = await fetch(`https://discord.com/api/v10/invites/${code}?with_counts=true&with_expiration=true`);
        if (!res.ok) throw new Error(`HTTP ${res.status} — invitation invalide ou expirée`);
        const json = await res.json();
        setRawJson(json);
        const r: Record<string, string> = {
          'Code':               json.code,
          'Type':               json.type === 0 ? 'Invitation normale' : `Type ${json.type}`,
        };
        if (json.guild) {
          r['Serveur']          = json.guild.name;
          r['ID Serveur']       = json.guild.id;
          r['Description']      = json.guild.description || 'Aucune';
          r['Niveau boost']     = `Tier ${json.guild.premium_tier ?? 0}`;
          r['Fonctionnalités']  = json.guild.features?.join(', ') || 'Aucune';
        }
        if (json.channel) {
          r['Canal']            = `#${json.channel.name}`;
          r['ID Canal']         = json.channel.id;
          r['Type canal']       = json.channel.type === 0 ? 'Texte' : json.channel.type === 2 ? 'Vocal' : `Type ${json.channel.type}`;
        }
        if (json.inviter) {
          r['Créé par']         = `${json.inviter.username}${json.inviter.discriminator !== '0' ? '#' + json.inviter.discriminator : ''}`;
          r['ID Invitant']      = json.inviter.id;
        }
        r['Membres en ligne']   = json.approximate_presence_count != null ? `${json.approximate_presence_count.toLocaleString()}` : 'N/A';
        r['Membres total']      = json.approximate_member_count   != null ? `${json.approximate_member_count.toLocaleString()}`   : 'N/A';
        if (json.expires_at) r['Expire le'] = new Date(json.expires_at).toLocaleString('fr-FR');
        setResult(r);
        toast.success('Invitation analysée');
      }

      else if (activeTool === 'webhook') {
        const url = input.trim();
        if (!url.startsWith('https://discord.com/api/webhooks/') && !url.startsWith('https://discordapp.com/api/webhooks/'))
          throw new Error('URL de webhook invalide');
        const res  = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status} — webhook introuvable ou supprimé`);
        const json = await res.json();
        setRawJson(json);
        const r: Record<string, string> = {
          'ID Webhook':    json.id,
          'Nom':           json.name || 'Aucun',
          'Type':          json.type === 1 ? 'Incoming' : json.type === 2 ? 'Channel Follower' : `Type ${json.type}`,
          'ID Canal':      json.channel_id,
          'ID Serveur':    json.guild_id || 'N/A',
          'ID Application':json.application_id || 'N/A',
          'Avatar':        json.avatar ? `https://cdn.discordapp.com/avatars/${json.id}/${json.avatar}.png` : 'Aucun',
        };
        if (json.user) r['Créé par'] = `${json.user.username} (${json.user.id})`;
        r['⚠ Avertissement'] = 'URL de webhook sensible — ne jamais la partager publiquement';
        setResult(r);
        toast.success('Webhook inspecté');
      }

      else if (activeTool === 'profil') {
        const id = input.trim();
        let snowInfo: Record<string, string> = {};
        try {
          const s = decodeSnowflake(id);
          snowInfo = {
            'Date de création': s.date,
            'Timestamp ISO':    s.dateISO,
          };
        } catch {}

        setResult({
          'User ID':             id,
          ...snowInfo,
          'Avatar URL (guess)':  `https://cdn.discordapp.com/embed/avatars/${Number(BigInt(id) % 5n)}.png`,
          'Profil public':       `https://discord.com/users/${id}`,
          'ℹ Info':              'Les données complètes (username, avatar réel) nécessitent un bot token — ajoutez le dans Webhook si nécessaire',
        });
        toast.success('Snowflake décodé');
      }
    } catch (e: any) {
      toast.error('Erreur', { description: e.message });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Tabs */}
      <div className="flex gap-2 flex-wrap">
        {TOOLS.map(t => {
          const Icon = t.icon;
          return (
            <button key={t.id} onClick={() => { setActiveTool(t.id); reset(); }}
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
            {loading ? 'Analyse...' : 'Analyser'}
          </button>
        </div>
      </div>

      {/* Results */}
      {result && (
        <div className="bg-card border border-border rounded-lg p-6 space-y-0">
          <div className="flex items-center justify-between mb-4">
            <span className="text-foreground font-medium text-sm">Résultats — <span className="text-primary">{current.label}</span></span>
            <button onClick={() => { navigator.clipboard.writeText(JSON.stringify(result, null, 2)); toast.success('Copié'); }}
              className="flex items-center gap-1 text-sm text-muted-foreground hover:text-primary">
              <Copy className="w-4 h-4" />Copier
            </button>
          </div>
          {Object.entries(result).map(([k, v]) => <Row key={k} label={k} value={v} />)}
          {rawJson && (
            <details className="mt-4">
              <summary className="text-xs text-muted-foreground cursor-pointer hover:text-primary">Voir JSON brut de l'API</summary>
              <pre className="text-xs text-green-400 font-mono whitespace-pre-wrap bg-black/40 border border-green-900/30 rounded-md p-4 mt-2 max-h-64 overflow-y-auto">
                {JSON.stringify(rawJson, null, 2)}
              </pre>
            </details>
          )}
        </div>
      )}
    </div>
  );
}
