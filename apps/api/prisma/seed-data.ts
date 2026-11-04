/**
 * Seed data. Every number the PRD marks as an assumption starts here and lives in the
 * database afterwards (ConfigEntry, PricingRule), where ops tunes it without a release.
 * FARES ARE PLACEHOLDERS (PRD 12.1) and must not be loaded into production as real prices.
 */

export const configDefaults: { key: string; value: unknown; description: string }[] = [
  { key: 'dispatch.airportBufferMinutes.domestic', value: 90, description: 'Arrive at the domestic terminal this long before departure (10.1)' },
  { key: 'dispatch.airportBufferMinutes.international', value: 150, description: 'International buffer (11.4 example)' },
  { key: 'dispatch.safetyMarginMinutes', value: 15, description: 'Safety margin on departure pickups (10.1)' },
  { key: 'dispatch.earlyMorningExtraMarginMinutes', value: 15, description: 'Extra margin for early pickups (10.1)' },
  { key: 'dispatch.earlyMorningBeforeHour', value: 6, description: 'Pickups before this local hour are early and get a standby driver (10.2)' },
  { key: 'dispatch.nightBeforePlanHour', value: 18, description: 'Night-before plan runs at this local hour (10.2)' },
  { key: 'dispatch.driverConfirmCutoffHour', value: 21, description: 'Drivers confirm next-day jobs by this hour (10.2)' },
  { key: 'dispatch.arrivalOfferLeadMinutes', value: 90, description: 'Arrival offers start this long before landing, 60 to 90 (10.3)' },
  { key: 'dispatch.offerTimeoutSeconds', value: 60, description: 'Arrival offer timeout per driver (10.3)' },
  { key: 'dispatch.unassignedAlertMinutesBeforeLanding', value: 30, description: '10.7' },
  { key: 'dispatch.driverNotMovingAlertMinutes', value: 30, description: '10.7' },
  { key: 'flights.timeShiftThresholdMinutes', value: 15, description: 'Emit TimeShifted past this change (9.3)' },
  { key: 'flights.pollIntervals', value: { moreThan24h: 1440, from24hTo6h: 180, last6h: 30, inFlight: 15 }, description: 'Backup polling in minutes (9.3)' },
  { key: 'traveller.trackingLinkHoursAfterLastLeg', value: 24, description: 'Tracking link lifetime after the last leg (5.1)' },
  { key: 'traveller.changeCode', value: { digits: 6, ttlMinutes: 5, maxAttempts: 5, resendCooldownSeconds: 60 }, description: 'ACC-02' },
  { key: 'dispatch.pickupCodeMaxAttempts', value: 5, description: 'Wrong pickup code attempts per leg before it locks and the driver calls support (DSP-08)' },
  { key: 'drivers.inviteExpiryHours', value: 72, description: 'ACC-05' },
  { key: 'intake.quoteTolerancePercent', value: 5, description: 'Accept a paid booking within this price difference of its quote (8.5)' },
  { key: 'pricing.estimatedDriverPayBps', value: 5500, description: 'Placeholder cost model until M2: driver and car cost as a share of fare' },
  { key: 'pricing.marginFloorBps', value: 1500, description: 'Margin floor (12.5). Target 20 to 30% (1.6)' },
  { key: 'pricing.disruptionReserveBps', value: 650, description: '5 to 8% disruption reserve assumption (12.3)' },
  { key: 'waiting.arrivalFreeMinutes', value: { STANDARD: 45, FLEX: 75 }, description: 'Free waiting after actual landing (12.3)' },
  { key: 'shared.limits', value: { maxTravellers: 3, maxPassengers: 3, bagsPerPassenger: { large: 1, small: 1 }, vehicleClass: 'SUV' }, description: '11.1' },
  { key: 'shared.checks', value: { departureWindowMinutes: 90, arrivalNearbyFlightsMinutes: 30, arrivalNearbyFlightsEnabled: false, maxExtraMinutes: 20, maxExtraPercent: 35, maxEarlyAtAirportMinutes: 60 }, description: '11.2' },
  { key: 'shared.stopMinutes', value: 3, description: '11.4' },
  { key: 'shared.homeFreeWaitMinutes', value: 5, description: '11.4, 11.7' },
  { key: 'shared.homeDriverMayLeaveMinutes', value: 10, description: '11.7' },
  { key: 'shared.arrivalFreeWaitMinutes', value: 30, description: '11.7' },
  { key: 'shared.noMatchRule', value: 'PRIVATE_AT_SHARED_PRICE', description: 'Proposed in 11.6, open question 14' },
  { key: 'refunds.opsAgentLimitKobo', value: 5_000_000, description: 'Ops refund limit before a super admin is needed (14.5)' },
];

export const airport = { iata: 'LOS', name: 'Murtala Muhammed International Airport', terminal: 'Domestic', lat: 6.5774, lng: 3.3212 };

export const pickupPoints = [
  { type: 'DEPARTURE_DROPOFF', name: 'Domestic departures kerb', lat: 6.5772, lng: 3.3215, directions: 'Confirm with FAAN before launch (3.4)' },
  { type: 'ARRIVAL_PICKUP', name: 'Domestic arrivals car park', lat: 6.5768, lng: 3.3221, directions: 'Placeholder until FAAN confirms zones (3.4)' },
] as const;

/** Lagos corridors from PRD 11.3, farthest area first. Coordinates are approximate area centres. */
export const corridors: { name: string; areas: { code: string; name: string; lat: number; lng: number }[] }[] = [
  {
    name: 'Island east',
    areas: [
      { code: 'SANGOTEDO', name: 'Sangotedo', lat: 6.47, lng: 3.629 },
      { code: 'AJAH', name: 'Ajah', lat: 6.4682, lng: 3.5852 },
      { code: 'ABRAHAM_ADESANYA', name: 'Abraham Adesanya', lat: 6.466, lng: 3.561 },
      { code: 'CHEVRON', name: 'Chevron', lat: 6.437, lng: 3.532 },
      { code: 'IKOTA', name: 'Ikota', lat: 6.445, lng: 3.548 },
      { code: 'LEKKI_PHASE_1', name: 'Lekki Phase 1', lat: 6.4474, lng: 3.4723 },
      { code: 'ONIRU', name: 'Oniru', lat: 6.437, lng: 3.45 },
      { code: 'VICTORIA_ISLAND', name: 'Victoria Island', lat: 6.4281, lng: 3.4219 },
      { code: 'IKOYI', name: 'Ikoyi', lat: 6.45, lng: 3.435 },
    ],
  },
  {
    name: 'Mainland south',
    areas: [
      { code: 'FESTAC', name: 'Festac', lat: 6.4667, lng: 3.2833 },
      { code: 'SURULERE', name: 'Surulere', lat: 6.5, lng: 3.35 },
      { code: 'YABA', name: 'Yaba', lat: 6.5095, lng: 3.3711 },
      { code: 'EBUTE_METTA', name: 'Ebute Metta', lat: 6.488, lng: 3.38 },
    ],
  },
  {
    name: 'Mainland north',
    areas: [
      { code: 'IKORODU', name: 'Ikorodu', lat: 6.6194, lng: 3.5105 },
      { code: 'KETU', name: 'Ketu', lat: 6.596, lng: 3.388 },
      { code: 'OJOTA', name: 'Ojota', lat: 6.585, lng: 3.38 },
      { code: 'MARYLAND', name: 'Maryland', lat: 6.573, lng: 3.367 },
      { code: 'OGBA', name: 'Ogba', lat: 6.625, lng: 3.342 },
      { code: 'MAGODO', name: 'Magodo', lat: 6.62, lng: 3.38 },
    ],
  },
  {
    name: 'Mainland west',
    areas: [
      { code: 'ALIMOSHO', name: 'Alimosho', lat: 6.59, lng: 3.26 },
      { code: 'EGBEDA', name: 'Egbeda', lat: 6.592, lng: 3.29 },
      { code: 'IKOTUN', name: 'Ikotun', lat: 6.55, lng: 3.27 },
      { code: 'ISOLO', name: 'Isolo', lat: 6.53, lng: 3.32 },
    ],
  },
];

const drivers: [string, string][] = [
  ['Chinedu', 'Okafor'],
  ['Babajide', 'Adeyemi'],
  ['Ibrahim', 'Musa'],
  ['Emeka', 'Nwosu'],
  ['Tunde', 'Bakare'],
  ['Segun', 'Ogunleye'],
  ['Yusuf', 'Bello'],
  ['Kelechi', 'Eze'],
  ['Femi', 'Adebayo'],
  ['Musa', 'Abdullahi'],
];

const fleet = [
  { brand: 'BYD', model: 'Qin Plus', class: 'SEDAN', seats: 4, bags: 3, power: 'ELECTRIC', colour: 'White' },
  { brand: 'Chery', model: 'Tiggo 7 Pro', class: 'SUV', seats: 4, bags: 5, power: 'PETROL', colour: 'Grey' },
  { brand: 'GAC', model: 'GS4', class: 'SUV', seats: 4, bags: 5, power: 'PETROL', colour: 'Black' },
  { brand: 'Geely', model: 'Emgrand', class: 'SEDAN', seats: 4, bags: 3, power: 'PETROL', colour: 'Silver' },
  { brand: 'Changan', model: 'CS55 Plus', class: 'SUV', seats: 4, bags: 5, power: 'PETROL', colour: 'White' },
] as const;

export const driverSeeds = drivers.map(([firstName, lastName], i) => {
  const v = fleet[i % fleet.length]!;
  return {
    firstName,
    lastName,
    phone: `+23480000000${String(i).padStart(2, '0')}`,
    vehicle: { ...v, plate: `LSD-${100 + i}-AW` },
  };
});

/** Placeholder fare: base plus a per-km rate from the airport, in kobo, rounded to N500. */
export function placeholderFareKobo(km: number, vehicleClass: 'SEDAN' | 'SUV' | 'VAN'): number {
  const naira = (8_000 + km * 900) * { SEDAN: 1, SUV: 1.35, VAN: 1.8 }[vehicleClass];
  return Math.round(naira / 500) * 500 * 100;
}
