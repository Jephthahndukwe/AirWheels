import { createCipheriv, createDecipheriv, createHash, randomBytes, randomInt } from 'node:crypto';

/**
 * Encryption keys come only from the process environment (in production, injected by the
 * secrets manager). They are never stored in the database or the repo.
 *
 * APP_ENCRYPTION_KEY           current key: every new encryption uses it
 * APP_ENCRYPTION_KEY_PREVIOUS  optional, during rotation only: still accepted for decryption
 *
 * Rotation steps are in the README ("Rotating the encryption key").
 */
const parseKey = (name: string, hex: string | undefined): Buffer | null => {
  if (!hex) return null;
  if (!/^[0-9a-f]{64}$/i.test(hex))
    throw new Error(`${name} must be 32 bytes of hex (64 characters).`);
  return Buffer.from(hex, 'hex');
};

export const currentKey = (): Buffer => {
  const k = parseKey('APP_ENCRYPTION_KEY', process.env.APP_ENCRYPTION_KEY);
  if (!k)
    throw new Error(
      'APP_ENCRYPTION_KEY is not set. Run `pnpm setup:env` locally, or set it in the secrets manager.',
    );
  return k;
};

const decryptionKeys = (): Buffer[] =>
  [
    currentKey(),
    parseKey('APP_ENCRYPTION_KEY_PREVIOUS', process.env.APP_ENCRYPTION_KEY_PREVIOUS),
  ].filter((k): k is Buffer => k !== null);

/** AES-256-GCM. Output: base64(iv | tag | ciphertext). */
export function encrypt(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', currentKey(), iv);
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), data]).toString('base64');
}

/** Tries the current key, then the previous one (rotation window). GCM rejects a wrong key. */
export function decrypt(encoded: string): string {
  const raw = Buffer.from(encoded, 'base64');
  for (const key of decryptionKeys()) {
    try {
      const decipher = createDecipheriv('aes-256-gcm', key, raw.subarray(0, 12));
      decipher.setAuthTag(raw.subarray(12, 28));
      return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8');
    } catch {
      /* try the next key */
    }
  }
  throw new Error('Could not decrypt with the current or previous encryption key.');
}

/** True when the value was encrypted with the current key (used by the rotation script). */
export function isCurrent(encoded: string): boolean {
  const raw = Buffer.from(encoded, 'base64');
  try {
    const decipher = createDecipheriv('aes-256-gcm', currentKey(), raw.subarray(0, 12));
    decipher.setAuthTag(raw.subarray(12, 28));
    decipher.update(raw.subarray(28));
    decipher.final();
    return true;
  } catch {
    return false;
  }
}

/** One-way hash for tokens and codes (tracking tokens, pickup codes, invite codes). */
export const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');

/** Long random URL-safe token for tracking links (ACC-01). */
export const randomToken = (bytes = 24): string => randomBytes(bytes).toString('base64url');

/** Numeric code of fixed length. */
export const numericCode = (digits: number): string =>
  String(randomInt(0, 10 ** digits)).padStart(digits, '0');
