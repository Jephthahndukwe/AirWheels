import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * HMAC-SHA256 over `${timestamp}.${METHOD}.${path}.${body}`, hex encoded.
 * Shared by the API (verify) and the mock airline (sign). Server-side only.
 */
export function signPartnerRequest(
  secret: string,
  timestamp: string,
  method: string,
  path: string,
  body: string,
): string {
  return createHmac('sha256', secret)
    .update(`${timestamp}.${method.toUpperCase()}.${path}.${body}`)
    .digest('hex');
}

export function verifyPartnerSignature(
  secret: string,
  timestamp: string,
  method: string,
  path: string,
  body: string,
  signature: string,
  nowMs = Date.now(),
  toleranceMs = 5 * 60_000,
): boolean {
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(nowMs - ts) > toleranceMs) return false;
  const expected = Buffer.from(signPartnerRequest(secret, timestamp, method, path, body), 'hex');
  const given = Buffer.from(signature, 'hex');
  return expected.length === given.length && timingSafeEqual(expected, given);
}
