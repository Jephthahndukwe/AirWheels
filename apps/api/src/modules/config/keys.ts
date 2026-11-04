/**
 * Names of config keys. Only the names live in code; values live in ConfigEntry
 * (seeded from prisma/seed-data/config.ts, edited by ops).
 */
export const CONFIG = {
  airportBufferDomesticMin: 'dispatch.airportBufferMinutes.domestic',
  safetyMarginMin: 'dispatch.safetyMarginMinutes',
  earlyMorningMarginMin: 'dispatch.earlyMorningExtraMarginMinutes',
  earlyMorningBeforeHour: 'dispatch.earlyMorningBeforeHour',
  quoteTolerancePct: 'intake.quoteTolerancePercent',
  trackingLinkHoursAfterLastLeg: 'traveller.trackingLinkHoursAfterLastLeg',
  driverPayShareBps: 'pricing.estimatedDriverPayBps',
  marginFloorBps: 'pricing.marginFloorBps',
  pickupCodeMaxAttempts: 'dispatch.pickupCodeMaxAttempts',
} as const;
