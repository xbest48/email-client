import * as crypto from 'crypto';

/**
 * Symmetric encryption used for at-rest sensitive values (IMAP/SMTP passwords,
 * API keys, OAuth tokens, PGP private keys...).
 *
 * Security model:
 *   - AES-256-GCM (authenticated encryption) — detects any tampering.
 *   - ENCRYPTION_KEY is REQUIRED. No insecure default fallback.
 *   - Key format: 32 raw bytes (any of: 32 ASCII chars, 64-char hex, or base64).
 *   - Output format: "v2:<iv-hex>:<tag-hex>:<ciphertext-hex>".
 *   - Legacy values produced by the previous AES-256-CBC implementation
 *     ("<iv-hex>:<ciphertext-hex>") are still decrypted if LEGACY_ENCRYPTION_KEY
 *     is provided, to let operators re-encrypt stored secrets transparently.
 */

const GCM_ALGORITHM = 'aes-256-gcm';
const CBC_ALGORITHM = 'aes-256-cbc';
const IV_LENGTH = 12; // 96 bits, recommended for GCM
const LEGACY_IV_LENGTH = 16;
const KEY_LENGTH = 32;
const VERSION_PREFIX = 'v2';

function deriveKey(raw: string, context: string): Buffer {
  // Accept hex (64 chars), base64 (44 chars incl. padding) or raw (32 chars).
  // Anything else is SHA-256-hashed to 32 bytes so we never silently truncate.
  if (/^[0-9a-fA-F]{64}$/.test(raw)) return Buffer.from(raw, 'hex');
  if (raw.length === KEY_LENGTH) return Buffer.from(raw, 'utf8');
  try {
    const base64 = Buffer.from(raw, 'base64');
    if (base64.length === KEY_LENGTH) return base64;
  } catch {
    /* ignore */
  }
  // Fallback: derive deterministically so a long passphrase keeps working
  // but we never reuse the raw bytes directly.
  return crypto.createHash('sha256').update(`${context}:${raw}`).digest();
}

function loadKey(): Buffer {
  const raw = process.env.ENCRYPTION_KEY;
  if (!raw) {
    throw new Error(
      'ENCRYPTION_KEY environment variable is required. Generate one with ' +
        '`openssl rand -hex 32` and add it to your .env file.',
    );
  }
  return deriveKey(raw, 'ENCRYPTION_KEY');
}

function loadLegacyKey(): Buffer | null {
  const raw = process.env.LEGACY_ENCRYPTION_KEY;
  if (!raw) return null;
  return deriveKey(raw, 'LEGACY_ENCRYPTION_KEY');
}

// Lazy so we can fail fast at first use (after env has been loaded) rather than
// at module import time (which would break tests or CLI tooling).
let cachedKey: Buffer | null = null;
let cachedLegacyKey: Buffer | null | undefined;

function getKey(): Buffer {
  if (!cachedKey) cachedKey = loadKey();
  return cachedKey;
}

function getLegacyKey(): Buffer | null {
  if (cachedLegacyKey === undefined) cachedLegacyKey = loadLegacyKey();
  return cachedLegacyKey;
}

export function encrypt(plaintext: string): string {
  if (typeof plaintext !== 'string') {
    throw new TypeError('encrypt() expects a string');
  }
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(GCM_ALGORITHM, getKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${VERSION_PREFIX}:${iv.toString('hex')}:${tag.toString('hex')}:${ciphertext.toString('hex')}`;
}

export function decrypt(payload: string): string {
  if (typeof payload !== 'string' || payload.length === 0) {
    throw new Error('decrypt() expects a non-empty string');
  }

  const parts = payload.split(':');
  if (parts[0] === VERSION_PREFIX && parts.length === 4) {
    const [, ivHex, tagHex, ctHex] = parts;
    const iv = Buffer.from(ivHex, 'hex');
    const tag = Buffer.from(tagHex, 'hex');
    const ct = Buffer.from(ctHex, 'hex');
    const decipher = crypto.createDecipheriv(GCM_ALGORITHM, getKey(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
  }

  // Legacy CBC format ("<iv-hex>:<ciphertext-hex>"). We try the current key,
  // then the explicit legacy key if configured. No unauthenticated fallback
  // is accepted when neither is provided.
  if (parts.length === 2) {
    const [ivHex, ctHex] = parts;
    const iv = Buffer.from(ivHex, 'hex');
    const ct = Buffer.from(ctHex, 'hex');

    for (const candidate of [getKey(), getLegacyKey()].filter(Boolean) as Buffer[]) {
      try {
        const decipher = crypto.createDecipheriv(CBC_ALGORITHM, candidate, iv);
        return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
      } catch {
        /* try next key */
      }
    }
    throw new Error('Legacy ciphertext cannot be decrypted with the provided keys');
  }

  throw new Error('Unsupported ciphertext format');
}

/**
 * Re-encrypt a stored value with the current key/algorithm if it still uses the
 * legacy format. Returns the (possibly unchanged) value to persist.
 */
export function upgradeCiphertext(payload: string): string {
  if (!payload) return payload;
  if (payload.startsWith(`${VERSION_PREFIX}:`)) return payload;
  const plaintext = decrypt(payload);
  return encrypt(plaintext);
}
