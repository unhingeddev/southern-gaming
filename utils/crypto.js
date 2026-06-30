// utils/crypto.js
// AES-256-GCM helpers for encrypting secrets (like SellAuth API keys) at rest.
// We never store raw API keys in the database — only ciphertext that can be
// decrypted with ENCRYPTION_KEY held in the environment.

import crypto from 'node:crypto';
import config from '../config/config.js';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // 96-bit IV recommended for GCM

// Derive and validate the 32-byte key once at module load.
const KEY = Buffer.from(config.security.encryptionKey, 'hex');
if (KEY.length !== 32) {
  throw new Error(
    'ENCRYPTION_KEY must be 64 hex characters (32 bytes). ' +
      'Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"'
  );
}

/**
 * Encrypt a UTF-8 string. Output format: iv:authTag:ciphertext (all hex).
 * @param {string} plaintext
 * @returns {string}
 */
export function encrypt(plaintext) {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, KEY, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [iv.toString('hex'), authTag.toString('hex'), encrypted.toString('hex')].join(':');
}

/**
 * Decrypt a string produced by encrypt(). Returns null on any failure (tampered
 * data, wrong key, malformed input) so callers can fail safe.
 * @param {string} payload
 * @returns {string|null}
 */
export function decrypt(payload) {
  try {
    const [ivHex, tagHex, dataHex] = String(payload).split(':');
    if (!ivHex || !tagHex || !dataHex) return null;
    const decipher = crypto.createDecipheriv(ALGORITHM, KEY, Buffer.from(ivHex, 'hex'));
    decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(dataHex, 'hex')),
      decipher.final(),
    ]);
    return decrypted.toString('utf8');
  } catch {
    return null;
  }
}

/** Mask a secret for display, e.g. "sk_live_1234********cdef". */
export function maskSecret(secret) {
  if (!secret || secret.length < 8) return '••••••••';
  return `${secret.slice(0, 4)}${'•'.repeat(8)}${secret.slice(-4)}`;
}
