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
  { key: 'drivers.requiredDocuments', value: ['LICENCE', 'ID'], description: 'Documents ops must upload before inviting a driver (5.2)' },
  { key: 'drivers.trainingChecklist', value: ['airportRules', 'pickupCodes', 'customerCare', 'safety'], description: 'Training items ops ticks before the invite (5.2 step 4)' },
  { key: 'auth.adminIdleTimeoutMinutes', value: 30, description: 'Admin sessions end after this much inactivity (5.4)' },
  { key: 'auth.adminSessionMaxHours', value: 12, description: 'Admin sessions end this long after sign-in, active or not' },
  { key: 'auth.adminLockout', value: { maxFailures: 5, lockMinutes: 15 }, description: 'Admin account lock after repeated failed sign-ins (ACC-07)' },
  { key: 'auth.adminInviteExpiryHours', value: 72, description: 'Staff invite links expire after this (5.4)' },
  { key: 'auth.driverSessionDays', value: 30, description: 'Driver app sessions last this long on the bound device' },
  { key: 'auth.driverPinLockout', value: { maxFailures: 5, lockMinutes: 15 }, description: 'Driver PIN lock after repeated wrong PINs (ACC-06)' },
  { key: 'auth.otp', value: { digits: 6, ttlMinutes: 5, maxAttempts: 5 }, description: 'SMS one-time codes for driver activation and new devices' },
  { key: 'airlines.credentialRotationGraceHours', value: 24, description: 'After a key rotation the old airline key keeps working this long (ACC-08)' },
  {
    key: 'rateLimits',
    value: {
      adminLogin: { limit: 10, windowSeconds: 300 },
      adminInvite: { limit: 20, windowSeconds: 300 },
      driverActivate: { limit: 10, windowSeconds: 600 },
      driverLogin: { limit: 10, windowSeconds: 300 },
      otpVerify: { limit: 10, windowSeconds: 300 },
      pickupCode: { limit: 30, windowSeconds: 300 },
      partner: { limit: 600, windowSeconds: 60 },
      publicQuotes: { limit: 60, windowSeconds: 60 },
      trackingPage: { limit: 120, windowSeconds: 60 },
      places: { limit: 120, windowSeconds: 60 },
      bookings: { limit: 20, windowSeconds: 300 },
      payments: { limit: 30, windowSeconds: 300 },
      webhooks: { limit: 600, windowSeconds: 60 },
    },
    description: 'Requests per window per caller (IP, or airline key for partner endpoints) (ACC-09)',
  },
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
  { key: 'refunds.opsAgentLimitKobo', value: 5_000_000, description: 'Ops refund limit before a super admin is needed (14.5, PAY-08)' },
  { key: 'pricing.ownChannelQuoteExpiryMinutes', value: 30, description: 'How long a quote on our own page, the post-booking link or ops entry is held (12.2)' },
  { key: 'payments.pendingCheckAfterMinutes', value: 10, description: 'Reconciliation asks Paystack about payments still pending after this long (8.5, 14.2)' },
  { key: 'payments.abandonAfterHours', value: 24, description: 'A payment still pending at Paystack after this long is treated as abandoned' },
  { key: 'payments.reconciliationHourLagos', value: 2, description: 'Hour (Lagos time) the daily Paystack reconciliation runs (PAY-06)' },
  { key: 'bookings.stuckAfterMinutes', value: 60, description: 'A booking in one state, or with a step not done, for longer than this shows as stuck (8.6)' },
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

/**
 * Starting pricing rules of every type (PRD 12.6). PLACEHOLDERS: the fares, fees and costs are
 * rough Lagos guesses for local runs and must be replaced in the admin before real bookings.
 */
export function pricingRuleSeeds(airlineCode: string): { type: 'FEE' | 'SURCHARGE' | 'VEHICLE_CLASS' | 'PLAN' | 'SHARED_SHARE' | 'DISCOUNT' | 'TAX' | 'ROUNDING' | 'COST_MODEL' | 'MARGIN_FLOOR' | 'REVENUE_SHARE'; key: string; values: object }[] {
  return [
    { type: 'FEE', key: 'airport', values: { kobo: 50_000 } },
    { type: 'FEE', key: 'childSeat', values: { kobo: 150_000 } },
    { type: 'FEE', key: 'extraStop', values: { kobo: 200_000 } },
    { type: 'SURCHARGE', key: 'night', values: { label: 'Night pickup', kind: 'TIME_OF_DAY', startHour: 22, endHour: 5, bps: 1_500 } },
    { type: 'SURCHARGE', key: 'veryEarly', values: { label: 'Very early pickup', kind: 'TIME_OF_DAY', startHour: 3, endHour: 5, bps: 1_000 } },
    { type: 'SURCHARGE', key: 'festive', values: { label: 'Festive season', kind: 'DATE_RANGE', from: '2026-12-20', to: '2027-01-05', bps: 1_000 } },
    { type: 'VEHICLE_CLASS', key: 'SEDAN', values: { maxPassengers: 3, maxBags: 3, includedBags: 2, extraBagKobo: 100_000 } },
    { type: 'VEHICLE_CLASS', key: 'SUV', values: { maxPassengers: 4, maxBags: 5, includedBags: 4, extraBagKobo: 100_000 } },
    { type: 'VEHICLE_CLASS', key: 'VAN', values: { maxPassengers: 7, maxBags: 9, includedBags: 7, extraBagKobo: 100_000 } },
    { type: 'PLAN', key: 'STANDARD', values: { multiplierBps: 10_000 } },
    { type: 'PLAN', key: 'FLEX', values: { multiplierBps: 11_500 } },
    { type: 'SHARED_SHARE', key: 'default', values: { bps: 6_000 } },
    { type: 'DISCOUNT', key: 'bothLegs', values: { bps: 500 } },
    { type: 'DISCOUNT', key: 'stacking', values: { maxTotalBps: 2_500, promoWithCorporate: false } },
    { type: 'DISCOUNT', key: 'promo:WELCOME10', values: { bps: 1_000, validTo: '2027-06-30' } },
    { type: 'TAX', key: 'vat', values: { name: 'VAT', bps: 0, onAirportFee: false } },
    { type: 'ROUNDING', key: 'default', values: { toKobo: 10_000, mode: 'nearest' } },
    {
      type: 'COST_MODEL',
      key: 'default',
      values: {
        driverBaseKobo: 300_000,
        driverPerKmKobo: 15_000,
        carPartnerPerKmKobo: 8_000,
        energyPerKmKobo: 6_000,
        insurancePerLegKobo: 20_000,
        messagingPerLegKobo: 10_000,
        paymentFeeBps: 150,
        paymentFeeFlatKobo: 10_000,
        paymentFeeCapKobo: 200_000,
        emptyReturnBps: 3_000,
        disruptionReserveBps: { STANDARD: 0, FLEX: 650 },
        sharedCostShareBps: 5_000,
        roadFactorBps: 13_000,
      },
    },
    { type: 'MARGIN_FLOOR', key: 'default', values: { bps: 1_500 } },
    { type: 'REVENUE_SHARE', key: airlineCode, values: { bps: 1_000 } },
  ];
}
