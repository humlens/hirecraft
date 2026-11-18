import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scryptSync,
} from 'crypto';
import { ApiError } from '../errors';

/**
 * AES-256-GCM encryption for per-tenant API keys.
 * Format: v1:<iv>:<tag>:<ciphertext> (base64). The key is derived from
 * AI_KEYS_ENCRYPTION_SECRET with scrypt. Decrypt only on the server.
 */
const secret = () => {
  const s = process.env.AI_KEYS_ENCRYPTION_SECRET;

  if (!s || s.length < 16) {
    throw new ApiError(
      503,
      'AI_KEYS_ENCRYPTION_SECRET is not configured (min 16 characters).'
    );
  }

  return s;
};

const key = () => scryptSync(secret(), 'hirecraft-ai-keys-v1', 32);

export function encryptSecret(plain: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);

  return [
    'v1',
    iv.toString('base64'),
    cipher.getAuthTag().toString('base64'),
    enc.toString('base64'),
  ].join(':');
}

export function decryptSecret(payload: string) {
  const [v, iv, tag, data] = payload.split(':');

  if (v !== 'v1' || !iv || !tag || !data) {
    throw new Error('Unsupported ciphertext format');
  }

  const decipher = createDecipheriv(
    'aes-256-gcm',
    key(),
    Buffer.from(iv, 'base64')
  );

  decipher.setAuthTag(Buffer.from(tag, 'base64'));

  return Buffer.concat([
    decipher.update(Buffer.from(data, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}

/** Last 4 characters, safe to show next to a "key configured" badge. */
export const keyHint = (plain: string) => `...${plain.slice(-4)}`;
