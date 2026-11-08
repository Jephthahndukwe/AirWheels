import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/** TOTP (RFC 6238, SHA-1, 6 digits, 30 s) for admin sign-in (ACC-07). Works with any authenticator app. */
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export const TOTP_STEP_SECONDS = 30;

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = ((value << 8) | byte) & 0xffff;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(text: string): Buffer {
  const clean = text.replace(/=+$/, '').replace(/\s/g, '').toUpperCase();
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = ALPHABET.indexOf(ch);
    if (idx < 0) throw new Error('Invalid base32');
    value = ((value << 5) | idx) & 0xffff;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export const generateTotpSecret = (): string => base32Encode(randomBytes(20));

export const totpStep = (atMs: number = Date.now()): number =>
  Math.floor(atMs / 1000 / TOTP_STEP_SECONDS);

export function hotp(secret: Buffer, counter: number, digits = 6): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const mac = createHmac('sha1', secret).update(msg).digest();
  const offset = mac[mac.length - 1]! & 0x0f;
  const bin = mac.readUInt32BE(offset) & 0x7fffffff;
  return String(bin % 10 ** digits).padStart(digits, '0');
}

export const totpCode = (base32Secret: string, atMs: number = Date.now()): string =>
  hotp(base32Decode(base32Secret), totpStep(atMs));

/**
 * Checks a code against the current step and one step either side (clock drift).
 * Returns the matched step so the caller can refuse a replay of the same or an older step.
 */
export function verifyTotp(
  base32Secret: string,
  code: string,
  atMs: number = Date.now(),
  window = 1,
): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const key = base32Decode(base32Secret);
  const now = totpStep(atMs);
  for (let d = -window; d <= window; d++) {
    const candidate = Buffer.from(hotp(key, now + d));
    if (timingSafeEqual(candidate, Buffer.from(code))) return now + d;
  }
  return null;
}

export const otpauthUri = (secret: string, account: string, issuer = 'Airwheels'): string =>
  `otpauth://totp/${encodeURIComponent(`${issuer}:${account}`)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=${TOTP_STEP_SECONDS}`;
