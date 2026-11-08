import { describe, expect, it } from 'vitest';
import {
  EVENTS,
  areaOf,
  buttonPayload,
  checkTemplate,
  firstNameOf,
  insideWindow,
  matchTypedIntent,
  parseButtonPayload,
  preview,
  render,
  smsNumberReply,
  smsReplyHint,
} from './catalog';

const PRD_7_1 = [
  'booking.confirmed',
  'pickup_time.set',
  'pickup_time.changed',
  'driver.assigned',
  'driver.en_route',
  'driver.arrived',
  'trip.completed',
  'arrival.confirmed',
  'arrival.driver_assigned',
  'flight.landed',
  'flight.changed',
  'driver.replaced',
  'shared.confirmed',
  'shared.locked',
  'shared.no_match',
  'shared.group_changed',
];

describe('message catalogue (PRD 7.1, 7.3)', () => {
  it('covers every message in PRD 7.1, including shared rides', () => {
    const names = EVENTS.map((e) => e.event);
    for (const e of PRD_7_1) expect(names).toContain(e);
  });

  it('every default template passes the privacy check', () => {
    for (const e of EVENTS) {
      expect(checkTemplate(e.event, e.body), e.event).toEqual([]);
      if (e.sms) expect(checkTemplate(e.event, e.sms), e.event).toEqual([]);
    }
  });

  it('has the PRD 7.3 buttons, each short enough for WhatsApp', () => {
    const by = new Map(EVENTS.map((e) => [e.event, e.buttons?.map((b) => b.intent) ?? []]));
    expect(by.get('driver.assigned')).toEqual(['CONFIRM', 'CHANGE_TIME', 'CANCEL']);
    expect(by.get('driver.arrived')).toEqual(['COMING_OUT', 'FIVE_MINUTES', 'CALL_DRIVER']);
    expect(by.get('arrival.confirmed')).toEqual(['LANDED']);
    expect(by.get('arrival.driver_assigned')).toEqual([
      'GETTING_BAGS',
      'AT_MEETING_POINT',
      'CALL_DRIVER',
    ]);
    expect(by.get('trip.completed')).toEqual(['RATE_5', 'REPORT_PROBLEM']);
    for (const e of EVENTS)
      for (const b of e.buttons ?? []) expect(b.title.length).toBeLessThanOrEqual(20);
  });

  it('refuses full names, full addresses and unknown variables', () => {
    expect(checkTemplate('booking.confirmed', 'Hi {{fullName}}')).toHaveLength(1);
    expect(checkTemplate('booking.confirmed', 'From {{pickupAddress}}')).toHaveLength(1);
    expect(checkTemplate('booking.confirmed', 'From {{pickupArea}}')).toEqual([]);
  });

  it('allows a pickup code only in the owner traveller’s messages, and the change code only in its own', () => {
    expect(checkTemplate('driver.en_route', 'code {{pickupCode}}')).toHaveLength(1);
    expect(checkTemplate('flight.landed', 'code {{pickupCode}}')).toHaveLength(1);
    expect(checkTemplate('driver.arrived', 'code {{pickupCode}}')).toEqual([]);
    expect(checkTemplate('booking.confirmed', '{{changeCode}}')).toHaveLength(1);
    expect(checkTemplate('change.code', '{{changeCode}}')).toEqual([]);
  });

  it('renders, and masks secrets in the stored preview', () => {
    const vars = { serviceName: 'Air Test Transfers', pickupCode: '4821', trackingUrl: 'u' };
    const body = '{{serviceName}}: code {{pickupCode}}. {{trackingUrl}}';
    expect(render(body, vars)).toBe('Air Test Transfers: code 4821. u');
    expect(preview(body, vars)).toBe('Air Test Transfers: code ••••. u');
    expect(preview(body, vars)).not.toContain('4821');
  });

  it('builds SMS reply hints and reads number replies', () => {
    expect(smsReplyHint([{ intent: 'COMING_OUT', title: "I'm coming out" }])).toBe(
      "Reply 1 for I'm coming out.",
    );
    expect(smsNumberReply(' 2 ')).toBe(2);
    expect(smsNumberReply('2.')).toBe(2);
    expect(smsNumberReply('12')).toBeNull();
    expect(smsNumberReply('two')).toBeNull();
  });

  it('matches simple typed intents and leaves anything else for ops', () => {
    expect(matchTypedIntent('I have landed')).toBe('LANDED');
    expect(matchTypedIntent('coming')).toBe('COMING_OUT');
    expect(matchTypedIntent('give me 5 min')).toBe('FIVE_MINUTES');
    expect(matchTypedIntent('getting my bags')).toBe('GETTING_BAGS');
    expect(matchTypedIntent('Can you bring water please')).toBeNull();
  });

  it('round-trips button payloads and rejects junk', () => {
    const id = '11111111-2222-3333-4444-555555555555';
    expect(parseButtonPayload(buttonPayload('RATE_5', id))).toEqual({
      intent: 'RATE_5',
      notificationId: id,
    });
    expect(parseButtonPayload('DROP_TABLE|x')).toBeNull();
  });

  it('keeps only areas and first names', () => {
    expect(areaOf('12 Admiralty Way, Lekki Phase 1, Lagos')).toBe('Lekki Phase 1');
    expect(areaOf('Victoria Island, Lagos')).toBe('Victoria Island');
    expect(firstNameOf('Ada  Obi-Eze')).toBe('Ada');
  });

  it('applies the 24-hour window', () => {
    const now = new Date('2026-11-08T12:00:00Z');
    expect(insideWindow(new Date('2026-11-07T12:00:01Z'), now)).toBe(true);
    expect(insideWindow(new Date('2026-11-07T11:59:59Z'), now)).toBe(false);
    expect(insideWindow(null, now)).toBe(false);
  });
});
