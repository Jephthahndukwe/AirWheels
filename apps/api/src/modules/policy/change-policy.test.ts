import { describe, expect, it } from 'vitest';
import { DEFAULT_CHANGE_RULES as R, type LegChange, SimpleChangePolicy } from './change-policy';

const now = new Date('2026-11-08T10:00:00Z');
const base: LegChange = {
  kind: 'CANCEL',
  plan: 'STANDARD',
  legStatus: 'SCHEDULED',
  pickupAt: new Date('2026-11-10T10:00:00Z'),
  legAmountKobo: 1_000_000,
  driverAssigned: false,
  now,
};
const p = new SimpleChangePolicy();

describe('simple change policy (TRV-07, until M7)', () => {
  it('early cancel is a full refund', () => {
    expect(p.decide(base, R)).toMatchObject({ allowed: true, refundKobo: 1_000_000, feeKobo: 0 });
  });
  it('late cancel refunds by plan', () => {
    const late = { ...base, pickupAt: new Date('2026-11-08T15:00:00Z') };
    expect(p.decide(late, R).refundKobo).toBe(500_000);
    expect(p.decide({ ...late, plan: 'FLEX' }, R).refundKobo).toBe(1_000_000);
  });
  it('late time change costs a fee on Standard and nothing on Flex', () => {
    const late = {
      ...base,
      kind: 'CHANGE_TIME' as const,
      pickupAt: new Date('2026-11-08T15:00:00Z'),
    };
    expect(p.decide(late, R).feeKobo).toBe(150_000);
    expect(p.decide({ ...late, plan: 'FLEX' }, R).feeKobo).toBe(0);
    expect(p.decide({ ...base, kind: 'CHANGE_TIME' }, R).feeKobo).toBe(0);
  });
  it('address change adds a dearer zone difference and is closed once a driver is assigned', () => {
    const a = { ...base, kind: 'CHANGE_ADDRESS' as const, repriceDeltaKobo: 200_000 };
    expect(p.decide(a, R).feeKobo).toBe(200_000);
    expect(p.decide({ ...a, repriceDeltaKobo: -50_000 }, R).feeKobo).toBe(0);
    expect(p.decide({ ...a, driverAssigned: true }, R).allowed).toBe(false);
  });
  it('refuses once the driver is on the way or the leg is closed', () => {
    expect(p.decide({ ...base, legStatus: 'EN_ROUTE' }, R).reasonCode).toBe('DRIVER_ON_THE_WAY');
    expect(p.decide({ ...base, legStatus: 'COMPLETED' }, R).allowed).toBe(false);
  });
  it('never refunds a fraction of a kobo', () => {
    const late = { ...base, legAmountKobo: 333, pickupAt: new Date('2026-11-08T11:00:00Z') };
    expect(Number.isInteger(p.decide(late, R).refundKobo)).toBe(true);
  });
});
