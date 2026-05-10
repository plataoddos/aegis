// Discord watcher built on `discord.js-selfbot-v13` — handles the gateway
// quirks (mega-guild subscriptions, member chunking, voice state caches…)
// for us. We just observe events and persist the ones for watched IDs.

import { Client, type Message, type GuildMember, type VoiceState, type User } from 'discord.js-selfbot-v13';
import { events, watches, tokens, type TokenRow } from './db.js';

export type AccountStatus = 'stopped' | 'starting' | 'ready' | 'error';

// ── Tunables ────────────────────────────────────────────────────────────────
const STARTUP_DELAY_MIN_MS = 2_000;
const STARTUP_DELAY_MAX_MS = 8_000;
const LOGIN_TIMEOUT_MS     = 35_000;

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const rand  = (a: number, b: number) => a + Math.floor(Math.random() * (b - a));

// ── Public types ────────────────────────────────────────────────────────────
export interface AccountInfo {
  id: number;
  label: string | null;
  enabled: boolean;
  token_preview: string;
  status: AccountStatus;
  username: string | null;
  user_id: string | null;
  guilds: number;
  ping: number | null;
  last_error: string | null;
}

// ── Pub/sub for live frontend stream ────────────────────────────────────────
type Listener = (evt: any) => void;
const listeners = new Set<Listener>();
export function onEvent(fn: Listener)  { listeners.add(fn); }
export function offEvent(fn: Listener) { listeners.delete(fn); }
function emitLive(evt: any) { for (const fn of listeners) try { fn(evt); } catch {} }

// ── Watch list ──────────────────────────────────────────────────────────────
const watchedIds = new Set<string>();

export function refreshWatchedIds() {
  watchedIds.clear();
  for (const id of watches.ids()) watchedIds.add(id);
}
function isWatched(id: string | null | undefined): boolean {
  return !!id && watchedIds.has(id);
}

function previewToken(token: string): string {
  if (token.length < 16) return '•'.repeat(token.length);
  return token.slice(0, 8) + '•'.repeat(12) + token.slice(-4);
}

function record(userId: string, type: string, data: Partial<{
  guild_id: string; guild_name: string;
  channel_id: string; channel_name: string;
  content: string; extra: Record<string, unknown>;
}>) {
  const created_at = Date.now();
  const id = events.insert({
    user_id:      userId,
    type,
    guild_id:     data.guild_id     ?? null,
    guild_name:   data.guild_name   ?? null,
    channel_id:   data.channel_id   ?? null,
    channel_name: data.channel_name ?? null,
    content:      data.content      ?? null,
    extra_json:   data.extra ? JSON.stringify(data.extra) : null,
  });
  emitLive({
    id, user_id: userId, type, created_at,
    guild_id: data.guild_id ?? null, guild_name: data.guild_name ?? null,
    channel_id: data.channel_id ?? null, channel_name: data.channel_name ?? null,
    content: data.content ?? null,
    extra_json: data.extra ? JSON.stringify(data.extra) : null,
  });
}

// ── Per-account state ───────────────────────────────────────────────────────
interface Account {
  row:        TokenRow;
  client:     Client | null;
  status:     AccountStatus;
  lastError:  string | null;
}

const pool = new Map<number, Account>();

function bindEvents(acc: Account) {
  const c = acc.client!;
  const tag = `[acc ${acc.row.id}${acc.row.label ? ' ' + acc.row.label : ''}]`;

  c.on('ready', () => {
    acc.status = 'ready';
    acc.lastError = null;
    console.log(tag, 'ready as', c.user?.username, '— guilds:', c.guilds.cache.size);
  });

  c.on('error', (e: any) => console.error(tag, 'error:', e?.message || e));
  c.on('shardDisconnect' as any, (e: any) => console.warn(tag, 'shardDisconnect', e?.code));
  c.on('shardReconnecting' as any, () => console.log(tag, 'reconnecting…'));
  c.on('shardError' as any, (e: any) => console.error(tag, 'shardError:', e?.message));

  // ── Messages ─────────────────────────────────────────────────────────────
  c.on('messageCreate', (msg: Message) => {
    if (msg.author?.bot) return;
    if (!isWatched(msg.author?.id)) return;
    record(msg.author.id, 'message_create', {
      guild_id:     msg.guild?.id   || undefined,
      guild_name:   msg.guild?.name || undefined,
      channel_id:   msg.channel?.id || undefined,
      channel_name: (msg.channel as any)?.name || undefined,
      content:      msg.content?.slice(0, 4000) || undefined,
      extra: {
        message_id:  msg.id,
        attachments: [...msg.attachments.values()].map(a => ({ url: a.url, name: a.name, type: a.contentType })),
      },
    });
  });

  c.on('messageUpdate', (_old, newMsg: any) => {
    const m: Message = newMsg.partial ? newMsg : newMsg;
    if (!m?.author || m.author.bot) return;
    if (!isWatched(m.author.id)) return;
    record(m.author.id, 'message_update', {
      guild_id:     m.guild?.id   || undefined,
      guild_name:   m.guild?.name || undefined,
      channel_id:   m.channel?.id || undefined,
      channel_name: (m.channel as any)?.name || undefined,
      content:      m.content?.slice(0, 4000) || undefined,
      extra:        { message_id: m.id },
    });
  });

  c.on('messageDelete', (msg: any) => {
    const authorId = msg?.author?.id;
    if (!authorId || !isWatched(authorId)) return;
    record(authorId, 'message_delete', {
      guild_id:     msg.guild?.id   || undefined,
      guild_name:   msg.guild?.name || undefined,
      channel_id:   msg.channel?.id || undefined,
      channel_name: (msg.channel as any)?.name || undefined,
      content:      msg.content?.slice(0, 4000) || undefined,
      extra:        { message_id: msg.id },
    });
  });

  // ── Guild membership ─────────────────────────────────────────────────────
  c.on('guildMemberAdd', (member: GuildMember) => {
    if (!isWatched(member.user?.id)) return;
    record(member.user.id, 'guild_join', {
      guild_id:   member.guild?.id   || undefined,
      guild_name: member.guild?.name || undefined,
      extra: {
        username:       member.user.username,
        account_age_ms: Date.now() - member.user.createdTimestamp,
      },
    });
  });

  c.on('guildMemberRemove', (member: any) => {
    if (!isWatched(member.user?.id)) return;
    record(member.user.id, 'guild_leave', {
      guild_id:   member.guild?.id   || undefined,
      guild_name: member.guild?.name || undefined,
      extra:      { username: member.user.username },
    });
  });

  c.on('guildMemberUpdate', (oldM: any, newM: any) => {
    if (!isWatched(newM.user?.id)) return;
    // Nickname change
    if (oldM.nickname !== newM.nickname) {
      record(newM.user.id, 'nickname_change', {
        guild_id:   newM.guild?.id   || undefined,
        guild_name: newM.guild?.name || undefined,
        extra: { from: oldM.nickname, to: newM.nickname },
      });
    }
    // Role diff
    const oldR = new Set<string>([...oldM.roles.cache.keys()].map(String));
    const newR = new Set<string>([...newM.roles.cache.keys()].map(String));
    const added:   { id: string; name: string }[] = [];
    const removed: { id: string; name: string }[] = [];
    for (const id of newR) if (!oldR.has(id)) {
      const r = newM.roles.cache.get(id);
      if (r) added.push({ id, name: r.name });
    }
    for (const id of oldR) if (!newR.has(id)) {
      const r = oldM.roles.cache.get(id);
      if (r) removed.push({ id, name: r.name });
    }
    if (added.length || removed.length) {
      record(newM.user.id, 'roles_change', {
        guild_id:   newM.guild?.id   || undefined,
        guild_name: newM.guild?.name || undefined,
        extra:      { added, removed },
      });
    }
    // Timeout
    if (oldM.communicationDisabledUntilTimestamp !== newM.communicationDisabledUntilTimestamp && newM.communicationDisabledUntilTimestamp) {
      record(newM.user.id, 'timeout', {
        guild_id:   newM.guild?.id   || undefined,
        guild_name: newM.guild?.name || undefined,
        extra:      { until: newM.communicationDisabledUntilTimestamp },
      });
    }
  });

  // ── Voice ────────────────────────────────────────────────────────────────
  c.on('voiceStateUpdate', (oldS: VoiceState, newS: VoiceState) => {
    const userId = (newS.member?.user?.id || oldS.member?.user?.id) as string | undefined;
    if (!isWatched(userId)) return;
    const guild = newS.guild || oldS.guild;
    const oldCh = oldS.channel;
    const newCh = newS.channel;
    const oldChAny: any = oldCh;
    const newChAny: any = newCh;
    if (!oldChAny && newChAny) {
      record(userId!, 'voice_join', {
        guild_id:     guild?.id   || undefined,
        guild_name:   guild?.name || undefined,
        channel_id:   newChAny.id,
        channel_name: newChAny.name,
      });
    } else if (oldChAny && !newChAny) {
      record(userId!, 'voice_leave', {
        guild_id:     guild?.id   || undefined,
        guild_name:   guild?.name || undefined,
        channel_id:   oldChAny.id,
        channel_name: oldChAny.name,
      });
    } else if (oldChAny && newChAny && oldChAny.id !== newChAny.id) {
      record(userId!, 'voice_move', {
        guild_id:     guild?.id   || undefined,
        guild_name:   guild?.name || undefined,
        channel_id:   newChAny.id,
        channel_name: newChAny.name,
        extra:        { from_channel: { id: oldChAny.id, name: oldChAny.name } },
      });
    }
    // Same channel = mute/deaf/cam toggles → ignored (noise)
  });
}

async function loginWithTimeout(client: Client, token: string) {
  return new Promise<void>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`login timeout (${LOGIN_TIMEOUT_MS / 1000}s)`)), LOGIN_TIMEOUT_MS);
    client.once('ready', () => { clearTimeout(t); resolve(); });
    client.login(token).catch((e) => { clearTimeout(t); reject(e); });
  });
}

// ── Lifecycle ───────────────────────────────────────────────────────────────
export async function startAccount(id: number, opts: { delay?: boolean } = {}) {
  const acc = pool.get(id);
  if (!acc) throw new Error('account not in pool');
  if (acc.status === 'starting' || acc.status === 'ready') return;

  if (opts.delay) {
    await sleep(rand(STARTUP_DELAY_MIN_MS, STARTUP_DELAY_MAX_MS));
    if (!acc.row.enabled) return;
  }

  acc.status = 'starting';
  acc.lastError = null;

  // Tear down previous client if any
  if (acc.client) {
    try { acc.client.removeAllListeners(); acc.client.destroy(); } catch {}
    acc.client = null;
  }

  const tag = `[acc ${id}${acc.row.label ? ' ' + acc.row.label : ''}]`;
  console.log(tag, 'logging in…');

  const client = new Client({ checkUpdate: false } as any);
  acc.client = client;
  bindEvents(acc);

  try {
    await loginWithTimeout(client, acc.row.token);
  } catch (e: any) {
    acc.status = 'error';
    acc.lastError = e?.message || String(e);
    console.error(tag, 'login failed:', acc.lastError);
    try { client.destroy(); } catch {}
    acc.client = null;
  }
}

export async function stopAccount(id: number) {
  const acc = pool.get(id);
  if (!acc) return;
  if (acc.client) {
    try { acc.client.removeAllListeners(); acc.client.destroy(); } catch {}
    acc.client = null;
  }
  acc.status = 'stopped';
  acc.lastError = null;
}

export async function loadFromDB() {
  refreshWatchedIds();
  for (const row of tokens.list()) {
    if (!pool.has(row.id)) {
      pool.set(row.id, { row, client: null, status: 'stopped', lastError: null });
    }
    if (row.enabled) startAccount(row.id, { delay: true }).catch(() => {});
  }
}

export async function addToken(label: string | null, token: string) {
  const id = tokens.add(label, token);
  const row = tokens.get(id)!;
  pool.set(id, { row, client: null, status: 'stopped', lastError: null });
  startAccount(id).catch(() => {});
  return id;
}

export async function removeAccount(id: number) {
  await stopAccount(id);
  pool.delete(id);
  tokens.remove(id);
}

export async function setEnabled(id: number, enabled: boolean) {
  tokens.setEnabled(id, enabled);
  const acc = pool.get(id);
  if (acc) acc.row.enabled = enabled ? 1 : 0;
  if (enabled) startAccount(id).catch(() => {});
  else         await stopAccount(id);
}

export async function setLabel(id: number, label: string | null) {
  tokens.setLabel(id, label);
  const acc = pool.get(id);
  if (acc) acc.row.label = label;
}

export async function restartAll() {
  const ids = [...pool.keys()];
  for (const id of ids) await stopAccount(id);
  await sleep(rand(2000, 5000));
  for (const id of ids) {
    const acc = pool.get(id);
    if (acc?.row.enabled) startAccount(id, { delay: true }).catch(() => {});
  }
}

// ── Inspection ──────────────────────────────────────────────────────────────
export function listAccounts(): AccountInfo[] {
  return [...pool.values()].map(acc => ({
    id:            acc.row.id,
    label:         acc.row.label,
    enabled:       !!acc.row.enabled,
    token_preview: previewToken(acc.row.token),
    status:        acc.status,
    username:      acc.client?.user?.username ?? null,
    user_id:       acc.client?.user?.id       ?? null,
    guilds:        acc.client?.guilds.cache.size ?? 0,
    ping:          acc.client?.ws.ping ?? null,
    last_error:    acc.lastError,
  }));
}

export function totalGuildCount(): number {
  const set = new Set<string>();
  for (const acc of pool.values()) {
    if (!acc.client) continue;
    for (const id of acc.client.guilds.cache.keys()) set.add(id);
  }
  return set.size;
}

export async function fetchProfile(userId: string) {
  for (const acc of pool.values()) {
    const c = acc.client;
    if (!c || acc.status !== 'ready') continue;
    // Try guild-member endpoint via the lib (works for selfbots that share a guild)
    for (const guild of c.guilds.cache.values()) {
      try {
        const member = await guild.members.fetch(userId);
        const u: User = member.user;
        const avatarHash = u.avatar;
        const avatar = avatarHash
          ? `https://cdn.discordapp.com/avatars/${u.id}/${avatarHash}.${avatarHash.startsWith('a_') ? 'gif' : 'png'}?size=256`
          : `https://cdn.discordapp.com/embed/avatars/${(parseInt(u.id) >> 22) % 6}.png`;
        return {
          id:           u.id,
          username:     u.username,
          global_name:  (u as any).globalName ?? null,
          avatar,
          banner:       null,
          accent_color: null,
          created_at:   u.createdTimestamp,
          bot:          !!u.bot,
        };
      } catch { continue; }
    }
  }
  return null;
}
