import { beforeAll, describe, expect, it } from 'vitest';
import { decideAccess } from '../../modules/auth/guards';
import { ipAllowed, validIpEntry } from '../../modules/auth/principal.resolver';
import { normalisePhone } from '../../modules/auth/driver-auth.service';
import { redact } from '../../modules/audit/audit.service';
import { configValueProblem } from '../../modules/config/config.module';
import { onboardingChecklist } from '../../modules/drivers/drivers.service';
import { hashSecret, passwordProblem, pinProblem, verifySecret } from './passwords';
import { ROLES, type Role } from './roles';
import { signToken, verifyToken } from './tokens';
import { base32Decode, base32Encode, hotp, totpCode, verifyTotp } from './totp';

beforeAll(() => {
  process.env.JWT_SECRET = 'j'.repeat(64);
});

describe('TOTP (RFC 6238)', () => {
  // RFC 6238 appendix B, SHA-1 secret "12345678901234567890", 8 digits -> last 6 digits here.
  const secret = base32Encode(Buffer.from('12345678901234567890'));
  it.each([
    [59, '287082'],
    [1111111109, '081804'],
    [1234567890, '005924'],
    [2000000000, '279037'],
  ])('matches the RFC vector at %i s', (t, code) => {
    expect(totpCode(secret, t * 1000)).toBe(code);
  });

  it('round-trips base32', () => {
    const buf = Buffer.from([0, 1, 2, 250, 255, 7, 9]);
    expect(base32Decode(base32Encode(buf))).toEqual(buf);
  });

  it('accepts one step of clock drift and returns the step, rejects older codes', () => {
    const now = 1_800_000_000_000;
    const prev = hotp(base32Decode(secret), Math.floor(now / 30_000) - 1);
    expect(verifyTotp(secret, prev, now)).toBe(Math.floor(now / 30_000) - 1);
    const old = hotp(base32Decode(secret), Math.floor(now / 30_000) - 3);
    expect(verifyTotp(secret, old, now)).toBeNull();
    expect(verifyTotp(secret, 'abcdef', now)).toBeNull();
  });
});

describe('session tokens', () => {
  it('verifies its own signature and expiry', () => {
    const t = signToken({
      sid: 's1',
      sub: 'u1',
      typ: 'admin',
      exp: Math.floor(Date.now() / 1000) + 60,
    });
    expect(verifyToken(t)?.sid).toBe('s1');
    expect(verifyToken(t, Date.now() + 120_000)).toBeNull();
  });

  it('rejects a tampered payload or a foreign key', () => {
    const t = signToken({
      sid: 's1',
      sub: 'u1',
      typ: 'driver',
      exp: Math.floor(Date.now() / 1000) + 60,
    });
    const [h, , s] = t.split('.');
    const forged = Buffer.from(
      JSON.stringify({ sid: 's2', sub: 'u1', typ: 'admin', exp: 9e9 }),
    ).toString('base64url');
    expect(verifyToken(`${h}.${forged}.${s}`)).toBeNull();
    process.env.JWT_SECRET = 'k'.repeat(64);
    expect(verifyToken(t)).toBeNull();
    process.env.JWT_SECRET = 'j'.repeat(64);
  });
});

describe('password and PIN hashing', () => {
  it('uses argon2id and verifies', async () => {
    const h = await hashSecret('correct horse 42');
    expect(h.startsWith('$argon2id$')).toBe(true);
    expect(await verifySecret(h, 'correct horse 42')).toBe(true);
    expect(await verifySecret(h, 'wrong')).toBe(false);
    expect(await verifySecret(null, 'x')).toBe(false);
  });

  it('enforces password and PIN rules', () => {
    expect(passwordProblem('short1')).not.toBeNull();
    expect(passwordProblem('alllowercaseletters')).not.toBeNull();
    expect(passwordProblem('Long-enough-pass1')).toBeNull();
    for (const bad of ['12345', '111111', '123456', '987654', 'abcdef'])
      expect(pinProblem(bad)).not.toBeNull();
    expect(pinProblem('482913')).toBeNull();
  });
});

describe('access decision (PRD 2.2)', () => {
  const all: (Role | null)[] = [...ROLES, null];
  it('blocks a route with no declared roles for everyone', () => {
    for (const r of all)
      expect(
        decideAccess({
          isPublic: false,
          roles: undefined,
          method: 'GET',
          selfService: false,
          principalRole: r,
        }),
      ).toBe('undeclared');
  });
  it('requires sign-in, then the role', () => {
    expect(
      decideAccess({
        isPublic: false,
        roles: ['DRIVER'],
        method: 'GET',
        selfService: false,
        principalRole: null,
      }),
    ).toBe('unauthenticated');
    expect(
      decideAccess({
        isPublic: false,
        roles: ['DRIVER'],
        method: 'GET',
        selfService: false,
        principalRole: 'OPS_AGENT',
      }),
    ).toBe('forbidden');
    expect(
      decideAccess({
        isPublic: false,
        roles: ['DRIVER'],
        method: 'GET',
        selfService: false,
        principalRole: 'DRIVER',
      }),
    ).toBe('allow');
  });
  it('keeps finance read-only even on a route that lists it, except sign-out', () => {
    const base = {
      isPublic: false,
      roles: ['FINANCE', 'OPS_AGENT'] as Role[],
      principalRole: 'FINANCE' as Role,
    };
    expect(decideAccess({ ...base, method: 'GET', selfService: false })).toBe('allow');
    for (const m of ['POST', 'PUT', 'PATCH', 'DELETE'])
      expect(decideAccess({ ...base, method: m, selfService: false })).toBe('forbidden');
    expect(decideAccess({ ...base, method: 'POST', selfService: true })).toBe('allow');
  });
});

describe('airline IP allow-lists', () => {
  it('matches addresses and CIDR ranges, IPv4-mapped included', () => {
    expect(ipAllowed('1.2.3.4', [])).toBe(true);
    expect(ipAllowed('10.0.5.9', ['10.0.0.0/16'])).toBe(true);
    expect(ipAllowed('::ffff:10.0.5.9', ['10.0.0.0/16'])).toBe(true);
    expect(ipAllowed('10.1.0.1', ['10.0.0.0/16', '192.168.1.1'])).toBe(false);
    expect(ipAllowed(undefined, ['10.0.0.0/16'])).toBe(false);
  });
  it('validates entries', () => {
    expect(validIpEntry('10.0.0.0/8')).toBe(true);
    expect(validIpEntry('2001:db8::/32')).toBe(true);
    for (const bad of ['10.0.0.0/33', 'example.com', '1.2.3.4/8/1', ''])
      expect(validIpEntry(bad)).toBe(false);
  });
});

describe('helpers', () => {
  it('normalises Nigerian and international mobile numbers', () => {
    expect(normalisePhone('0801 234 5678')).toBe('+2348012345678');
    expect(normalisePhone('2348012345678')).toBe('+2348012345678');
    expect(normalisePhone('+447700900123')).toBe('+447700900123');
    expect(normalisePhone('12345')).toBeNull();
  });

  it('redacts secrets from audit entries', () => {
    expect(redact({ email: 'a@b.c', password: 'x', nested: [{ pin: '1', ok: 2 }] })).toEqual({
      email: 'a@b.c',
      password: '[redacted]',
      nested: [{ pin: '[redacted]', ok: 2 }],
    });
  });

  it('keeps config values the same shape', () => {
    expect(configValueProblem(5, 10)).toBeNull();
    expect(configValueProblem(5, '10')).not.toBeNull();
    expect(configValueProblem(5, -1)).not.toBeNull();
    expect(configValueProblem({ a: 1, b: 2 }, { a: 1 })).not.toBeNull();
    expect(configValueProblem({ a: { limit: 1 } }, { a: { limit: 3 } })).toBeNull();
  });

  it('lists what blocks a driver invite', () => {
    const base = {
      hasDetails: true,
      uploadedTypes: ['LICENCE', 'ID'],
      requiredDocs: ['LICENCE', 'ID'],
      kycPassed: true,
      hasVehicle: true,
      training: { a: true, b: true },
      trainingItems: ['a', 'b'],
    };
    expect(onboardingChecklist(base).readyToInvite).toBe(true);
    const c = onboardingChecklist({ ...base, uploadedTypes: ['LICENCE'], training: { a: true } });
    expect(c.readyToInvite).toBe(false);
    expect(c.documents.missing).toEqual(['ID']);
    expect(c.training.missing).toEqual(['b']);
  });
});
