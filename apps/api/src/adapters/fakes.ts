import { Logger } from '@nestjs/common';
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { paystackSignatureValid } from './paystack';
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
      fakeTxns.set(input.reference, { reference: input.reference, amountKobo: input.amountKobo, status: 'pending', feesKobo: 0, createdAt: new Date() });
    }
    const web = process.env.WEB_PUBLIC_URL ?? 'http://localhost:3000';
    const q = new URLSearchParams({ reference: input.reference, amount: String(input.amountKobo), callback: input.callbackUrl });
    return { authorizationUrl: `${web}/pay/fake?${q.toString()}`, reference: input.reference };
  }

  async verify(reference: string) {
    const t = fakeTxns.get(reference);
    return t ? { reference, status: t.status, amountKobo: t.amountKobo, currency: 'NGN', feesKobo: t.feesKobo, paidAt: t.paidAt } : null;
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
      .map((t) => ({ reference: t.reference, status: t.status, amountKobo: t.amountKobo, currency: 'NGN', feesKobo: t.feesKobo, paidAt: t.paidAt }));
  }

  /** The fake checkout page calls this: settle the payment, then build the webhook Paystack would send. */
  complete(reference: string, outcome: 'success' | 'failed'): { rawBody: Buffer; signature: string } | null {
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
  static webhook(event: string, t: { reference: string; amountKobo: number; status: string; feesKobo: number; paidAt?: string }) {
    const rawBody = Buffer.from(
      JSON.stringify({
        event,
        data: { reference: t.reference, status: t.status, amount: t.amountKobo, currency: 'NGN', fees: t.feesKobo, paid_at: t.paidAt ?? null },
      }),
    );
    return { rawBody, signature: createHmac('sha512', FAKE_PAYSTACK_SECRET).update(rawBody).digest('hex') };
  }

  /** Test helper: forget every fake transaction. */
  static reset() {
    fakeTxns.clear();
  }
}

export class FakeWhatsApp implements WhatsAppAdapter {
  private readonly log = new Logger('FakeWhatsApp');
  async sendTemplate(input: { to: string; template: string; variables: Record<string, string> }) {
    this.log.log(`template "${input.template}" to ${input.to} ${JSON.stringify(input.variables)}`);
    return ok();
  }
  async sendText(to: string, body: string) {
    this.log.log(`text to ${to}: ${body}`);
    return ok();
  }
  verifyWebhookSignature() {
    return true;
  }
}

export class FakeSms implements SmsAdapter {
  private readonly log = new Logger('FakeSms');
  async send(to: string, body: string) {
    this.log.log(`to ${to}: ${body}`);
    return ok();
  }
}

export class FakeVoice implements VoiceAdapter {
  private readonly log = new Logger('FakeVoice');
  async bridgeCall(input: { from: string; to: string; legId: string }) {
    this.log.log(`masked call for leg ${input.legId}`);
    return { callId: `fake_call_${randomUUID()}` };
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
    return hit ? { lat: hit.lat, lng: hit.lng, formatted: toPlace(hit).description } : { lat: 6.5244, lng: 3.3792, formatted: text };
  }
  async travelTimeMinutes(from: LatLng, to: LatLng) {
    const km = haversineKm(from, to);
    return Math.max(5, Math.round((km / 25) * 60));
  }
  async searchPlaces(query: string) {
    const q = query.trim().toLowerCase();
    if (q.length < 2) return [];
    return FAKE_PLACES.filter((p) => `${p.name} ${p.area}`.toLowerCase().includes(q)).slice(0, 6).map(toPlace);
  }
  async reverseGeocode(point: LatLng) {
    let best = FAKE_PLACES[0]!;
    for (const p of FAKE_PLACES) if (haversineKm(point, p) < haversineKm(point, best)) best = p;
    return haversineKm(point, best) < 5 ? { ...toPlace(best), location: point, description: `Near ${toPlace(best).description}` } : null;
  }
}

/**
 * Fake flight status: any well-formed flight number exists, at a time derived from the number
 * (between 06:00 and 21:30 Lagos time), so local bookings get realistic pickup times.
 */
export class FakeFlightStatus implements FlightStatusAdapter {
  async lookup(flightNumber: string, date: string, hint?: { leg: 'DEPARTURE' | 'ARRIVAL'; airport: string }) {
    if (!/^[A-Z0-9]{2}\d{1,4}$/.test(flightNumber) || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
    const n = Number(flightNumber.slice(2)) || 0;
    const hour = 6 + (n % 16);
    const half = n % 2 === 1;
    const departure = new Date(`${date}T${String(hour).padStart(2, '0')}:${half ? '30' : '00'}:00+01:00`);
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
  createHmac('sha256', `storage:${process.env.JWT_SECRET ?? ''}`).update(`${op}
${key}
${exp}
${contentType}`).digest('hex');

export function signedStorageUrl(op: 'put' | 'get', key: string, ttlSeconds: number, contentType = ''): string {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const base = process.env.API_PUBLIC_URL ?? 'http://localhost:4000';
  const q = new URLSearchParams({ key, op, exp: String(exp), sig: storageSig(op, key, exp, contentType) });
  return `${base}/v1/fake-storage?${q.toString()}`;
}

export function checkStorageSignature(op: string, key: string, exp: string, sig: string, contentType = ''): boolean {
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
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
