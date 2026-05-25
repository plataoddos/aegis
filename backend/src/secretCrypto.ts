/**
 * Symmetric encryption helper for **secrets at rest** (Discord selfbot tokens).
 *
 * - Algorithm   : AES-256-GCM (12-byte IV, 16-byte tag).
 * - Key source  : process.env.MASTER_KEY (hex/base64, ≥32 bytes raw) OR a key
 *                 auto-generated on first boot and stored in `data/.master_key`
 *                 (chmod 600). The auto-generated path is convenient for solo
 *                 deployments; production users should set MASTER_KEY in env.
 * - Format      : `enc:v1:<iv_b64>:<tag_b64>:<ct_b64>` — versioned so we can
 *                 rotate algorithms later without breaking decryption.
 * - Fallback    : `decryptSecret()` returns the raw value untouched if it does
 *                 not match the `enc:v1:` prefix, so legacy plaintext rows
 *                 keep working until they're rewritten.
 *
 * Threat model : protects against an attacker who exfiltrates `data.sqlite`
 * (backups, stolen disk image). Does NOT protect against a fully-compromised
 * host where MASTER_KEY is also readable.
 */
import {
  createCipheriv, createDecipheriv, randomBytes, createHash,
} from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, chmodSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';

const ENC_PREFIX = 'enc:v1:';

function loadOrCreateKey(): Buffer {
  // 1. Prefer env var (production-grade).
  const fromEnv = process.env.MASTER_KEY;
  if (fromEnv && fromEnv.length >= 32) {
    // Accept hex or base64 ; otherwise hash to 32 bytes for convenience.
    try {
      const buf = Buffer.from(fromEnv, /^[0-9a-f]+$/i.test(fromEnv) ? 'hex' : 'base64');
      if (buf.length >= 32) return buf.subarray(0, 32);
    } catch {}
    return createHash('sha256').update(fromEnv).digest();
  }

  // 2. Fallback : auto-generated key, persisted next to the DB.
  const path = resolve(process.cwd(), 'data', '.master_key');
  try {
    if (existsSync(path)) {
      const raw = readFileSync(path, 'utf8').trim();
      const buf = Buffer.from(raw, 'base64');
      if (buf.length === 32) return buf;
    }
  } catch {}

  const key = randomBytes(32);
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, key.toString('base64'), { mode: 0o600 });
    chmodSync(path, 0o600);
    console.warn(`[secretCrypto] auto-generated MASTER_KEY at ${path} (chmod 600). Consider moving it to an env variable.`);
  } catch (e) {
    console.warn('[secretCrypto] could not persist auto-generated MASTER_KEY — secrets will not survive a restart!', e);
  }
  return key;
}

const KEY = loadOrCreateKey();

/** Encrypts an arbitrary UTF-8 string. Always returns a versioned envelope. */
export function encryptSecret(plain: string): string {
  const iv     = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', KEY, iv);
  const ct     = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag    = cipher.getAuthTag();
  return [
    ENC_PREFIX.slice(0, -1),
    iv.toString('base64'),
    tag.toString('base64'),
    ct.toString('base64'),
  ].join(':');
}

/**
 * Decrypts an `enc:v1:` envelope. If the input doesn't start with the prefix,
 * returns it unchanged (legacy plaintext compatibility).
 */
export function decryptSecret(envelope: string): string {
  if (!envelope || !envelope.startsWith(ENC_PREFIX)) return envelope;
  const parts = envelope.split(':');
  // parts = ['enc', 'v1', iv, tag, ct]
  if (parts.length !== 5) return envelope;
  try {
    const iv  = Buffer.from(parts[2], 'base64');
    const tag = Buffer.from(parts[3], 'base64');
    const ct  = Buffer.from(parts[4], 'base64');
    const decipher = createDecipheriv('aes-256-gcm', KEY, iv);
    decipher.setAuthTag(tag);
    const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
    return pt.toString('utf8');
  } catch (e) {
    // Wrong key, tampering, or unknown version → fail closed.
    throw new Error('secret_decryption_failed');
  }
}

/** True if the envelope looks already-encrypted (so we don't double-encrypt). */
export function isEncrypted(s: string): boolean {
  return typeof s === 'string' && s.startsWith(ENC_PREFIX);
}
