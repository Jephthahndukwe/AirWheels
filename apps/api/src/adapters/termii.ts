import { createHmac, timingSafeEqual } from 'node:crypto';
import type {
  DeliveryState,
  InboundMessage,
  SendResult,
  SmsAdapter,
  StatusUpdate,
} from './interfaces';

/**
 * Termii SMS (TRV-01 fallback). Set TERMII_API_KEY and TERMII_SENDER_ID (an approved sender ID, or
 * use the "generic" channel in sandbox). Delivery reports and inbound replies arrive at
 * POST /v1/webhooks/sms, signed with HMAC-SHA512 of the body using the API key (X-Termii-Signature).
 */
const BASE = process.env.TERMII_BASE_URL ?? 'https://api.ng.termii.com';

export function termiiSignatureValid(
  rawBody: Buffer,
  header: string | undefined,
  key: string,
): boolean {
  if (!header || !key) return false;
  const expected = Buffer.from(createHmac('sha512', key).update(rawBody).digest('hex'));
  const given = Buffer.from(header);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

export const termiiSignature = (rawBody: Buffer | string, key: string) =>
  createHmac('sha512', key).update(rawBody).digest('hex');

const plus = (n: string) => `+${n.replace(/\D/g, '')}`;

/**
 * Termii posts delivery reports (`type: outbound`, with `message_id` and `status`) and inbound
 * messages (`type: inbound`, with `sender` and `message`) to the same webhook.
 */
export function parseTermiiWebhook(body: unknown): {
  statuses: StatusUpdate[];
  messages: InboundMessage[];
} {
  const b = (body ?? {}) as Record<string, unknown>;
  const statuses: StatusUpdate[] = [];
  const messages: InboundMessage[] = [];
  const id = String(b.message_id ?? b.id ?? '');
  if (!id) return { statuses, messages };
  if (b.type === 'inbound' || (b.sender && b.message && !b.status)) {
    messages.push({
      providerMessageId: `termii:${id}`,
      from: plus(String(b.sender ?? b.from ?? '')),
      text: String(b.message ?? b.sms ?? ''),
      at: b.sent_at ? new Date(String(b.sent_at)) : new Date(),
    });
  } else if (b.status) {
    const s = String(b.status).toLowerCase();
    const status: DeliveryState | null = s.includes('deliver')
      ? 'DELIVERED'
      : s.includes('fail') || s.includes('reject') || s.includes('expire')
        ? 'FAILED'
        : s.includes('sent') || s.includes('accept')
          ? 'SENT'
          : null;
    if (status)
      statuses.push({ providerMessageId: id, status, error: status === 'FAILED' ? s : undefined });
  }
  return { statuses, messages };
}

export class TermiiSms implements SmsAdapter {
  readonly mode = 'live' as const;

  async send(to: string, body: string): Promise<SendResult> {
    const res = await fetch(`${BASE}/api/sms/send`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        api_key: process.env.TERMII_API_KEY,
        to: to.replace(/\D/g, ''),
        from: process.env.TERMII_SENDER_ID ?? 'Airwheels',
        sms: body,
        type: 'plain',
        channel: process.env.TERMII_CHANNEL ?? 'generic',
      }),
      signal: AbortSignal.timeout(10_000),
    });
    const json = (await res.json().catch(() => ({}))) as { message_id?: string; message?: string };
    if (!res.ok || !json.message_id)
      throw new Error(`Termii ${res.status}: ${json.message ?? 'no message id'}`);
    return { providerMessageId: String(json.message_id), accepted: true };
  }

  verifyWebhookSignature(rawBody: Buffer, signature: string) {
    return termiiSignatureValid(rawBody, signature, process.env.TERMII_API_KEY ?? '');
  }
}
