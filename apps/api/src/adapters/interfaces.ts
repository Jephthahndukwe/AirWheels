/**
 * Every external service sits behind one of these interfaces (PRD 21).
 * Business code injects the token, never a vendor SDK.
 */

export const PAYMENTS = Symbol('PaymentsAdapter');
export const WHATSAPP = Symbol('WhatsAppAdapter');
export const SMS = Symbol('SmsAdapter');
export const VOICE = Symbol('VoiceAdapter');
export const MAPS = Symbol('MapsAdapter');
export const FLIGHT_STATUS = Symbol('FlightStatusAdapter');
export const KYC = Symbol('KycAdapter');
export const EMAIL = Symbol('EmailAdapter');
export const STORAGE = Symbol('StorageAdapter');
export const PUSH = Symbol('PushAdapter');

export interface SendResult {
  providerMessageId: string;
  accepted: boolean;
}

/** Paystack for our own channel (PAY-01). Amounts are integer kobo, as Paystack uses. */
export type GatewayStatus = 'success' | 'failed' | 'abandoned' | 'pending' | 'reversed';

export interface GatewayTransaction {
  reference: string;
  status: GatewayStatus;
  amountKobo: number;
  currency: string;
  feesKobo: number;
  paidAt?: string;
}

export interface PaymentsAdapter {
  readonly mode: 'live' | 'fake';
  initialize(input: {
    reference: string;
    amountKobo: number;
    email: string;
    callbackUrl: string;
    metadata?: Record<string, string>;
  }): Promise<{ authorizationUrl: string; reference: string }>;
  verify(reference: string): Promise<GatewayTransaction | null>;
  verifyWebhookSignature(rawBody: Buffer, signature: string): boolean;
  refund(reference: string, amountKobo: number): Promise<{ refundId: string; status: 'processed' | 'pending' }>;
  transfer(input: { recipientCode: string; amountKobo: number; reference: string }): Promise<{ transferId: string }>;
  /** Transactions created in a time window, for reconciliation (PAY-06). */
  listTransactions(from: Date, to: Date): Promise<GatewayTransaction[]>;
}

/** WhatsApp Cloud API (TRV-01, TRV-12). */
export interface WhatsAppAdapter {
  sendTemplate(input: {
    to: string;
    template: string;
    language: string;
    variables: Record<string, string>;
    buttons?: { id: string; title: string }[];
  }): Promise<SendResult>;
  sendText(to: string, body: string): Promise<SendResult>;
  verifyWebhookSignature(rawBody: Buffer, signature: string): boolean;
}

/** Termii or Africa's Talking (TRV-01 fallback). */
export interface SmsAdapter {
  send(to: string, body: string): Promise<SendResult>;
}

/** Masked calling (TRV-05, DRV-08). */
export interface VoiceAdapter {
  bridgeCall(input: { from: string; to: string; legId: string }): Promise<{ callId: string }>;
}

export interface LatLng {
  lat: number;
  lng: number;
}

/** Google Maps Platform (Places, Routes, Geocoding). */
export interface Place {
  placeId: string;
  name: string;
  description: string;
  location: LatLng;
}

export interface MapsAdapter {
  geocode(text: string): Promise<(LatLng & { formatted: string }) | null>;
  /** Places search for address entry (CHN-07). */
  searchPlaces(query: string): Promise<Place[]>;
  /** The nearest named place to a dropped pin. */
  reverseGeocode(point: LatLng): Promise<Place | null>;
  travelTimeMinutes(from: LatLng, to: LatLng, departAt: Date): Promise<number>;
}

export interface FlightStatusResult {
  flightNumber: string;
  date: string;
  status: 'SCHEDULED' | 'DELAYED' | 'DEPARTED' | 'LANDED' | 'CANCELLED' | 'DIVERTED';
  origin?: string;
  destination?: string;
  scheduledDeparture?: Date;
  scheduledArrival?: Date;
  estimatedDeparture?: Date;
  estimatedArrival?: Date;
  actualDeparture?: Date;
  actualArrival?: Date;
  terminal?: string;
}

/** AeroDataBox backup flight status (FLT-03). */
export interface FlightStatusAdapter {
  /** `airport` hints which end is ours (LOS), so a fake can answer either direction. */
  lookup(flightNumber: string, date: string, hint?: { leg: 'DEPARTURE' | 'ARRIVAL'; airport: string }): Promise<FlightStatusResult | null>;
}

/** Smile ID, Dojah or Youverify (5.2). */
export interface KycAdapter {
  verifyDriver(input: {
    firstName: string;
    lastName: string;
    idNumber: string;
    idType: 'NIN' | 'DRIVERS_LICENSE';
  }): Promise<{ passed: boolean; reference: string; raw: unknown }>;
}

export interface EmailAdapter {
  send(input: { to: string; subject: string; html: string; text?: string }): Promise<SendResult>;
}

/** S3-compatible private storage with signed URLs. */
export interface StorageAdapter {
  signedUploadUrl(key: string, contentType: string): Promise<string>;
  signedDownloadUrl(key: string, ttlSeconds: number): Promise<string>;
  exists(key: string): Promise<{ sizeBytes: number } | null>;
}

/** Expo push for drivers. */
export interface PushAdapter {
  send(input: { to: string; title: string; body: string; data?: Record<string, unknown> }): Promise<SendResult>;
}
