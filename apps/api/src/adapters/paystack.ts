import { Logger } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { GatewayStatus, GatewayTransaction, PaymentsAdapter } from './interfaces';

/**
 * Live Paystack adapter (PAY-01). Works in test mode with an `sk_test_...` key and in live mode
 * with `sk_live_...`. The key comes only from the environment (PAYSTACK_SECRET_KEY) and is never
 * logged. Card and payer details in responses are dropped before anything is returned or stored.
 *
 * API: https://paystack.com/docs/api/ (amounts are in kobo for NGN).
 */
const BASE = 'https://api.paystack.co';

export class PaystackError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
  }
}

const mapStatus = (s: string): GatewayStatus => {
  switch (s) {
    case 'success':
      return 'success';
    case 'failed':
      return 'failed';
    case 'abandoned':
      return 'abandoned';
    case 'reversed':
      return 'reversed';
    default:
      return 'pending'; // ongoing, pending, processing, queued
  }
};

interface PaystackTransaction {
  reference: string;
  status: string;
  amount: number;
  currency: string;
  fees?: number | null;
  paid_at?: string | null;
}

const toGateway = (t: PaystackTransaction): GatewayTransaction => ({
  reference: t.reference,
  status: mapStatus(t.status),
  amountKobo: t.amount,
  currency: t.currency,
  feesKobo: t.fees ?? 0,
  paidAt: t.paid_at ?? undefined,
});

/** Paystack signs webhooks with HMAC-SHA512 of the raw body, keyed with the secret key. */
export function paystackSignatureValid(
  secret: string,
  rawBody: Buffer,
  signature: string,
): boolean {
  if (!secret || !signature) return false;
  const expected = Buffer.from(createHmac('sha512', secret).update(rawBody).digest('hex'));
  const given = Buffer.from(signature);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

export class PaystackPayments implements PaymentsAdapter {
  readonly mode = 'live' as const;
  private readonly log = new Logger('Paystack');

  constructor(
    private readonly secret: string = process.env.PAYSTACK_SECRET_KEY ?? '',
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    if (!/^sk_(test|live)_/.test(this.secret))
      throw new Error(
        'PAYSTACK_SECRET_KEY must be a Paystack secret key (sk_test_... or sk_live_...).',
      );
  }

  private async call<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    const res = await this.fetchImpl(`${BASE}${path}`, {
      method,
      headers: { authorization: `Bearer ${this.secret}`, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
    const json = (await res.json().catch(() => ({}))) as {
      status?: boolean;
      message?: string;
      data?: T;
    };
    if (!res.ok || json.status === false) {
      // Only Paystack's message: never request bodies, which can carry customer details.
      this.log.warn({ path: path.split('?')[0], status: res.status }, 'Paystack call failed');
      throw new PaystackError(json.message ?? `Paystack returned ${res.status}`, res.status);
    }
    return json.data as T;
  }

  async initialize(input: {
    reference: string;
    amountKobo: number;
    email: string;
    callbackUrl: string;
    metadata?: Record<string, string>;
  }) {
    const data = await this.call<{ authorization_url: string; reference: string }>(
      'POST',
      '/transaction/initialize',
      {
        reference: input.reference,
        amount: input.amountKobo,
        currency: 'NGN',
        email: input.email,
        callback_url: input.callbackUrl,
        metadata: input.metadata,
      },
    );
    return { authorizationUrl: data.authorization_url, reference: data.reference };
  }

  async verify(reference: string) {
    try {
      return toGateway(
        await this.call<PaystackTransaction>(
          'GET',
          `/transaction/verify/${encodeURIComponent(reference)}`,
        ),
      );
    } catch (e) {
      if (e instanceof PaystackError && e.status === 404) return null;
      throw e;
    }
  }

  verifyWebhookSignature(rawBody: Buffer, signature: string) {
    return paystackSignatureValid(this.secret, rawBody, signature);
  }

  async refund(reference: string, amountKobo: number) {
    const data = await this.call<{ id: number; status: string }>('POST', '/refund', {
      transaction: reference,
      amount: amountKobo,
    });
    return {
      refundId: String(data.id),
      status: data.status === 'processed' ? ('processed' as const) : ('pending' as const),
    };
  }

  async transfer(input: { recipientCode: string; amountKobo: number; reference: string }) {
    const data = await this.call<{ transfer_code: string }>('POST', '/transfer', {
      source: 'balance',
      amount: input.amountKobo,
      recipient: input.recipientCode,
      reference: input.reference,
    });
    return { transferId: data.transfer_code };
  }

  async listTransactions(from: Date, to: Date) {
    const out: GatewayTransaction[] = [];
    for (let page = 1; page <= 50; page++) {
      const q = new URLSearchParams({
        from: from.toISOString(),
        to: to.toISOString(),
        perPage: '100',
        page: String(page),
      });
      const rows = await this.call<PaystackTransaction[]>('GET', `/transaction?${q.toString()}`);
      out.push(...rows.map(toGateway));
      if (rows.length < 100) break;
    }
    return out;
  }
}
