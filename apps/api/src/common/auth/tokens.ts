import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Minimal HS256 JWT. A session token carries only the session id (`sid`); the session row is the
 * source of truth, so revocation works on the next request. Short-lived setup tokens carry a purpose.
 */
export interface TokenClaims {
  sid?: string;
  sub: string;
  typ: 'admin' | 'driver' | 'driver_setup';
  exp: number; // seconds since epoch
  iat?: number;
}

const b64 = (v: string) => Buffer.from(v).toString('base64url');

const secret = (): string => {
  const s = process.env.JWT_SECRET;
  if (!s || s.length < 32)
    throw new Error('JWT_SECRET is missing or shorter than 32 characters. Run `pnpm setup:env`.');
  return s;
};

export function signToken(claims: TokenClaims): string {
  const head = b64(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64(JSON.stringify({ iat: Math.floor(Date.now() / 1000), ...claims }));
  const sig = createHmac('sha256', secret()).update(`${head}.${body}`).digest('base64url');
  return `${head}.${body}.${sig}`;
}

export function verifyToken(token: string, nowMs: number = Date.now()): TokenClaims | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [head, body, sig] = parts as [string, string, string];
  const expected = createHmac('sha256', secret()).update(`${head}.${body}`).digest();
  const given = Buffer.from(sig, 'base64url');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const header = JSON.parse(Buffer.from(head, 'base64url').toString('utf8')) as { alg?: string };
    if (header.alg !== 'HS256') return null;
    const claims = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as TokenClaims;
    if (typeof claims.exp !== 'number' || claims.exp * 1000 <= nowMs) return null;
    return claims;
  } catch {
    return null;
  }
}
