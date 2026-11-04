import type { Plan, RideType, VehicleClass } from '@airwheels/types';

/**
 * Pure quote calculation (PRD 12.2, 12.5). No I/O, so it is easy to test.
 * All inputs come from versioned PricingRules and the config store. All money is integer kobo.
 * This milestone covers base fare, vehicle class, plan, shared share, airline share and the
 * margin floor. Surcharges, extras, discounts and the full cost model come in M2.
 */
export interface QuoteInput {
  legs: { type: 'DEPARTURE' | 'ARRIVAL'; zoneCode: string }[];
  vehicleClass: VehicleClass;
  plan: Plan;
  rideType: RideType;
  zoneFares: Record<string, Partial<Record<VehicleClass, number>>>;
  planMultiplierBps: Record<Plan, number>;
  sharedShareBps: number;
  revenueShareBps: number;
  estimatedDriverPayBps: number;
  marginFloorBps: number;
}

export interface QuoteResult {
  legs: { type: 'DEPARTURE' | 'ARRIVAL'; zoneCode: string; amountKobo: number }[];
  totalKobo: number;
  airlineShareKobo: number;
  estimatedCostKobo: number;
  marginKobo: number;
  flagged: boolean;
  flagReason?: string;
}

const applyBps = (amount: number, bps: number) => Math.round((amount * bps) / 10_000);
/** Round to the nearest 100 naira (10,000 kobo). */
const roundFare = (kobo: number) => Math.round(kobo / 10_000) * 10_000;

export function computeQuote(input: QuoteInput): QuoteResult {
  const legs = input.legs.map((leg) => {
    const fare = input.zoneFares[leg.zoneCode]?.[input.vehicleClass];
    if (fare === undefined) throw new Error(`No ${input.vehicleClass} fare for zone ${leg.zoneCode}`);
    let amount = applyBps(fare, input.planMultiplierBps[input.plan]);
    if (input.rideType === 'SHARED') amount = applyBps(amount, input.sharedShareBps);
    return { ...leg, amountKobo: roundFare(amount) };
  });

  const totalKobo = legs.reduce((sum, l) => sum + l.amountKobo, 0);
  const airlineShareKobo = applyBps(totalKobo, input.revenueShareBps);
  const estimatedCostKobo = applyBps(totalKobo, input.estimatedDriverPayBps);
  const marginKobo = totalKobo - airlineShareKobo - estimatedCostKobo;
  const floor = applyBps(totalKobo, input.marginFloorBps);
  const flagged = marginKobo < floor;

  return {
    legs,
    totalKobo,
    airlineShareKobo,
    estimatedCostKobo,
    marginKobo,
    flagged,
    flagReason: flagged ? 'MARGIN_BELOW_FLOOR' : undefined,
  };
}
