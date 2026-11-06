import type { PricingRule } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import {
  type LegQuoteInput,
  type PricingRules,
  type QuoteInput,
  QuoteError,
  applyBps,
  computeQuote,
  inHourWindow,
  roundKobo,
  suggestVehicleClass,
} from './engine';
import { MissingRuleError, buildPricingRules, ruleProblem, rulesInForce } from './rules';

const zeroCost = {
  driverBaseKobo: 0,
  driverPerKmKobo: 0,
  carPartnerPerKmKobo: 0,
  energyPerKmKobo: 0,
  insurancePerLegKobo: 0,
  messagingPerLegKobo: 0,
  paymentFeeBps: 0,
  paymentFeeFlatKobo: 0,
  paymentFeeCapKobo: 0,
  emptyReturnBps: 0,
  disruptionReserveBps: { STANDARD: 0, FLEX: 0 },
  sharedCostShareBps: 10_000,
};

/** Round numbers so every expected value can be checked by hand. */
const rules = (over: Partial<PricingRules> = {}): PricingRules => ({
  zoneFares: { LEKKI: { SEDAN: 2_000_000, SUV: 3_000_000, VAN: 4_000_000 }, AJAH: { SEDAN: 2_500_000, SUV: 3_500_000, VAN: 4_500_000 } },
  ceilings: {},
  airportFeeKobo: 50_000,
  childSeatKobo: 100_000,
  extraStopKobo: 150_000,
  surcharges: [],
  vehicleClasses: {
    SEDAN: { maxPassengers: 3, maxBags: 3, includedBags: 2, extraBagKobo: 50_000 },
    SUV: { maxPassengers: 4, maxBags: 5, includedBags: 3, extraBagKobo: 50_000 },
    VAN: { maxPassengers: 7, maxBags: 8, includedBags: 6, extraBagKobo: 50_000 },
  },
  planMultiplierBps: { STANDARD: 10_000, FLEX: 11_500 },
  sharedShareBps: { default: 6_000, byCorridor: { 'Island east': 5_000 } },
  discounts: { bothLegsBps: 500, promos: { SAVE10: { bps: 1_000 }, OLD: { bps: 1_000, validTo: '2026-01-01' }, FLAT: { flatKobo: 100_000 } }, corporate: { ACME: { bps: 1_500 } }, maxTotalBps: 2_500, promoWithCorporate: false },
  tax: { name: 'VAT', bps: 0, onAirportFee: false },
  rounding: { toKobo: 1, mode: 'nearest' },
  cost: zeroCost,
  marginFloorBps: 0,
  sharedLimits: { maxPassengersPerBooking: 2, bagsPerPassenger: 2, vehicleClass: 'SUV' },
  ...over,
});

const leg = (over: Partial<LegQuoteInput> = {}): LegQuoteInput => ({
  type: 'DEPARTURE',
  zoneCode: 'LEKKI',
  corridor: 'Island east',
  distanceKm: 20,
  localDate: '2026-11-20',
  localHour: 12,
  ...over,
});

const input = (over: Partial<QuoteInput> = {}): QuoteInput => ({
  legs: [leg()],
  passengers: 1,
  bags: 1,
  vehicleClass: 'SEDAN',
  plan: 'STANDARD',
  rideType: 'PRIVATE',
  extras: { childSeats: 0, extraStops: 0 },
  revenueShareBps: 0,
  collectedBy: 'AIRLINE',
  today: '2026-11-06',
  ...over,
});

const line = (q: ReturnType<typeof computeQuote>, code: string, i = 0) => q.legs[i]!.lines.find((l) => l.code === code)?.amountKobo;
const err = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return (e as QuoteError).code;
  }
  return null;
};

describe('quote engine, PRD 12.2 step by step', () => {
  it('1. base fare from the zone table, by vehicle class', () => {
    expect(computeQuote(input(), rules()).legs[0]!.fareKobo).toBe(2_000_000);
    expect(computeQuote(input({ vehicleClass: 'SUV' }), rules()).legs[0]!.fareKobo).toBe(3_000_000);
  });

  it('1. an address outside every zone cannot be quoted', () => {
    expect(err(() => computeQuote(input({ legs: [leg({ zoneCode: 'NOWHERE' })] }), rules()))).toBe('OUTSIDE_SERVICE_AREA');
  });

  it('2. airport fee is passed through: no plan, shared share or discount touches it', () => {
    const q = computeQuote(input({ plan: 'FLEX', promoCode: 'SAVE10' }), rules());
    expect(q.legs[0]!.airportFeeKobo).toBe(50_000);
    expect(q.totalKobo).toBe(2_070_000 + 50_000); // 2,000,000 x 1.15 = 2,300,000, less 10% = 2,070,000
  });

  it('3. time-of-day surcharges, including windows that wrap past midnight', () => {
    const night = rules({ surcharges: [{ key: 'night', label: 'Night', kind: 'TIME_OF_DAY', startHour: 22, endHour: 5, bps: 2_000 }] });
    expect(line(computeQuote(input({ legs: [leg({ localHour: 23 })] }), night), 'surcharge.night')).toBe(400_000);
    expect(line(computeQuote(input({ legs: [leg({ localHour: 4 })] }), night), 'surcharge.night')).toBe(400_000);
    expect(line(computeQuote(input({ legs: [leg({ localHour: 5 })] }), night), 'surcharge.night')).toBeUndefined();
    expect(inHourWindow(12, 22, 5)).toBe(false);
    expect(inHourWindow(3, 2, 5)).toBe(true);
  });

  it('3. peak-season date surcharges', () => {
    const peak = rules({ surcharges: [{ key: 'xmas', label: 'Christmas', kind: 'DATE_RANGE', from: '2026-12-20', to: '2027-01-05', bps: 1_500 }] });
    expect(line(computeQuote(input({ legs: [leg({ localDate: '2026-12-24' })] }), peak), 'surcharge.xmas')).toBe(300_000);
    expect(line(computeQuote(input({ legs: [leg({ localDate: '2026-12-19' })] }), peak), 'surcharge.xmas')).toBeUndefined();
  });

  it('4. vehicle class limits and extra bags over the included allowance', () => {
    expect(line(computeQuote(input({ bags: 3 }), rules()), 'bags')).toBe(50_000);
    expect(line(computeQuote(input({ bags: 2 }), rules()), 'bags')).toBeUndefined();
    expect(err(() => computeQuote(input({ passengers: 4 }), rules()))).toBe('VEHICLE_TOO_SMALL');
    expect(suggestVehicleClass(2, 2, rules().vehicleClasses)).toBe('SEDAN');
    expect(suggestVehicleClass(4, 4, rules().vehicleClasses)).toBe('SUV');
    expect(suggestVehicleClass(6, 2, rules().vehicleClasses)).toBe('VAN');
  });

  it('5. extras: child seats and extra stops', () => {
    const q = computeQuote(input({ extras: { childSeats: 2, extraStops: 1 } }), rules());
    expect(line(q, 'extra.child_seat')).toBe(200_000);
    expect(line(q, 'extra.stop')).toBe(150_000);
    expect(q.legs[0]!.fareKobo).toBe(2_350_000);
  });

  it('6. plan multiplier applies to base, surcharges, bags and extras', () => {
    const q = computeQuote(input({ plan: 'FLEX', bags: 3, extras: { childSeats: 1, extraStops: 0 } }), rules());
    // (2,000,000 + 50,000 + 100,000) x 1.15 = 2,472,500
    expect(q.legs[0]!.fareKobo).toBe(2_472_500);
    expect(line(q, 'plan')).toBe(322_500);
  });

  it('7. shared fare is a share of the private fare, per corridor, always in an SUV', () => {
    const q = computeQuote(input({ rideType: 'SHARED', vehicleClass: 'SEDAN' }), rules());
    expect(q.vehicleClass).toBe('SUV');
    expect(q.legs[0]!.fareKobo).toBe(1_500_000); // SUV 3,000,000 x 50% for Island east
    const other = computeQuote(input({ rideType: 'SHARED', legs: [leg({ corridor: 'Mainland south' })] }), rules());
    expect(other.legs[0]!.fareKobo).toBe(1_800_000); // default 60%
  });

  it('7. shared limits from PRD 11.1', () => {
    const shared = (o: Partial<QuoteInput>) => err(() => computeQuote(input({ rideType: 'SHARED', ...o }), rules()));
    expect(shared({ passengers: 3, bags: 0 })).toBe('SHARED_TOO_MANY_PASSENGERS');
    expect(shared({ passengers: 2, bags: 5 })).toBe('SHARED_TOO_MANY_BAGS');
    expect(shared({ legs: [leg({ corridor: null })] })).toBe('SHARED_OUTSIDE_CORRIDOR');
    expect(shared({ extras: { childSeats: 0, extraStops: 1 } })).toBe('SHARED_NO_EXTRA_STOPS');
    expect(shared({ passengers: 2, bags: 4 })).toBeNull();
  });

  it('8. both-legs discount', () => {
    const q = computeQuote(input({ legs: [leg(), leg({ type: 'ARRIVAL' })] }), rules());
    expect(q.legs.map((l) => l.fareKobo)).toEqual([1_900_000, 1_900_000]);
    expect(q.discountKobo).toBe(200_000);
  });

  it('8. promo and corporate codes, validity and stacking limits', () => {
    expect(computeQuote(input({ promoCode: 'save10' }), rules()).legs[0]!.fareKobo).toBe(1_800_000);
    expect(err(() => computeQuote(input({ promoCode: 'NOPE' }), rules()))).toBe('PROMO_INVALID');
    expect(err(() => computeQuote(input({ promoCode: 'OLD' }), rules()))).toBe('PROMO_INVALID');
    expect(err(() => computeQuote(input({ corporateCode: 'NOPE' }), rules()))).toBe('CORPORATE_INVALID');
    // Not stackable: the better of promo (10%) and corporate (15%) wins.
    expect(computeQuote(input({ promoCode: 'SAVE10', corporateCode: 'ACME' }), rules()).legs[0]!.fareKobo).toBe(1_700_000);
    // Stackable, but capped at 25%: 5 + 10 + 15 = 30% -> 25%.
    const stack = rules({ discounts: { ...rules().discounts, promoWithCorporate: true } });
    const both = computeQuote(input({ legs: [leg(), leg({ type: 'ARRIVAL' })], promoCode: 'SAVE10', corporateCode: 'ACME' }), stack);
    expect(both.legs[0]!.fareKobo).toBe(1_500_000);
  });

  it('8. a flat promo comes off the first leg only', () => {
    const q = computeQuote(input({ legs: [leg(), leg({ type: 'ARRIVAL' })], promoCode: 'FLAT' }), rules({ discounts: { ...rules().discounts, bothLegsBps: 0 } }));
    expect(q.legs.map((l) => l.fareKobo)).toEqual([1_900_000, 2_000_000]);
  });

  it('9. tax on the fare, and on the airport fee only when the rule says so', () => {
    const vat = rules({ tax: { name: 'VAT', bps: 750, onAirportFee: false } });
    expect(computeQuote(input(), vat).legs[0]!.taxKobo).toBe(150_000);
    const vatAll = rules({ tax: { name: 'VAT', bps: 750, onAirportFee: true } });
    expect(computeQuote(input(), vatAll).legs[0]!.taxKobo).toBe(153_750);
  });

  it('9. rounding: the leg total is rounded and the difference goes to our fare, so tax stays exact', () => {
    const r = rules({ tax: { name: 'VAT', bps: 750, onAirportFee: false }, rounding: { toKobo: 10_000, mode: 'nearest' }, planMultiplierBps: { STANDARD: 10_000, FLEX: 11_111 } });
    const q = computeQuote(input({ plan: 'FLEX' }), r);
    const l = q.legs[0]!;
    expect(l.amountKobo % 10_000).toBe(0);
    expect(l.fareKobo + l.airportFeeKobo + l.taxKobo).toBe(l.amountKobo);
    expect(l.lines.reduce((s, x) => s + x.amountKobo, 0)).toBe(l.amountKobo);
    expect(roundKobo(1_234_567, { toKobo: 10_000, mode: 'up' })).toBe(1_240_000);
    expect(roundKobo(1_234_567, { toKobo: 10_000, mode: 'nearest' })).toBe(1_230_000);
  });

  it('every amount is whole kobo and the lines always add up to the price', () => {
    const r = rules({ planMultiplierBps: { STANDARD: 10_000, FLEX: 11_337 }, tax: { name: 'VAT', bps: 733, onAirportFee: true }, surcharges: [{ key: 'n', label: 'N', kind: 'TIME_OF_DAY', startHour: 0, endHour: 24, bps: 1_111 }] });
    const q = computeQuote(input({ plan: 'FLEX', legs: [leg(), leg({ type: 'ARRIVAL', zoneCode: 'AJAH' })], promoCode: 'SAVE10', bags: 3 }), r);
    for (const l of q.legs) {
      for (const x of l.lines) expect(Number.isInteger(x.amountKobo)).toBe(true);
      expect(l.lines.reduce((s, x) => s + x.amountKobo, 0)).toBe(l.amountKobo);
    }
    expect(q.totalKobo).toBe(q.legs.reduce((s, l) => s + l.amountKobo, 0));
  });
});

describe('cost model, margin floor and ceilings (PRD 12.5, PRC-05, PRC-07)', () => {
  const cost = {
    ...zeroCost,
    driverBaseKobo: 300_000,
    driverPerKmKobo: 20_000,
    carPartnerPerKmKobo: 10_000,
    energyPerKmKobo: 5_000,
    insurancePerLegKobo: 20_000,
    messagingPerLegKobo: 10_000,
    paymentFeeBps: 150,
    paymentFeeFlatKobo: 10_000,
    paymentFeeCapKobo: 200_000,
    emptyReturnBps: 5_000,
    disruptionReserveBps: { STANDARD: 0, FLEX: 650 },
    sharedCostShareBps: 5_000,
  };

  it('estimates every cost line for a trip', () => {
    const c = computeQuote(input(), rules({ cost })).legs[0]!.cost;
    expect(c.driverKobo).toBe(700_000); // 300,000 + 20 km x 20,000
    expect(c.carPartnerKobo).toBe(200_000);
    expect(c.energyKobo).toBe(100_000);
    expect(c.insuranceKobo).toBe(20_000);
    expect(c.messagingKobo).toBe(10_000);
    expect(c.emptyReturnKobo).toBe(500_000); // 50% of driver + car + energy
    expect(c.paymentFeeKobo).toBe(0); // the airline collected the money
    expect(c.disruptionReserveKobo).toBe(0);
    expect(c.totalKobo).toBe(1_530_000);
  });

  it('payment fees only when we collect, capped', () => {
    const c = computeQuote(input({ collectedBy: 'AIRWHEELS' }), rules({ cost })).legs[0]!.cost;
    expect(c.paymentFeeKobo).toBe(applyBps(2_050_000, 150) + 10_000); // 40,750
    const capped = computeQuote(input({ collectedBy: 'AIRWHEELS', vehicleClass: 'VAN' }), rules({ cost: { ...cost, paymentFeeCapKobo: 30_000 } })).legs[0]!.cost;
    expect(capped.paymentFeeKobo).toBe(30_000);
  });

  it('Flex carries the disruption reserve; shared travellers carry their share of the car', () => {
    expect(computeQuote(input({ plan: 'FLEX' }), rules({ cost })).legs[0]!.cost.disruptionReserveKobo).toBe(applyBps(2_300_000, 650));
    expect(computeQuote(input({ rideType: 'SHARED' }), rules({ cost })).legs[0]!.cost.driverKobo).toBe(350_000);
  });

  it('margin is our fare less costs and the airline share', () => {
    const q = computeQuote(input({ revenueShareBps: 1_000 }), rules({ cost }));
    const l = q.legs[0]!;
    expect(l.airlineShareKobo).toBe(200_000);
    expect(l.marginKobo).toBe(2_000_000 - 1_530_000 - 200_000);
    expect(q.flagged).toBe(false);
  });

  it('flags a quote under the margin floor', () => {
    const q = computeQuote(input({ revenueShareBps: 1_000 }), rules({ cost, marginFloorBps: 2_000 }));
    expect(q.flagged).toBe(true);
    expect(q.flagReasons).toContain('MARGIN_BELOW_FLOOR');
  });

  it('a price ceiling caps the private fare per zone, but never a shared one', () => {
    const q = computeQuote(input(), rules({ ceilings: { LEKKI: 1_800_000 } }));
    expect(q.legs[0]!.fareKobo).toBe(1_800_000);
    expect(q.legs[0]!.ceilingApplied).toBe(true);
    expect(line(q, 'ceiling')).toBe(-200_000);
    expect(computeQuote(input({ rideType: 'SHARED' }), rules({ ceilings: { LEKKI: 1_000_000 } })).legs[0]!.ceilingApplied).toBe(false);
  });

  it('the margin floor wins over the ceiling: the capped fare is lifted and the quote flagged', () => {
    const r = rules({ cost, ceilings: { LEKKI: 1_600_000 }, marginFloorBps: 1_000, rounding: { toKobo: 10_000, mode: 'nearest' } });
    const q = computeQuote(input(), r);
    const l = q.legs[0]!;
    expect(l.ceilingOverruled).toBe(true);
    expect(l.fareKobo).toBeGreaterThan(1_600_000);
    expect(l.fareKobo).toBeLessThanOrEqual(2_000_000);
    expect(l.marginKobo).toBeGreaterThanOrEqual(l.marginFloorKobo);
    expect(q.flagReasons).toContain('CEILING_OVERRULED_BY_MARGIN_FLOOR');
  });
});

describe('versioned rules (PRC-06)', () => {
  const row = (o: Partial<PricingRule>): PricingRule =>
    ({ id: 'x', type: 'PLAN', key: 'STANDARD', values: { multiplierBps: 10_000 }, version: 1, effectiveFrom: new Date('2026-01-01'), effectiveTo: null, createdById: null, createdAt: new Date(), updatedAt: new Date(), ...o }) as PricingRule;

  it('uses the highest version in force, ignoring future and ended versions', () => {
    const at = new Date('2026-11-06T12:00:00Z');
    const rows = [
      row({ id: 'v1', version: 1 }),
      row({ id: 'v2', version: 2, effectiveFrom: new Date('2026-11-01') }),
      row({ id: 'v3', version: 3, effectiveFrom: new Date('2026-12-01') }),
      row({ id: 'v4', version: 4, effectiveFrom: new Date('2026-06-01'), effectiveTo: new Date('2026-11-05') }),
    ];
    expect(rulesInForce(rows, at).map((r) => r.id)).toEqual(['v2']);
  });

  it('refuses values that do not match the rule type', () => {
    expect(ruleProblem('PLAN', 'FLEX', { multiplierBps: 11_500 })).toBeNull();
    expect(ruleProblem('PLAN', 'GOLD', { multiplierBps: 11_500 })).toMatch(/Key/);
    expect(ruleProblem('ZONE_FARE', 'LEKKI', { SEDAN: 25_000.5 })).toMatch(/not valid/);
    expect(ruleProblem('DISCOUNT', 'promo:SAVE10', { bps: 1_000, validTo: '2026-12-31' })).toBeNull();
    expect(ruleProblem('SURCHARGE', 'night', { label: 'Night', kind: 'TIME_OF_DAY', startHour: 22, endHour: 5, bps: 2_000 })).toBeNull();
  });

  it('a missing required rule is an error, never a silent zero', () => {
    expect(() => buildPricingRules([], { maxPassengers: 3, bagsPerPassenger: { large: 1, small: 1 }, vehicleClass: 'SUV' })).toThrow(MissingRuleError);
  });
});
