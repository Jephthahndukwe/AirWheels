import type { Plan, RideType, VehicleClass } from '@airwheels/types';

/**
 * Pure quote engine (PRD 12.2, 12.5, 11.8). No I/O: every number comes in as data from the
 * versioned PricingRules and the config store, so it is easy to test. All money is integer kobo;
 * percentages are basis points (1% = 100 bps) and every result is rounded to whole kobo.
 *
 * Traveller price per leg, in the PRD's order:
 *   1 base fare (zone table, by vehicle class)   2 airport fee (passed through at cost)
 *   3 time surcharges (night, early, peak dates) 4 vehicle class and extra bags
 *   5 extras (child seat, extra stops)           6 plan multiplier (Standard, Flex)
 *   7 shared fare share                          8 discounts (both legs, promo, corporate)
 *   9 tax and rounding
 * The airport fee is a pass-through, so the plan, shared share, ceiling and discounts never touch it.
 * The cost model runs alongside and the margin floor wins over the price ceiling (12.1, PRC-07).
 */

export type CollectedBy = 'AIRLINE' | 'AIRWHEELS';

export type Surcharge =
  | { key: string; label: string; kind: 'TIME_OF_DAY'; startHour: number; endHour: number; bps: number }
  | { key: string; label: string; kind: 'DATE_RANGE'; from: string; to: string; bps: number };

export interface VehicleClassRule {
  maxPassengers: number;
  maxBags: number;
  includedBags: number;
  extraBagKobo: number;
}

export interface Promo {
  bps?: number;
  flatKobo?: number;
  validFrom?: string; // YYYY-MM-DD, inclusive
  validTo?: string; // YYYY-MM-DD, inclusive
}

export interface CostModel {
  driverBaseKobo: number;
  driverPerKmKobo: number;
  carPartnerPerKmKobo: number;
  energyPerKmKobo: number;
  insurancePerLegKobo: number;
  messagingPerLegKobo: number;
  paymentFeeBps: number;
  paymentFeeFlatKobo: number;
  paymentFeeCapKobo: number;
  emptyReturnBps: number;
  disruptionReserveBps: Record<Plan, number>;
  /** Shared rides: share of the car's cost one traveller carries (5000 = we expect two per car). */
  sharedCostShareBps: number;
}

export interface SharedLimits {
  maxPassengersPerBooking: number;
  bagsPerPassenger: number;
  vehicleClass: VehicleClass;
}

export interface PricingRules {
  zoneFares: Record<string, Partial<Record<VehicleClass, number>>>;
  ceilings: Record<string, number>;
  airportFeeKobo: number;
  childSeatKobo: number;
  extraStopKobo: number;
  surcharges: Surcharge[];
  vehicleClasses: Record<VehicleClass, VehicleClassRule>;
  planMultiplierBps: Record<Plan, number>;
  sharedShareBps: { default: number; byCorridor: Record<string, number> };
  discounts: {
    bothLegsBps: number;
    promos: Record<string, Promo>;
    corporate: Record<string, { bps: number }>;
    maxTotalBps: number;
    promoWithCorporate: boolean;
  };
  tax: { name: string; bps: number; onAirportFee: boolean };
  rounding: { toKobo: number; mode: 'nearest' | 'up' };
  cost: CostModel;
  marginFloorBps: number;
  sharedLimits: SharedLimits;
}

export interface LegQuoteInput {
  type: 'DEPARTURE' | 'ARRIVAL';
  zoneCode: string;
  /** Corridor of the non-airport address; null means outside every corridor (Private only). */
  corridor: string | null;
  /** Road distance between the address and the airport. */
  distanceKm: number;
  /** Pickup date and hour in Africa/Lagos. */
  localDate: string;
  localHour: number;
}

export interface QuoteInput {
  legs: LegQuoteInput[];
  passengers: number;
  bags: number;
  vehicleClass: VehicleClass;
  plan: Plan;
  rideType: RideType;
  extras: { childSeats: number; extraStops: number };
  promoCode?: string;
  corporateCode?: string;
  revenueShareBps: number;
  collectedBy: CollectedBy;
  /** Today in Africa/Lagos, for promo validity. */
  today: string;
}

export interface Line {
  code: string;
  label: string;
  amountKobo: number;
}

export interface LegCost {
  driverKobo: number;
  carPartnerKobo: number;
  energyKobo: number;
  insuranceKobo: number;
  messagingKobo: number;
  emptyReturnKobo: number;
  paymentFeeKobo: number;
  disruptionReserveKobo: number;
  totalKobo: number;
}

export interface LegQuote {
  type: 'DEPARTURE' | 'ARRIVAL';
  zoneCode: string;
  lines: Line[];
  /** Our fare after plan, shared share, ceiling, discount and rounding (what we earn, before costs). */
  fareKobo: number;
  airportFeeKobo: number;
  taxKobo: number;
  /** What the traveller pays for this leg: fare + airport fee + tax. */
  amountKobo: number;
  airlineShareKobo: number;
  cost: LegCost;
  marginKobo: number;
  marginFloorKobo: number;
  ceilingKobo?: number;
  ceilingApplied: boolean;
  ceilingOverruled: boolean;
}

export interface QuoteResult {
  legs: LegQuote[];
  totalKobo: number;
  fareKobo: number;
  airportFeeKobo: number;
  taxKobo: number;
  discountKobo: number;
  airlineShareKobo: number;
  estimatedCostKobo: number;
  marginKobo: number;
  flagged: boolean;
  flagReasons: string[];
  /** Kept for M0 callers and the admin list. */
  flagReason?: string;
  vehicleClass: VehicleClass;
}

export class QuoteError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/** Basis points of an integer amount, rounded half up to whole kobo. */
export const applyBps = (amountKobo: number, bps: number): number => Math.round((amountKobo * bps) / 10_000);

export function roundKobo(kobo: number, rule: PricingRules['rounding']): number {
  if (rule.toKobo <= 1) return kobo;
  const steps = kobo / rule.toKobo;
  return (rule.mode === 'up' ? Math.ceil(steps) : Math.round(steps)) * rule.toKobo;
}

/** True when the hour falls in [startHour, endHour), including windows that wrap past midnight. */
export const inHourWindow = (hour: number, start: number, end: number): boolean =>
  start <= end ? hour >= start && hour < end : hour >= start || hour < end;

const inDateRange = (date: string, from?: string, to?: string) => (!from || date >= from) && (!to || date <= to);

/** Shared limits (PRD 11.1): a booking for 3 or more is Private only, bags per passenger, corridor needed. */
export function sharedProblem(input: QuoteInput, limits: SharedLimits): string | null {
  if (input.rideType !== 'SHARED') return null;
  if (input.passengers > limits.maxPassengersPerBooking) return 'SHARED_TOO_MANY_PASSENGERS';
  if (input.bags > input.passengers * limits.bagsPerPassenger) return 'SHARED_TOO_MANY_BAGS';
  if (input.extras.extraStops > 0) return 'SHARED_NO_EXTRA_STOPS';
  if (input.legs.some((l) => !l.corridor)) return 'SHARED_OUTSIDE_CORRIDOR';
  return null;
}

const SHARED_MESSAGES: Record<string, string> = {
  SHARED_TOO_MANY_PASSENGERS: 'Shared rides are for bookings of up to 2 people. Choose Private.',
  SHARED_TOO_MANY_BAGS: 'Shared rides allow 1 large and 1 small bag per person. Choose Private for more bags.',
  SHARED_NO_EXTRA_STOPS: 'Extra stops are not available on shared rides.',
  SHARED_OUTSIDE_CORRIDOR: 'Shared rides are not available at this address yet. Choose Private.',
};

/** Vehicle class suggested from passengers and bags (CHN-09): the smallest class that fits. */
export function suggestVehicleClass(passengers: number, bags: number, classes: PricingRules['vehicleClasses']): VehicleClass {
  const order: VehicleClass[] = ['SEDAN', 'SUV', 'VAN'];
  return order.find((c) => passengers <= classes[c].maxPassengers && bags <= classes[c].maxBags) ?? 'VAN';
}

function legCost(fareKobo: number, amountKobo: number, leg: LegQuoteInput, input: QuoteInput, rules: PricingRules): LegCost {
  const c = rules.cost;
  const km = Math.max(0, leg.distanceKm);
  const share = input.rideType === 'SHARED' ? c.sharedCostShareBps : 10_000;
  const driverKobo = applyBps(c.driverBaseKobo + Math.round(c.driverPerKmKobo * km), share);
  const carPartnerKobo = applyBps(Math.round(c.carPartnerPerKmKobo * km), share);
  const energyKobo = applyBps(Math.round(c.energyPerKmKobo * km), share);
  const insuranceKobo = applyBps(c.insurancePerLegKobo, share);
  const messagingKobo = c.messagingPerLegKobo;
  const emptyReturnKobo = applyBps(driverKobo + carPartnerKobo + energyKobo, c.emptyReturnBps);
  const paymentFeeKobo =
    input.collectedBy === 'AIRWHEELS'
      ? Math.min(c.paymentFeeCapKobo, applyBps(amountKobo, c.paymentFeeBps) + c.paymentFeeFlatKobo)
      : 0;
  const disruptionReserveKobo = applyBps(fareKobo, c.disruptionReserveBps[input.plan]);
  const totalKobo =
    driverKobo + carPartnerKobo + energyKobo + insuranceKobo + messagingKobo + emptyReturnKobo + paymentFeeKobo + disruptionReserveKobo;
  return { driverKobo, carPartnerKobo, energyKobo, insuranceKobo, messagingKobo, emptyReturnKobo, paymentFeeKobo, disruptionReserveKobo, totalKobo };
}

interface LegDraft {
  leg: LegQuoteInput;
  lines: Line[];
  /** Fare after plan and shared share, before ceiling and discount. */
  fareBeforeCeiling: number;
  fareAfterCeiling: number;
  ceilingKobo?: number;
}

function discountBps(input: QuoteInput, rules: PricingRules): { bps: number; flatKobo: number; lines: Line[] } {
  const d = rules.discounts;
  const lines: Line[] = [];
  let bps = 0;
  let flatKobo = 0;
  if (input.legs.length === 2 && d.bothLegsBps > 0) {
    bps += d.bothLegsBps;
    lines.push({ code: 'discount.both_legs', label: 'Both legs together', amountKobo: 0 });
  }
  const promo = input.promoCode ? d.promos[input.promoCode.trim().toUpperCase()] : undefined;
  if (input.promoCode && (!promo || !inDateRange(input.today, promo.validFrom, promo.validTo))) {
    throw new QuoteError('PROMO_INVALID', 'That promo code is not valid.');
  }
  const corporate = input.corporateCode ? d.corporate[input.corporateCode.trim().toUpperCase()] : undefined;
  if (input.corporateCode && !corporate) throw new QuoteError('CORPORATE_INVALID', 'That corporate code is not valid.');

  let promoBps = promo?.bps ?? 0;
  let promoFlat = promo?.flatKobo ?? 0;
  let corpBps = corporate?.bps ?? 0;
  if (promo && corporate && !d.promoWithCorporate) {
    // Not stackable: keep the better percentage.
    if (corpBps >= promoBps) {
      promoBps = 0;
      promoFlat = 0;
    } else corpBps = 0;
  }
  if (promoBps || promoFlat) lines.push({ code: 'discount.promo', label: `Promo ${input.promoCode!.toUpperCase()}`, amountKobo: 0 });
  if (corpBps) lines.push({ code: 'discount.corporate', label: 'Corporate rate', amountKobo: 0 });
  bps += promoBps + corpBps;
  flatKobo += promoFlat;
  return { bps: Math.min(bps, d.maxTotalBps), flatKobo, lines };
}

export function computeQuote(input: QuoteInput, rules: PricingRules): QuoteResult {
  if (input.legs.length < 1 || input.legs.length > 2) throw new QuoteError('LEGS_INVALID', 'A booking has one or two legs.');
  const shared = sharedProblem(input, rules.sharedLimits);
  if (shared) throw new QuoteError(shared, SHARED_MESSAGES[shared]!);
  const vehicleClass = input.rideType === 'SHARED' ? rules.sharedLimits.vehicleClass : input.vehicleClass;
  const vc = rules.vehicleClasses[vehicleClass];
  if (input.rideType === 'PRIVATE' && (input.passengers > vc.maxPassengers || input.bags > vc.maxBags)) {
    throw new QuoteError('VEHICLE_TOO_SMALL', `A ${vehicleClass.toLowerCase()} does not fit ${input.passengers} passengers and ${input.bags} bags.`);
  }

  // Steps 1 to 7 per leg.
  const drafts: LegDraft[] = input.legs.map((leg) => {
    const base = rules.zoneFares[leg.zoneCode]?.[vehicleClass];
    if (base === undefined) throw new QuoteError('OUTSIDE_SERVICE_AREA', `We do not serve ${leg.zoneCode} yet.`);
    const lines: Line[] = [{ code: 'base', label: `Base fare (${vehicleClass.toLowerCase()})`, amountKobo: base }];

    for (const s of rules.surcharges) {
      const hit =
        s.kind === 'TIME_OF_DAY' ? inHourWindow(leg.localHour, s.startHour, s.endHour) : inDateRange(leg.localDate, s.from, s.to);
      if (hit) lines.push({ code: `surcharge.${s.key}`, label: s.label, amountKobo: applyBps(base, s.bps) });
    }
    if (input.rideType === 'PRIVATE') {
      const extraBags = Math.max(0, input.bags - vc.includedBags);
      if (extraBags > 0) lines.push({ code: 'bags', label: `${extraBags} extra bag${extraBags > 1 ? 's' : ''}`, amountKobo: extraBags * vc.extraBagKobo });
    }
    if (input.extras.childSeats > 0) {
      lines.push({ code: 'extra.child_seat', label: `Child seat x${input.extras.childSeats}`, amountKobo: input.extras.childSeats * rules.childSeatKobo });
    }
    if (input.extras.extraStops > 0) {
      lines.push({ code: 'extra.stop', label: `Extra stop x${input.extras.extraStops}`, amountKobo: input.extras.extraStops * rules.extraStopKobo });
    }
    const subtotal = lines.reduce((s, l) => s + l.amountKobo, 0);

    const planBps = rules.planMultiplierBps[input.plan];
    let fare = applyBps(subtotal, planBps);
    if (fare !== subtotal) lines.push({ code: 'plan', label: `${input.plan === 'FLEX' ? 'Flex' : 'Standard'} plan`, amountKobo: fare - subtotal });

    if (input.rideType === 'SHARED') {
      const shareBps = rules.sharedShareBps.byCorridor[leg.corridor!] ?? rules.sharedShareBps.default;
      const sharedFare = applyBps(fare, shareBps);
      lines.push({ code: 'shared', label: 'Shared ride', amountKobo: sharedFare - fare });
      fare = sharedFare;
    }

    const ceiling = input.rideType === 'PRIVATE' ? rules.ceilings[leg.zoneCode] : undefined;
    const capped = ceiling !== undefined && fare > ceiling ? ceiling : fare;
    return { leg, lines, fareBeforeCeiling: fare, fareAfterCeiling: capped, ceilingKobo: ceiling };
  });

  // Step 8: discounts apply to the fare of the whole booking; a flat promo comes off the first leg.
  const disc = discountBps(input, rules);
  const flagReasons = new Set<string>();

  const priceLeg = (d: LegDraft, fareBeforeDiscount: number, flatKobo: number) => {
    const discount = Math.min(fareBeforeDiscount, applyBps(fareBeforeDiscount, disc.bps) + flatKobo);
    let fare = fareBeforeDiscount - discount;
    const airportFeeKobo = rules.airportFeeKobo;
    // Step 9: tax, then round the leg total; the rounding difference goes to our fare so tax stays exact.
    const taxable = fare + (rules.tax.onAirportFee ? airportFeeKobo : 0);
    const taxKobo = applyBps(taxable, rules.tax.bps);
    const exact = fare + airportFeeKobo + taxKobo;
    const amountKobo = Math.max(airportFeeKobo + taxKobo, roundKobo(exact, rules.rounding));
    fare += amountKobo - exact;
    const airlineShareKobo = applyBps(fare, input.revenueShareBps);
    const cost = legCost(fare, amountKobo, d.leg, input, rules);
    const marginKobo = fare - cost.totalKobo - airlineShareKobo;
    const marginFloorKobo = applyBps(fare, rules.marginFloorBps);
    return { fareBeforeDiscount, discount, fare, airportFeeKobo, taxKobo, amountKobo, airlineShareKobo, cost, marginKobo, marginFloorKobo };
  };

  const legs: LegQuote[] = drafts.map((d, i) => {
    const flat = i === 0 ? disc.flatKobo : 0;
    let priced = priceLeg(d, d.fareAfterCeiling, flat);
    const ceilingApplied = d.fareAfterCeiling < d.fareBeforeCeiling;
    let ceilingOverruled = false;

    // The margin floor wins over the ceiling (PRC-07): lift the capped fare, one rounding step at a
    // time, until the floor is met or the uncapped price is reached. Ops then decides (flagged).
    if (ceilingApplied && priced.marginKobo < priced.marginFloorKobo) {
      const step = Math.max(1, rules.rounding.toKobo);
      let fare = d.fareAfterCeiling;
      while (fare < d.fareBeforeCeiling) {
        fare = Math.min(d.fareBeforeCeiling, fare + step);
        priced = priceLeg(d, fare, flat);
        if (priced.marginKobo >= priced.marginFloorKobo) break;
      }
      ceilingOverruled = true;
      flagReasons.add('CEILING_OVERRULED_BY_MARGIN_FLOOR');
    }
    if (priced.marginKobo < priced.marginFloorKobo) flagReasons.add('MARGIN_BELOW_FLOOR');

    const lines = [...d.lines];
    if (ceilingApplied) {
      lines.push({
        code: ceilingOverruled ? 'ceiling.overruled' : 'ceiling',
        label: ceilingOverruled ? 'Price cap (partly lifted to cover costs)' : 'Price cap for this area',
        amountKobo: priced.fareBeforeDiscount - d.fareBeforeCeiling,
      });
    }
    if (priced.discount > 0) lines.push({ code: 'discount', label: disc.lines.map((l) => l.label).join(', ') || 'Discount', amountKobo: -priced.discount });
    lines.push({ code: 'airport_fee', label: 'Airport fee (passed through at cost)', amountKobo: priced.airportFeeKobo });
    if (priced.taxKobo > 0) lines.push({ code: 'tax', label: rules.tax.name, amountKobo: priced.taxKobo });
    const listed = lines.reduce((s, l) => s + l.amountKobo, 0);
    if (listed !== priced.amountKobo) lines.push({ code: 'rounding', label: 'Rounding', amountKobo: priced.amountKobo - listed });

    return {
      type: d.leg.type,
      zoneCode: d.leg.zoneCode,
      lines,
      fareKobo: priced.fare,
      airportFeeKobo: priced.airportFeeKobo,
      taxKobo: priced.taxKobo,
      amountKobo: priced.amountKobo,
      airlineShareKobo: priced.airlineShareKobo,
      cost: priced.cost,
      marginKobo: priced.marginKobo,
      marginFloorKobo: priced.marginFloorKobo,
      ceilingKobo: d.ceilingKobo,
      ceilingApplied,
      ceilingOverruled,
    };
  });

  const sum = (f: (l: LegQuote) => number) => legs.reduce((s, l) => s + f(l), 0);
  const reasons = [...flagReasons];
  return {
    legs,
    totalKobo: sum((l) => l.amountKobo),
    fareKobo: sum((l) => l.fareKobo),
    airportFeeKobo: sum((l) => l.airportFeeKobo),
    taxKobo: sum((l) => l.taxKobo),
    discountKobo: -sum((l) => l.lines.find((x) => x.code === 'discount')?.amountKobo ?? 0),
    airlineShareKobo: sum((l) => l.airlineShareKobo),
    estimatedCostKobo: sum((l) => l.cost.totalKobo),
    marginKobo: sum((l) => l.marginKobo),
    flagged: reasons.length > 0,
    flagReasons: reasons,
    flagReason: reasons[0],
    vehicleClass,
  };
}
