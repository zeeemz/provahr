import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { env } from '../env';
import { AppError } from './http';

// AES-256-GCM secret box for credentials stored in the database (currently:
// LLM provider API keys). Zero dependencies: node:crypto only.
//
// Wire format: `v1.<iv>.<authTag>.<ciphertext>` — each segment base64url,
// 12-byte random IV, 16-byte auth tag. The `v1.` prefix leaves room for a
// future key-rotation envelope format.

const PREFIX = 'v1.';
const IV_LENGTH = 12;
const TAG_LENGTH = 16;

/**
 * Derives the AES-256 key from the CURRENT value of SECRETS_KEY on every
 * call (never cached in module state) so the env var can be rotated without
 * a restart. Reads process.env first — the validated `env` snapshot is only
 * the fallback for the boot-time default.
 */
function deriveKey(): Buffer {
  const raw = process.env.SECRETS_KEY ?? env.SECRETS_KEY;
  return createHash('sha256').update(raw, 'utf8').digest();
}

/** Encrypts a secret. Fresh random IV per call — two calls never match. */
export function encryptSecret(plain: string): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv('aes-256-gcm', deriveKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return PREFIX + [iv, authTag, ciphertext].map((b) => b.toString('base64url')).join('.');
}

/**
 * Decrypts a secret produced by `encryptSecret`. ANY failure — tampered
 * payload, wrong SECRETS_KEY, malformed base64 — throws the same AppError;
 * callers never learn more than "your key changed", and attackers never learn
 * why their forgery was rejected.
 */
export function decryptSecret(payload: string): string {
  try {
    if (!payload.startsWith(PREFIX)) {
      throw new Error('missing v1 prefix');
    }
    const parts = payload.slice(PREFIX.length).split('.');
    if (parts.length !== 3) {
      throw new Error('unexpected segment count');
    }
    const [iv, authTag, ciphertext] = parts.map((p) => Buffer.from(p, 'base64url'));
    if (iv.length !== IV_LENGTH || authTag.length !== TAG_LENGTH) {
      throw new Error('unexpected segment lengths');
    }
    const decipher = createDecipheriv('aes-256-gcm', deriveKey(), iv);
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  } catch {
    throw new AppError(
      500,
      'Secret decryption failed — was SECRETS_KEY changed after providers were configured?',
      'CRYPTO_ERROR',
    );
  }
}
