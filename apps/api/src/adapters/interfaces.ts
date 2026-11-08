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
  refund(
    reference: string,
    amountKobo: number,
  ): Promise<{ refundId: string; status: 'processed' | 'pending' }>;
  transfer(input: {
    recipientCode: string;
    amountKobo: number;
    reference: string;
  }): Promise<{ transferId: string }>;
  /** Transactions created in a time window, for reconciliation (PAY-06). */
  listTransactions(from: Date, to: Date): Promise<GatewayTransaction[]>;
}

/** A quick-reply button: `payload` comes back to us when tapped (TRV-12). */
export interface ReplyButton {
  payload: string;
  title: string;
}

/** Delivery status and inbound messages, normalised from each provider's webhook. */
export type DeliveryState = 'SENT' | 'DELIVERED' | 'READ' | 'FAILED';
export interface StatusUpdate {
  providerMessageId: string;
  status: DeliveryState;
  error?: string;
}
export interface InboundMessage {
  providerMessageId: string;
  from: string; // E.164 with +
  text?: string;
  buttonPayload?: string;
  /** The message this one replies to, when the provider says. */
  contextId?: string;
  at: Date;
}

/** WhatsApp Cloud API (TRV-01, TRV-12). */
export interface WhatsAppAdapter {
  readonly mode: 'live' | 'fake';
  /** Approved template: allowed at any time. `params` follow the template's placeholders in order. */
  sendTemplate(input: {
    to: string;
    template: string;
    language: string;
    params: string[];
    buttons?: ReplyButton[];
    /** The rendered text. Not sent (Meta renders the approved template); fakes show it. */
    text?: string;
  }): Promise<SendResult>;
  /** Free-form with buttons: only inside the 24-hour window (PRD 7.3). */
  sendInteractive(input: { to: string; body: string; buttons: ReplyButton[] }): Promise<SendResult>;
  sendText(to: string, body: string): Promise<SendResult>;
  verifyWebhookSignature(rawBody: Buffer, signature: string): boolean;
}

/** Termii (TRV-01 fallback). */
export interface SmsAdapter {
  readonly mode: 'live' | 'fake';
  send(to: string, body: string): Promise<SendResult>;
  verifyWebhookSignature(rawBody: Buffer, signature: string): boolean;
}

/**
 * Masked calling (TRV-05, DRV-08). The provider rings `from`; when they answer, our voice callback
 * connects them to the other party, so neither sees the other's number.
 */
export interface VoiceAdapter {
  readonly mode: 'live' | 'fake';
  bridgeCall(input: { from: string; to: string; callLogId: string }): Promise<{ callId: string }>;
  /** Checks the secret on a voice callback URL. */
  verifyCallback(key: string | undefined): boolean;
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
  lookup(
    flightNumber: string,
    date: string,
    hint?: { leg: 'DEPARTURE' | 'ARRIVAL'; airport: string },
  ): Promise<FlightStatusResult | null>;
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
  send(input: {
    to: string;
    title: string;
    body: string;
    data?: Record<string, unknown>;
  }): Promise<SendResult>;
}
