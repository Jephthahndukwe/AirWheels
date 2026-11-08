/**
 * Pure leg timing (PRD 10.1). All minute values come from the config store.
 *
 * Departure pickup = flight departure - airport buffer - travel time - safety margin,
 * with an extra margin for early-morning pickups.
 * Arrival: the driver should be at the meeting point by the estimated landing time.
 */
export interface DepartureTimingInput {
  departure: Date;
  travelMinutes: number;
  airportBufferMinutes: number;
  safetyMarginMinutes: number;
  earlyMorningExtraMarginMinutes: number;
  earlyMorningBeforeHour: number;
  /** Offset of local time from UTC in minutes. Lagos is +60 with no DST. */
  utcOffsetMinutes: number;
}

const minutes = (n: number) => n * 60_000;

export function departurePickupTime(i: DepartureTimingInput): Date {
  const base =
    i.departure.getTime() -
    minutes(i.airportBufferMinutes) -
    minutes(i.travelMinutes) -
    minutes(i.safetyMarginMinutes);
  const localHour = new Date(base + minutes(i.utcOffsetMinutes)).getUTCHours();
  const extra =
    localHour < i.earlyMorningBeforeHour ? minutes(i.earlyMorningExtraMarginMinutes) : 0;
  return new Date(base - extra);
}

export function arrivalReadyTime(estimatedLanding: Date): Date {
  return new Date(estimatedLanding);
}

export const LAGOS_UTC_OFFSET_MINUTES = 60;
