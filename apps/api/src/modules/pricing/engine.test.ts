import { describe, expect, it } from 'vitest';
import { computeQuote, type QuoteInput } from './engine';

const base: QuoteInput = {
  legs: [{ type: 'DEPARTURE', zoneCode: 'LEKKI_PHASE_1' }],
  vehicleClass: 'SEDAN',
  plan: 'STANDARD',
  rideType: 'PRIVATE',
  zoneFares: { LEKKI_PHASE_1: { SEDAN: 2_500_000, SUV: 3_500_000 } },
  planMultiplierBps: { STANDARD: 10_000, FLEX: 11_500 },
  sharedShareBps: 6_000,
  revenueShareBps: 1_000,
  estimatedDriverPayBps: 6_000,
  marginFloorBps: 1_500,
};

describe('computeQuote', () => {
  it('prices a private standard leg from the zone table', () => {
    const q = computeQuote(base);
    expect(q.totalKobo).toBe(2_500_000);
    expect(q.airlineShareKobo).toBe(250_000);
    expect(q.marginKobo).toBe(750_000);
    expect(q.flagged).toBe(false);
  });

  it('applies the Flex multiplier and the shared share, in integer kobo', () => {
    const q = computeQuote({ ...base, plan: 'FLEX', rideType: 'SHARED' });
    expect(Number.isInteger(q.totalKobo)).toBe(true);
    expect(q.totalKobo).toBe(1_730_000); // 25,000 * 1.15 * 0.6 = 17,250 -> rounded to 17,300
  });

  it('flags a quote whose margin is under the floor', () => {
    const q = computeQuote({ ...base, revenueShareBps: 3_000 });
    expect(q.flagged).toBe(true);
    expect(q.flagReason).toBe('MARGIN_BELOW_FLOOR');
  });

  it('throws when a zone has no fare', () => {
    expect(() => computeQuote({ ...base, legs: [{ type: 'ARRIVAL', zoneCode: 'NOWHERE' }] })).toThrow();
  });
});
