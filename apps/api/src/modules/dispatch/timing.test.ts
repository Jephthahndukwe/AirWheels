import { describe, expect, it } from 'vitest';
import { departurePickupTime } from './timing';

const cfg = {
  airportBufferMinutes: 90,
  safetyMarginMinutes: 15,
  earlyMorningExtraMarginMinutes: 15,
  earlyMorningBeforeHour: 6,
  utcOffsetMinutes: 60,
};

describe('departurePickupTime', () => {
  it('works back from departure through buffer, travel and margin', () => {
    // 12:00 Lagos = 11:00Z. 12:00 - 90 - 45 - 15 = 09:30 Lagos = 08:30Z
    const t = departurePickupTime({ ...cfg, departure: new Date('2026-11-10T11:00:00Z'), travelMinutes: 45 });
    expect(t.toISOString()).toBe('2026-11-10T08:30:00.000Z');
  });

  it('adds the early-morning margin before 6am local', () => {
    // 07:00 Lagos = 06:00Z. Base pickup 04:30 Lagos -> extra 15 -> 04:15 Lagos = 03:15Z
    const t = departurePickupTime({ ...cfg, departure: new Date('2026-11-10T06:00:00Z'), travelMinutes: 45 });
    expect(t.toISOString()).toBe('2026-11-10T03:15:00.000Z');
  });
});
