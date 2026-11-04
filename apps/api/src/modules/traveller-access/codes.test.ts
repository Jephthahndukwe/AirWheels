import { beforeAll, describe, expect, it } from 'vitest';
import { checkPickupCode, pickupCodeFor, pickupCodeHash } from './codes';

const legId = '4f0c2b0e-1111-4222-8333-944455556666';

beforeAll(() => {
  process.env.PICKUP_CODE_KEY = 'p'.repeat(64);
});

const base = (version: number, guess: string, failedAttempts = 0) => ({
  legId,
  version,
  storedHash: pickupCodeHash(legId, version, pickupCodeFor(legId, version)),
  guess,
  failedAttempts,
  maxAttempts: 5,
});

describe('pickup codes', () => {
  it('is 4 digits and stable for the same version', () => {
    expect(pickupCodeFor(legId, 1)).toMatch(/^\d{4}$/);
    expect(pickupCodeFor(legId, 1)).toBe(pickupCodeFor(legId, 1));
  });

  it('accepts the right code', () => {
    expect(checkPickupCode(base(1, pickupCodeFor(legId, 1))).result).toBe('OK');
  });

  it('reissuing (a new version) changes the code and the old code stops working', () => {
    const v1 = pickupCodeFor(legId, 1);
    const versions = [2, 3, 4, 5, 6].map((v) => pickupCodeFor(legId, v));
    expect(versions.some((c) => c !== v1)).toBe(true);
    const v2 = pickupCodeFor(legId, 2);
    if (v2 !== v1) expect(checkPickupCode(base(2, v1)).result).toBe('WRONG');
    expect(checkPickupCode(base(2, v2)).result).toBe('OK');
  });

  it('counts down wrong attempts, then locks', () => {
    const wrong = pickupCodeFor(legId, 1) === '0000' ? '0001' : '0000';
    expect(checkPickupCode(base(1, wrong, 0))).toEqual({ result: 'WRONG', attemptsLeft: 4 });
    expect(checkPickupCode(base(1, wrong, 3))).toEqual({ result: 'WRONG', attemptsLeft: 1 });
    expect(checkPickupCode(base(1, wrong, 4))).toEqual({ result: 'LOCKED' });
  });

  it('stays locked even for the right code once the limit is reached', () => {
    expect(checkPickupCode(base(1, pickupCodeFor(legId, 1), 5)).result).toBe('LOCKED');
  });
});
