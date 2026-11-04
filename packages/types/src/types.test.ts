import { describe, expect, it } from 'vitest';
import { PartnerBookingRequest, formatNaira, nairaToKobo } from './index';
import { signPartnerRequest, verifyPartnerSignature } from './signing';

describe('money', () => {
  it('converts naira to integer kobo', () => {
    expect(nairaToKobo(15000.5)).toBe(1500050);
  });
  it('formats kobo as naira', () => {
    expect(formatNaira(1500000)).toContain('15,000');
  });
});

describe('partner signing', () => {
  it('verifies a valid signature and rejects tampering', () => {
    const ts = String(Date.now());
    const sig = signPartnerRequest('s3cret', ts, 'POST', '/v1/partner/bookings', '{"a":1}');
    expect(verifyPartnerSignature('s3cret', ts, 'POST', '/v1/partner/bookings', '{"a":1}', sig)).toBe(true);
    expect(verifyPartnerSignature('s3cret', ts, 'POST', '/v1/partner/bookings', '{"a":2}', sig)).toBe(false);
  });
  it('rejects stale timestamps', () => {
    const ts = String(Date.now() - 10 * 60_000);
    const sig = signPartnerRequest('k', ts, 'POST', '/p', '');
    expect(verifyPartnerSignature('k', ts, 'POST', '/p', '', sig)).toBe(false);
  });
});

describe('PartnerBookingRequest', () => {
  it('rejects a non-E.164 phone', () => {
    const r = PartnerBookingRequest.safeParse({ traveller: { name: 'Ada', phone: '0801' } });
    expect(r.success).toBe(false);
  });
});
