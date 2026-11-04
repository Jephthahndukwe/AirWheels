import { BadRequestException, Injectable } from '@nestjs/common';
import type { Airline, PricingRule } from '@prisma/client';
import type { PartnerQuoteRequest, Plan, VehicleClass } from '@airwheels/types';
import { haversineKm } from '../../adapters/fakes';
import { PrismaService } from '../../common/prisma.service';
import { ConfigStore } from '../config/config.service';
import { CONFIG } from '../config/keys';
import { computeQuote } from './engine';

@Injectable()
export class PricingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigStore,
  ) {}

  /** Rules in force now: the highest version of each (type, key) whose window contains now. */
  async activeRules(now = new Date()): Promise<PricingRule[]> {
    const rows = await this.prisma.pricingRule.findMany({
      where: { effectiveFrom: { lte: now }, OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }] },
      orderBy: { version: 'desc' },
    });
    const seen = new Set<string>();
    return rows.filter((r) => {
      const k = `${r.type}:${r.key}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }

  /** Nearest zone centre to a point. Ops-drawn polygons replace this in M6. */
  async zoneFor(point: { lat: number; lng: number }) {
    const zones = await this.prisma.zone.findMany();
    let best: { code: string; km: number } | null = null;
    for (const z of zones) {
      const km = haversineKm(point, { lat: z.centerLat, lng: z.centerLng });
      if (!best || km < best.km) best = { code: z.code, km };
    }
    if (!best || best.km > 8) {
      throw new BadRequestException({ code: 'OUTSIDE_SERVICE_AREA', message: 'This address is outside our zones.' });
    }
    return best.code;
  }

  suggestVehicleClass(passengers: number, bags: number): VehicleClass {
    if (passengers <= 3 && bags <= 3) return 'SEDAN';
    if (passengers <= 4 && bags <= 5) return 'SUV';
    return 'VAN';
  }

  async quote(req: PartnerQuoteRequest, airline: Airline | null) {
    const rules = await this.activeRules();
    const byType = (t: PricingRule['type']) => rules.filter((r) => r.type === t);

    const zoneFares = Object.fromEntries(byType('ZONE_FARE').map((r) => [r.key, r.values])) as Record<
      string,
      Partial<Record<VehicleClass, number>>
    >;
    const planMultiplierBps = Object.fromEntries(
      byType('PLAN').map((r) => [r.key, (r.values as { multiplierBps: number }).multiplierBps]),
    ) as Record<Plan, number>;
    const shared = byType('SHARED_SHARE').find((r) => r.key === 'default');
    const version = Math.max(0, ...rules.map((r) => r.version));

    const legs = await Promise.all(
      req.legs.map(async (leg) => ({
        type: leg.type,
        // The non-airport end decides the zone.
        zoneCode: await this.zoneFor(leg.type === 'DEPARTURE' ? leg.pickup.location : leg.dropoff.location),
      })),
    );

    const result = computeQuote({
      legs,
      vehicleClass: req.vehicleClass ?? this.suggestVehicleClass(req.passengers, req.bags),
      plan: req.plan,
      rideType: req.rideType,
      zoneFares,
      planMultiplierBps,
      sharedShareBps: (shared?.values as { bps: number } | undefined)?.bps ?? 10_000,
      revenueShareBps: airline?.revenueShareBps ?? 0,
      estimatedDriverPayBps: await this.config.get<number>(CONFIG.driverPayShareBps),
      marginFloorBps: await this.config.get<number>(CONFIG.marginFloorBps),
    });

    const expiresAt = new Date(Date.now() + (airline?.quoteExpiryMinutes ?? 30) * 60_000);
    const quote = await this.prisma.quote.create({
      data: {
        airlineId: airline?.id,
        request: req as object,
        breakdown: result as object,
        totalKobo: result.totalKobo,
        marginKobo: result.marginKobo,
        flagged: result.flagged,
        pricingRuleVersion: version,
        expiresAt,
      },
    });

    return {
      quoteId: quote.id,
      totalKobo: result.totalKobo,
      currency: 'NGN' as const,
      expiresAt: expiresAt.toISOString(),
      legs: result.legs.map((l) => ({ type: l.type, amountKobo: l.amountKobo })),
    };
  }
}
