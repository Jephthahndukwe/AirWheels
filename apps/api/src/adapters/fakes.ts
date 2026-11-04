import { Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type {
  EmailAdapter,
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

export class FakePayments implements PaymentsAdapter {
  private readonly log = new Logger('FakePaystack');
  async initialize(input: { reference: string; amountKobo: number; callbackUrl: string }) {
    this.log.log(`initialize ${input.reference} ${input.amountKobo} kobo`);
    return {
      authorizationUrl: `${input.callbackUrl}?reference=${input.reference}&fake=1`,
      reference: input.reference,
    };
  }
  async verify(_reference: string) {
    return { status: 'success' as const, amountKobo: 0 };
  }
  verifyWebhookSignature() {
    return true;
  }
  async refund(reference: string, amountKobo: number) {
    this.log.log(`refund ${reference} ${amountKobo} kobo`);
    return { refundId: `fake_refund_${randomUUID()}` };
  }
  async transfer(input: { reference: string; amountKobo: number }) {
    this.log.log(`transfer ${input.reference} ${input.amountKobo} kobo`);
    return { transferId: `fake_transfer_${randomUUID()}` };
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

/** Straight-line distance at an assumed Lagos average speed. Good enough for local runs. */
export class FakeMaps implements MapsAdapter {
  async geocode(text: string) {
    return { lat: 6.5244, lng: 3.3792, formatted: text };
  }
  async travelTimeMinutes(from: LatLng, to: LatLng) {
    const km = haversineKm(from, to);
    return Math.max(5, Math.round((km / 25) * 60));
  }
}

export class FakeFlightStatus implements FlightStatusAdapter {
  async lookup(flightNumber: string, date: string) {
    return { flightNumber, date, status: 'SCHEDULED' as const };
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

export class FakeStorage implements StorageAdapter {
  async signedUploadUrl(key: string) {
    return `http://localhost:4000/v1/fake-storage/${encodeURIComponent(key)}?op=put`;
  }
  async signedDownloadUrl(key: string) {
    return `http://localhost:4000/v1/fake-storage/${encodeURIComponent(key)}`;
  }
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
