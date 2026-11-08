import { Logger } from '@nestjs/common';
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { callbackKeyValid } from './africastalking';
import { paystackSignatureValid } from './paystack';
import { termiiSignature, termiiSignatureValid } from './termii';
import { metaSignature, metaSignatureValid } from './whatsapp-cloud';
import { statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type {
  EmailAdapter,
  GatewayStatus,
  FlightStatusAdapter,
  KycAdapter,
  LatLng,
  MapsAdapter,
  PaymentsAdapter,
  PushAdapter,
  ReplyButton,
  SendResult,
  SmsAdapter,
  StorageAdapter,
  VoiceAdapter,
  WhatsAppAdapter,
} from './interfaces';

/**
 * Fake adapters: deterministic, offline, and they log what they would have sent.
 * The whole system runs locally on these with no real accounts.
 */

const ok = (): SendResult => ({ providerMessageId: `fake_${randomUUID()}`, accepted: true });

/**
 * Fake Paystack: keeps transactions in memory, sends you to our own fake checkout page, and signs
 * webhooks exactly as Paystack does (HMAC-SHA512 of the raw body), so the real webhook handler
 * and its signature check run unchanged in local runs and CI.
 */
export const FAKE_PAYSTACK_SECRET = 'sk_test_fake_airwheels_local_only';

interface FakeTxn {
  reference: string;
  amountKobo: number;
  status: GatewayStatus;
  feesKobo: number;
  createdAt: Date;
  paidAt?: string;
}
const fakeTxns = new Map<string, FakeTxn>();

/** Paystack's local card fee: 1.5% + NGN 100 (waived under NGN 2,500), capped at NGN 2,000. */
export const fakeFeeKobo = (amountKobo: number) =>
  Math.min(200_000, Math.round((amountKobo * 150) / 10_000) + (amountKobo >= 250_000 ? 10_000 : 0));

export class FakePayments implements PaymentsAdapter {
  readonly mode = 'fake' as const;
  private readonly log = new Logger('FakePaystack');

  async initialize(input: { reference: string; amountKobo: number; callbackUrl: string }) {
    this.log.log(`initialize ${input.reference} ${input.amountKobo} kobo`);
    if (!fakeTxns.has(input.reference)) {
      fakeTxns.set(input.reference, {
        reference: input.reference,
        amountKobo: input.amountKobo,
        status: 'pending',
        feesKobo: 0,
        createdAt: new Date(),
      });
    }
    const web = process.env.WEB_PUBLIC_URL ?? 'http://localhost:3000';
    const q = new URLSearchParams({
      reference: input.reference,
      amount: String(input.amountKobo),
      callback: input.callbackUrl,
    });
    return { authorizationUrl: `${web}/pay/fake?${q.toString()}`, reference: input.reference };
  }

  async verify(reference: string) {
    const t = fakeTxns.get(reference);
    return t
      ? {
          reference,
          status: t.status,
          amountKobo: t.amountKobo,
          currency: 'NGN',
          feesKobo: t.feesKobo,
          paidAt: t.paidAt,
        }
      : null;
  }

  verifyWebhookSignature(rawBody: Buffer, signature: string) {
    return paystackSignatureValid(FAKE_PAYSTACK_SECRET, rawBody, signature);
  }

  async refund(reference: string, amountKobo: number) {
    this.log.log(`refund ${reference} ${amountKobo} kobo`);
    return { refundId: `fake_refund_${randomUUID()}`, status: 'processed' as const };
  }

  async transfer(input: { reference: string; amountKobo: number }) {
    this.log.log(`transfer ${input.reference} ${input.amountKobo} kobo`);
    return { transferId: `fake_transfer_${randomUUID()}` };
  }

  async listTransactions(from: Date, to: Date) {
    return [...fakeTxns.values()]
      .filter((t) => t.createdAt >= from && t.createdAt < to)
      .map((t) => ({
        reference: t.reference,
        status: t.status,
        amountKobo: t.amountKobo,
        currency: 'NGN',
        feesKobo: t.feesKobo,
        paidAt: t.paidAt,
      }));
  }

  /** The fake checkout page calls this: settle the payment, then build the webhook Paystack would send. */
  complete(
    reference: string,
    outcome: 'success' | 'failed',
  ): { rawBody: Buffer; signature: string } | null {
    const t = fakeTxns.get(reference);
    if (!t) return null;
    if (t.status === 'pending') {
      t.status = outcome;
      if (outcome === 'success') {
        t.feesKobo = fakeFeeKobo(t.amountKobo);
        t.paidAt = new Date().toISOString();
      }
    }
    return FakePayments.webhook(t.status === 'success' ? 'charge.success' : 'charge.failed', t);
  }

  /** A signed webhook body for a fake transaction (also used by tests to replay and reorder events). */
  static webhook(
    event: string,
    t: { reference: string; amountKobo: number; status: string; feesKobo: number; paidAt?: string },
  ) {
    const rawBody = Buffer.from(
      JSON.stringify({
        event,
        data: {
          reference: t.reference,
          status: t.status,
          amount: t.amountKobo,
          currency: 'NGN',
          fees: t.feesKobo,
          paid_at: t.paidAt ?? null,
        },
      }),
    );
    return {
      rawBody,
      signature: createHmac('sha512', FAKE_PAYSTACK_SECRET).update(rawBody).digest('hex'),
    };
  }

  /** Test helper: forget every fake transaction. */
  static reset() {
    fakeTxns.clear();
  }
}

// ---------- messaging and calls ----------

/**
 * Fake WhatsApp, SMS and voice keep an outbox (shown on the development phone page and read by the
 * end-to-end flow) and report back the way the real providers do: signed webhooks to our own API.
 * So the real webhook handlers, signature checks and SMS fallback run unchanged locally and in CI.
 *
 * Test numbers: ending 0000, WhatsApp refuses the message; ending 0001, WhatsApp accepts it but it
 * is never delivered (so the delivery timeout triggers the SMS fallback); ending 9999, SMS fails.
 */
export const FAKE_WHATSAPP_APP_SECRET = 'fake-whatsapp-app-secret-local-only';
export const FAKE_TERMII_KEY = 'fake-termii-key-local-only';
export const FAKE_VOICE_CALLBACK_SECRET = 'fake-voice-callback-secret-local-only';

export interface OutboxItem {
  id: string;
  channel: 'WHATSAPP' | 'SMS' | 'VOICE';
  to: string;
  kind: 'TEMPLATE' | 'SESSION' | 'TEXT' | 'SMS' | 'CALL';
  body: string;
  template?: string;
  buttons?: ReplyButton[];
  at: string;
}
const outbox: OutboxItem[] = [];
const MAX_OUTBOX = 500;

export const fakeOutbox = {
  list(to?: string) {
    const digits = to?.replace(/\D/g, '');
    return outbox
      .filter((m) => !digits || m.to.replace(/\D/g, '') === digits)
      .slice()
      .reverse();
  },
  clear() {
    outbox.length = 0;
  },
};

function pushOutbox(item: Omit<OutboxItem, 'id' | 'at'>, id: string) {
  outbox.push({ ...item, id, at: new Date().toISOString() });
  if (outbox.length > MAX_OUTBOX) outbox.shift();
  return id;
}

/** Posts a signed callback to our own API, as the provider would. Off in unit tests. */
function providerCallback(
  path: string,
  body: string,
  headers: Record<string, string>,
  delayMs: number,
) {
  if (process.env.NODE_ENV === 'test' || process.env.FAKE_PROVIDER_CALLBACKS === 'off') return;
  const base = process.env.API_PUBLIC_URL ?? 'http://localhost:4000';
  setTimeout(() => {
    fetch(`${base}${path}`, { method: 'POST', body, headers }).catch(() => undefined);
  }, delayMs).unref?.();
}

export const metaStatusBody = (id: string, status: 'delivered' | 'read' | 'failed') =>
  JSON.stringify({
    object: 'whatsapp_business_account',
    entry: [
      {
        changes: [
          {
            field: 'messages',
            value: {
              statuses: [{ id, status, timestamp: String(Math.floor(Date.now() / 1000)) }],
            },
          },
        ],
      },
    ],
  });

export class FakeWhatsApp implements WhatsAppAdapter {
  readonly mode = 'fake' as const;
  private readonly log = new Logger('FakeWhatsApp');

  private deliver(to: string, item: Omit<OutboxItem, 'id' | 'at' | 'channel' | 'to'>): SendResult {
    if (to.endsWith('0000')) throw new Error('WhatsApp (fake): 131026 message undeliverable');
    const id = pushOutbox({ channel: 'WHATSAPP', to, ...item }, `wamid.fake_${randomUUID()}`);
    this.log.log(`${item.kind.toLowerCase()} ${item.template ?? ''} ${id}`);
    if (!to.endsWith('0001')) {
      const body = metaStatusBody(id, 'delivered');
      providerCallback(
        '/v1/webhooks/messaging',
        body,
        {
          'content-type': 'application/json',
          'x-hub-signature-256': metaSignature(body, FAKE_WHATSAPP_APP_SECRET),
        },
        300,
      );
    }
    return { providerMessageId: id, accepted: true };
  }

  async sendTemplate(input: {
    to: string;
    template: string;
    params: string[];
    buttons?: ReplyButton[];
    text?: string;
  }) {
    return this.deliver(input.to, {
      kind: 'TEMPLATE',
      template: input.template,
      body: input.text ?? input.params.join(' | '),
      buttons: input.buttons,
    });
  }
  async sendInteractive(input: { to: string; body: string; buttons: ReplyButton[] }) {
    return this.deliver(input.to, { kind: 'SESSION', body: input.body, buttons: input.buttons });
  }
  async sendText(to: string, body: string) {
    return this.deliver(to, { kind: 'TEXT', body });
  }
  verifyWebhookSignature(rawBody: Buffer, signature: string) {
    return metaSignatureValid(rawBody, signature, FAKE_WHATSAPP_APP_SECRET);
  }
}

export class FakeSms implements SmsAdapter {
  readonly mode = 'fake' as const;
  private readonly log = new Logger('FakeSms');
  async send(to: string, body: string) {
    if (to.endsWith('9999')) throw new Error('SMS (fake): network refused');
    const id = pushOutbox({ channel: 'SMS', to, kind: 'SMS', body }, `termii_fake_${randomUUID()}`);
    this.log.log(`sms ${id}`);
    const report = JSON.stringify({
      type: 'outbound',
      message_id: id,
      status: 'Delivered',
      receiver: to.replace(/\D/g, ''),
    });
    providerCallback(
      '/v1/webhooks/sms',
      report,
      {
        'content-type': 'application/json',
        'x-termii-signature': termiiSignature(report, FAKE_TERMII_KEY),
      },
      300,
    );
    return { providerMessageId: id, accepted: true };
  }
  verifyWebhookSignature(rawBody: Buffer, signature: string) {
    return termiiSignatureValid(rawBody, signature, FAKE_TERMII_KEY);
  }
}

/** Rings nobody: records the call and plays Africa's Talking's callbacks (answered, then ended after 42 s). */
export class FakeVoice implements VoiceAdapter {
  readonly mode = 'fake' as const;
  private readonly log = new Logger('FakeVoice');
  async bridgeCall(input: { from: string; to: string; callLogId: string }) {
    const sessionId = `ATVId_fake_${randomUUID()}`;
    pushOutbox(
      { channel: 'VOICE', to: input.from, kind: 'CALL', body: 'Masked call (number hidden)' },
      sessionId,
    );
    this.log.log(`masked call ${input.callLogId}`);
    const path = `/v1/webhooks/voice?key=${FAKE_VOICE_CALLBACK_SECRET}`;
    const form = (o: Record<string, string>) => new URLSearchParams(o).toString();
    const headers = { 'content-type': 'application/x-www-form-urlencoded' };
    providerCallback(
      path,
      form({ sessionId, isActive: '1', direction: 'Outbound', clientRequestId: input.callLogId }),
      headers,
      200,
    );
    providerCallback(
      path,
      form({
        sessionId,
        isActive: '0',
        direction: 'Outbound',
        status: 'Success',
        durationInSeconds: '42',
        clientRequestId: input.callLogId,
      }),
      headers,
      600,
    );
    return { callId: sessionId };
  }
  verifyCallback(key: string | undefined) {
    return callbackKeyValid(key, FAKE_VOICE_CALLBACK_SECRET);
  }
}

/** Lagos places for local runs: area centres plus a few landmarks. Live Google Places replaces it. */
const FAKE_PLACES: { name: string; area: string; lat: number; lng: number }[] = [
  { name: 'Lekki Phase 1', area: 'Lekki', lat: 6.4474, lng: 3.4723 },
  { name: 'Admiralty Way, Lekki Phase 1', area: 'Lekki', lat: 6.4452, lng: 3.4741 },
  { name: 'Victoria Island', area: 'Eti-Osa', lat: 6.4281, lng: 3.4219 },
  { name: 'Eko Hotel, Victoria Island', area: 'Eti-Osa', lat: 6.4263, lng: 3.4296 },
  { name: 'Ikoyi', area: 'Ikoyi', lat: 6.45, lng: 3.435 },
  { name: 'Oniru', area: 'Eti-Osa', lat: 6.437, lng: 3.45 },
  { name: 'Ajah', area: 'Ajah', lat: 6.4682, lng: 3.5852 },
  { name: 'Sangotedo', area: 'Ajah', lat: 6.47, lng: 3.629 },
  { name: 'Chevron Drive, Lekki', area: 'Lekki', lat: 6.437, lng: 3.532 },
  { name: 'Ikota', area: 'Lekki', lat: 6.445, lng: 3.548 },
  { name: 'Surulere', area: 'Surulere', lat: 6.5, lng: 3.35 },
  { name: 'National Stadium, Surulere', area: 'Surulere', lat: 6.4985, lng: 3.3637 },
  { name: 'Yaba', area: 'Yaba', lat: 6.5095, lng: 3.3711 },
  { name: 'Festac Town', area: 'Amuwo-Odofin', lat: 6.4667, lng: 3.2833 },
  { name: 'Maryland', area: 'Ikeja', lat: 6.573, lng: 3.367 },
  { name: 'Ikeja GRA', area: 'Ikeja', lat: 6.58, lng: 3.355 },
  { name: 'Ogba', area: 'Ikeja', lat: 6.625, lng: 3.342 },
  { name: 'Magodo', area: 'Kosofe', lat: 6.62, lng: 3.38 },
  { name: 'Ikorodu', area: 'Ikorodu', lat: 6.6194, lng: 3.5105 },
  { name: 'Isolo', area: 'Oshodi-Isolo', lat: 6.53, lng: 3.32 },
  { name: 'Egbeda', area: 'Alimosho', lat: 6.592, lng: 3.29 },
];

const toPlace = (p: (typeof FAKE_PLACES)[number]) => ({
  placeId: `fake:${p.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
  name: p.name,
  description: `${p.name}, ${p.area}, Lagos`,
  location: { lat: p.lat, lng: p.lng },
});

/** Straight-line distance at an assumed Lagos average speed. Good enough for local runs. */
export class FakeMaps implements MapsAdapter {
  async geocode(text: string) {
    const hit = FAKE_PLACES.find((p) => text.toLowerCase().includes(p.name.toLowerCase()));
    return hit
      ? { lat: hit.lat, lng: hit.lng, formatted: toPlace(hit).description }
      : { lat: 6.5244, lng: 3.3792, formatted: text };
  }
  async travelTimeMinutes(from: LatLng, to: LatLng) {
    const km = haversineKm(from, to);
    return Math.max(5, Math.round((km / 25) * 60));
  }
  async searchPlaces(query: string) {
    const q = query.trim().toLowerCase();
    if (q.length < 2) return [];
    return FAKE_PLACES.filter((p) => `${p.name} ${p.area}`.toLowerCase().includes(q))
      .slice(0, 6)
      .map(toPlace);
  }
  async reverseGeocode(point: LatLng) {
    let best = FAKE_PLACES[0]!;
    for (const p of FAKE_PLACES) if (haversineKm(point, p) < haversineKm(point, best)) best = p;
    return haversineKm(point, best) < 5
      ? { ...toPlace(best), location: point, description: `Near ${toPlace(best).description}` }
      : null;
  }
}

/**
 * Fake flight status: any well-formed flight number exists, at a time derived from the number
 * (between 06:00 and 21:30 Lagos time), so local bookings get realistic pickup times.
 */
export class FakeFlightStatus implements FlightStatusAdapter {
  async lookup(
    flightNumber: string,
    date: string,
    hint?: { leg: 'DEPARTURE' | 'ARRIVAL'; airport: string },
  ) {
    if (!/^[A-Z0-9]{2}\d{1,4}$/.test(flightNumber) || !/^\d{4}-\d{2}-\d{2}$/.test(date))
      return null;
    const n = Number(flightNumber.slice(2)) || 0;
    const hour = 6 + (n % 16);
    const half = n % 2 === 1;
    const departure = new Date(
      `${date}T${String(hour).padStart(2, '0')}:${half ? '30' : '00'}:00+01:00`,
    );
    const arrival = new Date(departure.getTime() + 70 * 60_000);
    const home = hint?.airport ?? 'LOS';
    return {
      flightNumber,
      date,
      status: 'SCHEDULED' as const,
      origin: hint?.leg === 'ARRIVAL' ? 'ABV' : home,
      destination: hint?.leg === 'ARRIVAL' ? home : 'ABV',
      scheduledDeparture: departure,
      scheduledArrival: arrival,
    };
  }
}

export class FakeKyc implements KycAdapter {
  async verifyDriver() {
    return { passed: true, reference: `fake_kyc_${randomUUID()}`, raw: { fake: true } };
  }
}

export class FakeEmail implements EmailAdapter {
  private readonly log = new Logger('FakeEmail');
  async send(input: { to: string; subject: string }) {
    this.log.log(`to ${input.to}: ${input.subject}`);
    return ok();
  }
}

/**
 * Local private storage for development: files live under `.storage/` at the repo root and are
 * reached only through short-lived HMAC-signed URLs served by FakeStorageController.
 */
export class FakeStorage implements StorageAdapter {
  async signedUploadUrl(key: string, contentType: string) {
    return signedStorageUrl('put', key, 15 * 60, contentType);
  }
  async signedDownloadUrl(key: string, ttlSeconds: number) {
    return signedStorageUrl('get', key, ttlSeconds);
  }
  async exists(key: string) {
    try {
      return { sizeBytes: statSync(localStoragePath(key)).size };
    } catch {
      return null;
    }
  }
}

export const localStorageRoot = () => resolve(__dirname, '../../../../.storage');

export function localStoragePath(key: string): string {
  if (!/^[a-zA-Z0-9/_.-]+$/.test(key) || key.includes('..')) throw new Error('Bad storage key');
  return join(localStorageRoot(), key);
}

const storageSig = (op: string, key: string, exp: number, contentType = '') =>
  createHmac('sha256', `storage:${process.env.JWT_SECRET ?? ''}`)
    .update(
      `${op}
${key}
${exp}
${contentType}`,
    )
    .digest('hex');

export function signedStorageUrl(
  op: 'put' | 'get',
  key: string,
  ttlSeconds: number,
  contentType = '',
): string {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const base = process.env.API_PUBLIC_URL ?? 'http://localhost:4000';
  const q = new URLSearchParams({
    key,
    op,
    exp: String(exp),
    sig: storageSig(op, key, exp, contentType),
  });
  return `${base}/v1/fake-storage?${q.toString()}`;
}

export function checkStorageSignature(
  op: string,
  key: string,
  exp: string,
  sig: string,
  contentType = '',
): boolean {
  const e = Number(exp);
  if (!Number.isFinite(e) || e * 1000 < Date.now()) return false;
  const expected = Buffer.from(storageSig(op, key, e, contentType));
  const given = Buffer.from(sig);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

export class FakePush implements PushAdapter {
  private readonly log = new Logger('FakePush');
  async send(input: { to: string; title: string }) {
    this.log.log(`push to ${input.to}: ${input.title}`);
    return ok();
  }
}

export function haversineKm(a: LatLng, b: LatLng): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
