import type { PricingRule, PricingRuleType } from '@prisma/client';
import { z } from 'zod';
import type { PricingRules, SharedLimits } from './engine';

/**
 * Pricing rules are versioned, effective-dated rows (PRD 12.6, PRC-06). Each type has a value
 * schema: the admin editor refuses anything that does not match, so a typo cannot reach a quote.
 */
const Kobo = z.number().int().nonnegative();
const Bps = z.number().int().min(0).max(100_000);
const Day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const Hour = z.number().int().min(0).max(24);

const Keyed = <T extends z.ZodTypeAny>(key: z.ZodType<string>, values: T) => ({ key, values });
const anyKey = z.string().min(1).max(60);
const vehicle = z.enum(['SEDAN', 'SUV', 'VAN']);

export const RULE_SCHEMAS: Record<
  PricingRuleType,
  { key: z.ZodType<string>; values: z.ZodTypeAny; help: string }
> = {
  ZONE_FARE: {
    ...Keyed(
      anyKey,
      z
        .object({
          SEDAN: Kobo.optional(),
          SUV: Kobo.optional(),
          VAN: Kobo.optional(),
          placeholder: z.boolean().optional(),
        })
        .strict(),
    ),
    help: 'Key: zone code. Base fare per vehicle class in kobo, e.g. {"SEDAN": 2500000, "SUV": 3500000}',
  },
  CEILING: {
    ...Keyed(anyKey, z.object({ maxKobo: Kobo }).strict()),
    help: 'Key: zone code. Highest private fare per leg, e.g. {"maxKobo": 3000000}. The margin floor can lift it.',
  },
  FEE: {
    ...Keyed(z.enum(['airport', 'childSeat', 'extraStop']), z.object({ kobo: Kobo }).strict()),
    help: 'Key: airport, childSeat or extraStop. Amount in kobo, e.g. {"kobo": 50000}',
  },
  SURCHARGE: {
    ...Keyed(
      anyKey,
      z.union([
        z
          .object({
            label: z.string().min(1),
            kind: z.literal('TIME_OF_DAY'),
            startHour: Hour,
            endHour: Hour,
            bps: Bps,
          })
          .strict(),
        z
          .object({
            label: z.string().min(1),
            kind: z.literal('DATE_RANGE'),
            from: Day,
            to: Day,
            bps: Bps,
          })
          .strict(),
      ]),
    ),
    help: 'Key: a name. {"label":"Night","kind":"TIME_OF_DAY","startHour":22,"endHour":5,"bps":2000} or {"label":"Christmas","kind":"DATE_RANGE","from":"2026-12-20","to":"2027-01-05","bps":1500}',
  },
  VEHICLE_CLASS: {
    ...Keyed(
      vehicle,
      z
        .object({
          maxPassengers: z.number().int().min(1),
          maxBags: z.number().int().min(0),
          includedBags: z.number().int().min(0),
          extraBagKobo: Kobo,
        })
        .strict(),
    ),
    help: 'Key: SEDAN, SUV or VAN. {"maxPassengers":3,"maxBags":3,"includedBags":2,"extraBagKobo":50000}',
  },
  PLAN: {
    ...Keyed(z.enum(['STANDARD', 'FLEX']), z.object({ multiplierBps: Bps }).strict()),
    help: 'Key: STANDARD or FLEX. {"multiplierBps": 11500} means 1.15 times',
  },
  SHARED_SHARE: {
    ...Keyed(anyKey, z.object({ bps: Bps }).strict()),
    help: 'Key: default, or a corridor name. Share of the private fare, e.g. {"bps": 6000}',
  },
  DISCOUNT: {
    ...Keyed(
      z.string().regex(/^(bothLegs|stacking|promo:[A-Z0-9]{3,20}|corporate:[A-Z0-9]{3,20})$/),
      z.union([
        z.object({ bps: Bps }).strict(),
        z
          .object({
            bps: Bps.optional(),
            flatKobo: Kobo.optional(),
            validFrom: Day.optional(),
            validTo: Day.optional(),
          })
          .strict(),
        z.object({ maxTotalBps: Bps, promoWithCorporate: z.boolean() }).strict(),
      ]),
    ),
    help: 'Keys: bothLegs {"bps":500}, promo:CODE {"bps":1000,"validTo":"2026-12-31"}, corporate:CODE {"bps":1500}, stacking {"maxTotalBps":2500,"promoWithCorporate":false}',
  },
  TAX: {
    ...Keyed(
      z.literal('vat'),
      z.object({ name: z.string().min(1), bps: Bps, onAirportFee: z.boolean() }).strict(),
    ),
    help: 'Key: vat. {"name":"VAT","bps":750,"onAirportFee":false}. Confirm treatment with the accountant (14.8)',
  },
  ROUNDING: {
    ...Keyed(
      z.literal('default'),
      z.object({ toKobo: z.number().int().min(1), mode: z.enum(['nearest', 'up']) }).strict(),
    ),
    help: 'Key: default. {"toKobo":10000,"mode":"nearest"} rounds each leg to the nearest 100 naira',
  },
  COST_MODEL: {
    ...Keyed(
      z.literal('default'),
      z
        .object({
          driverBaseKobo: Kobo,
          driverPerKmKobo: Kobo,
          carPartnerPerKmKobo: Kobo,
          energyPerKmKobo: Kobo,
          insurancePerLegKobo: Kobo,
          messagingPerLegKobo: Kobo,
          paymentFeeBps: Bps,
          paymentFeeFlatKobo: Kobo,
          paymentFeeCapKobo: Kobo,
          emptyReturnBps: Bps,
          disruptionReserveBps: z.object({ STANDARD: Bps, FLEX: Bps }).strict(),
          sharedCostShareBps: Bps,
          roadFactorBps: Bps,
        })
        .strict(),
    ),
    help: 'Key: default. Cost per trip estimate (12.5). All amounts in kobo, percentages in bps.',
  },
  MARGIN_FLOOR: {
    ...Keyed(z.literal('default'), z.object({ bps: Bps }).strict()),
    help: 'Key: default. Lowest margin as a share of our fare, e.g. {"bps":1500}',
  },
  REVENUE_SHARE: {
    ...Keyed(anyKey, z.object({ bps: Bps }).strict()),
    help: 'Key: airline code. The airline keeps this share of the fare, e.g. {"bps":1000}',
  },
};

export function ruleProblem(type: PricingRuleType, key: string, values: unknown): string | null {
  const schema = RULE_SCHEMAS[type];
  const k = schema.key.safeParse(key);
  if (!k.success) return `Key "${key}" is not valid for ${type}. ${schema.help}`;
  const v = schema.values.safeParse(values);
  if (!v.success)
    return `Values are not valid for ${type}: ${v.error.issues.map((i) => `${i.path.join('.') || 'value'} ${i.message}`).join('; ')}. ${schema.help}`;
  return null;
}

/** The rows in force at `at`: per (type, key), the highest version whose window contains `at`. */
export function rulesInForce(rows: PricingRule[], at: Date): PricingRule[] {
  const live = rows.filter((r) => r.effectiveFrom <= at && (!r.effectiveTo || r.effectiveTo > at));
  const best = new Map<string, PricingRule>();
  for (const r of live) {
    const k = `${r.type}:${r.key}`;
    const cur = best.get(k);
    if (!cur || r.version > cur.version) best.set(k, r);
  }
  return [...best.values()];
}

export class MissingRuleError extends Error {}

/** Turns rule rows into the engine's input. Missing required rules are an error, never a silent zero. */
export function buildPricingRules(
  rows: PricingRule[],
  sharedConfig: {
    maxPassengers: number;
    bagsPerPassenger: { large: number; small: number };
    vehicleClass: string;
  },
): PricingRules & { roadFactorBps: number } {
  const of = <T>(type: PricingRuleType) =>
    rows.filter((r) => r.type === type).map((r) => ({ key: r.key, v: r.values as T }));
  const one = <T>(type: PricingRuleType, key: string): T => {
    const r = rows.find((x) => x.type === type && x.key === key);
    if (!r)
      throw new MissingRuleError(
        `Pricing rule ${type}/${key} is missing. Add it in the admin (Pricing).`,
      );
    return r.values as T;
  };
  const opt = <T>(type: PricingRuleType, key: string): T | undefined =>
    rows.find((x) => x.type === type && x.key === key)?.values as T | undefined;

  const vehicleClasses = Object.fromEntries(
    (['SEDAN', 'SUV', 'VAN'] as const).map((c) => [
      c,
      one<PricingRules['vehicleClasses']['SEDAN']>('VEHICLE_CLASS', c),
    ]),
  ) as PricingRules['vehicleClasses'];
  const discountRows = of<Record<string, unknown>>('DISCOUNT');
  const stacking = opt<{ maxTotalBps: number; promoWithCorporate: boolean }>(
    'DISCOUNT',
    'stacking',
  ) ?? { maxTotalBps: 0, promoWithCorporate: false };
  const cost = one<PricingRules['cost'] & { roadFactorBps: number }>('COST_MODEL', 'default');
  const sharedLimits: SharedLimits = {
    // PRD 11.1: at most 3 passengers per car, so a booking for 3 or more is Private only.
    maxPassengersPerBooking: Math.max(1, sharedConfig.maxPassengers - 1),
    bagsPerPassenger: sharedConfig.bagsPerPassenger.large + sharedConfig.bagsPerPassenger.small,
    vehicleClass: sharedConfig.vehicleClass as PricingRules['sharedLimits']['vehicleClass'],
  };

  return {
    zoneFares: Object.fromEntries(
      of<Record<string, number>>('ZONE_FARE').map(({ key, v }) => [key, v]),
    ),
    ceilings: Object.fromEntries(
      of<{ maxKobo: number }>('CEILING').map(({ key, v }) => [key, v.maxKobo]),
    ),
    airportFeeKobo: one<{ kobo: number }>('FEE', 'airport').kobo,
    childSeatKobo: one<{ kobo: number }>('FEE', 'childSeat').kobo,
    extraStopKobo: one<{ kobo: number }>('FEE', 'extraStop').kobo,
    surcharges: of<Record<string, unknown>>('SURCHARGE').map(
      ({ key, v }) => ({ key, ...v }) as PricingRules['surcharges'][number],
    ),
    vehicleClasses,
    planMultiplierBps: {
      STANDARD: one<{ multiplierBps: number }>('PLAN', 'STANDARD').multiplierBps,
      FLEX: one<{ multiplierBps: number }>('PLAN', 'FLEX').multiplierBps,
    },
    sharedShareBps: {
      default: one<{ bps: number }>('SHARED_SHARE', 'default').bps,
      byCorridor: Object.fromEntries(
        of<{ bps: number }>('SHARED_SHARE')
          .filter((r) => r.key !== 'default')
          .map(({ key, v }) => [key, v.bps]),
      ),
    },
    discounts: {
      bothLegsBps: opt<{ bps: number }>('DISCOUNT', 'bothLegs')?.bps ?? 0,
      promos: Object.fromEntries(
        discountRows
          .filter((r) => r.key.startsWith('promo:'))
          .map(({ key, v }) => [key.slice(6), v]),
      ),
      corporate: Object.fromEntries(
        discountRows
          .filter((r) => r.key.startsWith('corporate:'))
          .map(({ key, v }) => [key.slice(10), v as { bps: number }]),
      ),
      maxTotalBps: stacking.maxTotalBps,
      promoWithCorporate: stacking.promoWithCorporate,
    },
    tax: opt<PricingRules['tax']>('TAX', 'vat') ?? { name: 'Tax', bps: 0, onAirportFee: false },
    rounding: one<PricingRules['rounding']>('ROUNDING', 'default'),
    cost,
    roadFactorBps: cost.roadFactorBps,
    marginFloorBps: one<{ bps: number }>('MARGIN_FLOOR', 'default').bps,
    sharedLimits,
  };
}
