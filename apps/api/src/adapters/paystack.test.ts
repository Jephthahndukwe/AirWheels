import { createHmac } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { redactWebhook, webhookIdentity } from '../modules/payments/payments.service';
import { FAKE_PAYSTACK_SECRET, FakePayments } from './fakes';
import { PaystackError, PaystackPayments, paystackSignatureValid } from './paystack';

const SECRET = 'sk_test_unit_only_not_a_real_key';

function mockFetch(handler: (url: string, init: RequestInit) => { status?: number; body: unknown }) {
  return vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const r = handler(String(url), init ?? {});
    return new Response(JSON.stringify(r.body), { status: r.status ?? 200, headers: { 'content-type': 'application/json' } });
  }) as unknown as typeof fetch;
}

describe('Paystack adapter (test mode)', () => {
  it('refuses to start without a Paystack secret key', () => {
    expect(() => new PaystackPayments('')).toThrow(/PAYSTACK_SECRET_KEY/);
    expect(() => new PaystackPayments('pk_test_public_key')).toThrow();
  });

  it('initialises a transaction in kobo, NGN, with the secret only in the Authorization header', async () => {
    const f = mockFetch((url, init) => {
      expect(url).toBe('https://api.paystack.co/transaction/initialize');
      expect(init.method).toBe('POST');
      expect((init.headers as Record<string, string>).authorization).toBe(`Bearer ${SECRET}`);
      const body = JSON.parse(String(init.body));
      expect(body).toEqual({ reference: 'AW-1', amount: 2_250_000, currency: 'NGN', email: 'a@b.ng', callback_url: 'https://x/cb', metadata: { bookingId: 'b1' } });
      return { body: { status: true, data: { authorization_url: 'https://checkout.paystack.com/abc', reference: 'AW-1' } } };
    });
    const p = new PaystackPayments(SECRET, f);
    expect(await p.initialize({ reference: 'AW-1', amountKobo: 2_250_000, email: 'a@b.ng', callbackUrl: 'https://x/cb', metadata: { bookingId: 'b1' } })).toEqual({
      authorizationUrl: 'https://checkout.paystack.com/abc',
      reference: 'AW-1',
    });
  });

  it('verify maps the status and keeps only amounts, never card or customer details', async () => {
    const f = mockFetch(() => ({
      body: {
        status: true,
        data: {
          reference: 'AW-1',
          status: 'success',
          amount: 2_250_000,
          currency: 'NGN',
          fees: 43_750,
          paid_at: '2026-11-06T10:00:00.000Z',
          authorization: { last4: '4081', bin: '408408', card_type: 'visa' },
          customer: { email: 'traveller@example.com', phone: '+2348012345678' },
        },
      },
    }));
    const t = await new PaystackPayments(SECRET, f).verify('AW-1');
    expect(t).toEqual({ reference: 'AW-1', status: 'success', amountKobo: 2_250_000, currency: 'NGN', feesKobo: 43_750, paidAt: '2026-11-06T10:00:00.000Z' });
    expect(JSON.stringify(t)).not.toMatch(/4081|408408|traveller@|2348012345678/);
  });

  it('maps every in-between Paystack status to pending, and a missing transaction to null', async () => {
    for (const s of ['ongoing', 'pending', 'processing', 'queued']) {
      const f = mockFetch(() => ({ body: { status: true, data: { reference: 'R', status: s, amount: 1, currency: 'NGN' } } }));
      expect((await new PaystackPayments(SECRET, f).verify('R'))!.status).toBe('pending');
    }
    const missing = mockFetch(() => ({ status: 404, body: { status: false, message: 'Transaction reference not found' } }));
    expect(await new PaystackPayments(SECRET, missing).verify('R')).toBeNull();
    const down = mockFetch(() => ({ status: 500, body: { status: false, message: 'Server error' } }));
    await expect(new PaystackPayments(SECRET, down).verify('R')).rejects.toBeInstanceOf(PaystackError);
  });

  it('checks webhook signatures: HMAC-SHA512 of the raw body with the secret key', () => {
    const raw = Buffer.from('{"event":"charge.success","data":{"reference":"AW-1"}}');
    const good = createHmac('sha512', SECRET).update(raw).digest('hex');
    expect(paystackSignatureValid(SECRET, raw, good)).toBe(true);
    expect(paystackSignatureValid(SECRET, Buffer.from(raw.toString().replace('AW-1', 'AW-2')), good)).toBe(false);
    expect(paystackSignatureValid(SECRET, raw, 'deadbeef')).toBe(false);
    expect(paystackSignatureValid(SECRET, raw, '')).toBe(false);
    expect(paystackSignatureValid('sk_test_other_key', raw, good)).toBe(false);
  });

  it('refunds and lists transactions with paging', async () => {
    const f = mockFetch((url) => {
      if (url.endsWith('/refund')) return { body: { status: true, data: { id: 9, status: 'pending' } } };
      const page = Number(new URL(url).searchParams.get('page'));
      const rows = Array.from({ length: page === 1 ? 100 : 3 }, (_, i) => ({ reference: `R${page}-${i}`, status: 'success', amount: 100, currency: 'NGN' }));
      return { body: { status: true, data: rows } };
    });
    const p = new PaystackPayments(SECRET, f);
    expect(await p.refund('AW-1', 500)).toEqual({ refundId: '9', status: 'pending' });
    expect((await p.listTransactions(new Date('2026-11-05'), new Date('2026-11-06'))).length).toBe(103);
  });
});

describe('webhook handling helpers (PAY-02)', () => {
  it('identifies an event by event, reference and status, so repeats dedupe', () => {
    const a = webhookIdentity({ event: 'charge.success', data: { reference: 'AW-1', status: 'success' } });
    const b = webhookIdentity({ event: 'charge.success', data: { reference: 'AW-1', status: 'success', amount: 5 } });
    const c = webhookIdentity({ event: 'charge.failed', data: { reference: 'AW-1', status: 'failed' } });
    expect(a.key).toBe(b.key);
    expect(a.key).not.toBe(c.key);
    expect(webhookIdentity({ event: 'refund.processed', data: { id: 77, transaction_reference: 'AW-1', status: 'processed' } }).refundId).toBe('77');
  });

  it('stores webhooks without card, bank or customer details', () => {
    const stored = JSON.stringify(
      redactWebhook({
        event: 'charge.success',
        data: { reference: 'AW-1', status: 'success', amount: 100, authorization: { last4: '4081' }, customer: { email: 'x@y.z' }, metadata: { phone: '+234801' } },
      }),
    );
    expect(stored).toMatch(/AW-1/);
    expect(stored).not.toMatch(/4081|x@y\.z|\+234801/);
  });

  it('the fake signs webhooks exactly like Paystack, so the real check runs in local runs and CI', async () => {
    FakePayments.reset();
    const fake = new FakePayments();
    await fake.initialize({ reference: 'AW-F', amountKobo: 1_000_000, callbackUrl: 'http://x' });
    const hook = fake.complete('AW-F', 'success')!;
    expect(paystackSignatureValid(FAKE_PAYSTACK_SECRET, hook.rawBody, hook.signature)).toBe(true);
    expect(fake.verifyWebhookSignature(hook.rawBody, hook.signature)).toBe(true);
    expect((await fake.verify('AW-F'))!.status).toBe('success');
    // A later "failed" click cannot undo a success.
    fake.complete('AW-F', 'failed');
    expect((await fake.verify('AW-F'))!.status).toBe('success');
  });
});
