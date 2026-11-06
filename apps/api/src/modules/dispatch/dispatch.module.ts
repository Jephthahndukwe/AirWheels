import { Inject, Injectable, Module } from '@nestjs/common';
import type { LegRequest } from '@airwheels/types';
import { MAPS, type MapsAdapter } from '../../adapters/interfaces';
import { ConfigStore } from '../config/config.service';
import { CONFIG } from '../config/keys';
import { LAGOS_UTC_OFFSET_MINUTES, departurePickupTime } from './timing';

/**
 * Pickup times (PRD 10.1, DSP-01). Departure: flight departure less the airport buffer, travel
 * time and the safety margin. Arrival: the driver is at the meeting point by the landing time.
 * Used by quoting (time surcharges depend on the pickup hour) and by booking creation.
 */
@Injectable()
export class PickupTimesService {
  constructor(
    private readonly config: ConfigStore,
    @Inject(MAPS) private readonly maps: MapsAdapter,
  ) {}

  async forLeg(leg: Pick<LegRequest, 'type' | 'pickup' | 'dropoff' | 'flight'>): Promise<Date> {
    if (leg.type === 'ARRIVAL') return new Date(leg.flight.scheduledArrival);
    const departure = new Date(leg.flight.scheduledDeparture);
    const [travelMinutes, buffer, margin, extra, beforeHour] = await Promise.all([
      this.maps.travelTimeMinutes(leg.pickup.location, leg.dropoff.location, departure),
      this.config.get<number>(CONFIG.airportBufferDomesticMin),
      this.config.get<number>(CONFIG.safetyMarginMin),
      this.config.get<number>(CONFIG.earlyMorningMarginMin),
      this.config.get<number>(CONFIG.earlyMorningBeforeHour),
    ]);
    return departurePickupTime({
      departure,
      travelMinutes,
      airportBufferMinutes: buffer,
      safetyMarginMinutes: margin,
      earlyMorningExtraMarginMinutes: extra,
      earlyMorningBeforeHour: beforeHour,
      utcOffsetMinutes: LAGOS_UTC_OFFSET_MINUTES,
    });
  }
}

/** Local date and hour in Africa/Lagos (UTC+1, no daylight saving). */
export function lagosParts(at: Date): { date: string; hour: number } {
  const local = new Date(at.getTime() + LAGOS_UTC_OFFSET_MINUTES * 60_000);
  return { date: local.toISOString().slice(0, 10), hour: local.getUTCHours() };
}

/** Night-before plan, arrival offers, sweeper and trip steps arrive in M4 (PRD 24). */
@Injectable()
export class DispatchService {}

@Module({ providers: [DispatchService, PickupTimesService], exports: [DispatchService, PickupTimesService] })
export class DispatchModule {}
