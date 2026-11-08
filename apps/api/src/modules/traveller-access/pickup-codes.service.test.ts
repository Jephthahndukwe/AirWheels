import { beforeAll, describe, expect, it, vi } from 'vitest';
import { pickupCodeFor, pickupCodeHash } from './codes';
import { PICKUP_CODE_LOCKED_ALERT, PickupCodesService } from './pickup-codes.service';

const LEG = '4f0c2b0e-1111-4222-8333-944455556666';
const DRIVER = 'd0000000-0000-4000-8000-000000000001';
const MAX = 5;

beforeAll(() => {
  process.env.PICKUP_CODE_KEY = 'p'.repeat(64);
});

/** In-memory stand-in for the parts of Prisma the service uses, with atomic increments. */
function setup() {
  const leg = {
    id: LEG,
    bookingId: 'b0000000-0000-4000-8000-000000000001',
    driverId: DRIVER,
    status: 'ARRIVED',
    pickupCodeVersion: 1,
    pickupCodeHash: pickupCodeHash(LEG, 1, pickupCodeFor(LEG, 1)),
    pickupCodeFailedAttempts: 0,
    pickupCodeLockedAt: null as Date | null,
    booking: {
      traveller: { phone: '+2348012345678', whatsapp: true },
      airline: { serviceBrandName: 'Mock Air Transfers' },
    },
  };
  const prisma = {
    rideLeg: {
      findUnique: vi.fn(async () => ({ ...leg })),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const inc = data.pickupCodeFailedAttempts as { increment?: number } | number | undefined;
        if (typeof inc === 'object' && inc?.increment)
          leg.pickupCodeFailedAttempts += inc.increment;
        else if (typeof inc === 'number') leg.pickupCodeFailedAttempts = inc;
        if ('pickupCodeLockedAt' in data)
          leg.pickupCodeLockedAt = data.pickupCodeLockedAt as Date | null;
        if ('pickupCodeVersion' in data) leg.pickupCodeVersion = data.pickupCodeVersion as number;
        if ('pickupCodeHash' in data) leg.pickupCodeHash = data.pickupCodeHash as string;
        return { ...leg };
      }),
      updateMany: vi.fn(
        async ({
          where,
          data,
        }: {
          where: Record<string, unknown>;
          data: Record<string, unknown>;
        }) => {
          if (where.pickupCodeLockedAt === null && leg.pickupCodeLockedAt !== null)
            return { count: 0 };
          if (
            where.pickupCodeVersion !== undefined &&
            where.pickupCodeVersion !== leg.pickupCodeVersion
          )
            return { count: 0 };
          leg.pickupCodeLockedAt = data.pickupCodeLockedAt as Date;
          return { count: 1 };
        },
      ),
    },
    bookingEvent: { create: vi.fn(async () => ({})) },
  };
  const alerts = { raise: vi.fn(async () => ({})), resolveFor: vi.fn(async () => undefined) };
  const messaging = { notify: vi.fn(async () => ({})) };
  const audit = { record: vi.fn(async () => ({})) };
  const config = { get: vi.fn(async () => MAX) };
  const svc = new PickupCodesService(
    prisma as never,
    config as never,
    audit as never,
    alerts as never,
    messaging as never,
  );
  const wrong = pickupCodeFor(LEG, 1) === '0000' ? '0001' : '0000';
  return { svc, leg, prisma, alerts, messaging, audit, wrong };
}

describe('pickup code lockout (ACC-11) and reissue (ACC-10)', () => {
  it('accepts the right code', async () => {
    const { svc } = setup();
    expect(await svc.verify(LEG, pickupCodeFor(LEG, 1), DRIVER)).toEqual({ result: 'OK' });
  });

  it('counts down, locks at the limit, alerts ops once, and never touches the trip', async () => {
    const { svc, leg, alerts, wrong } = setup();
    for (let i = 1; i < MAX; i++) {
      expect(await svc.verify(LEG, wrong, DRIVER)).toEqual({
        result: 'WRONG',
        attemptsLeft: MAX - i,
      });
    }
    expect(await svc.verify(LEG, wrong, DRIVER)).toEqual({ result: 'LOCKED' });
    expect(leg.pickupCodeLockedAt).toBeInstanceOf(Date);
    expect(alerts.raise).toHaveBeenCalledTimes(1);
    expect(alerts.raise).toHaveBeenCalledWith(
      expect.objectContaining({ type: PICKUP_CODE_LOCKED_ALERT, legId: LEG }),
    );
    // Further guesses, even the right code, stay locked without more alerts or counting.
    expect(await svc.verify(LEG, pickupCodeFor(LEG, 1), DRIVER)).toEqual({ result: 'LOCKED' });
    expect(alerts.raise).toHaveBeenCalledTimes(1);
    expect(leg.pickupCodeFailedAttempts).toBe(MAX);
    // The trip is not cancelled or moved: the leg status is untouched.
    expect(leg.status).toBe('ARRIVED');
  });

  it('cannot be raced past the limit by parallel guesses', async () => {
    const { svc, leg, alerts, wrong } = setup();
    leg.pickupCodeFailedAttempts = MAX - 2;
    const results = await Promise.all([
      svc.verify(LEG, wrong, DRIVER),
      svc.verify(LEG, wrong, DRIVER),
      svc.verify(LEG, wrong, DRIVER),
    ]);
    expect(results.filter((r) => r.result === 'LOCKED').length).toBeGreaterThanOrEqual(1);
    expect(leg.pickupCodeLockedAt).toBeInstanceOf(Date);
    expect(alerts.raise).toHaveBeenCalledTimes(1);
  });

  it('refuses a driver who is not assigned to the leg', async () => {
    const { svc } = setup();
    await expect(svc.verify(LEG, '1234', 'd0000000-0000-4000-8000-00000000ffff')).rejects.toThrow(
      /not assigned/,
    );
  });

  it('reissue clears the lock, kills the old code, resolves the alert and sends the new code', async () => {
    const { svc, leg, alerts, messaging, audit, wrong } = setup();
    for (let i = 0; i < MAX; i++) await svc.verify(LEG, wrong, DRIVER);
    expect(leg.pickupCodeLockedAt).not.toBeNull();

    const r = await svc.reissue(LEG, 'ops-user');
    expect(r).toEqual({ legId: LEG, version: 2, travellerNotified: true });
    expect(leg.pickupCodeLockedAt).toBeNull();
    expect(leg.pickupCodeFailedAttempts).toBe(0);
    expect(alerts.resolveFor).toHaveBeenCalledWith(LEG, PICKUP_CODE_LOCKED_ALERT, 'ops-user');
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'pickup_code.reissue' }),
    );
    expect(messaging.notify).toHaveBeenCalledWith(
      'pickup_code.reissued',
      expect.objectContaining({ legId: LEG, instance: 'v2' }),
    );
    expect(await svc.verify(LEG, pickupCodeFor(LEG, 2), DRIVER)).toEqual({ result: 'OK' });
    if (pickupCodeFor(LEG, 1) !== pickupCodeFor(LEG, 2)) {
      expect((await svc.verify(LEG, pickupCodeFor(LEG, 1), DRIVER)).result).toBe('WRONG');
    }
    expect(leg.status).toBe('ARRIVED');
  });
});
