import { randomUUID } from 'node:crypto';
import { PARTNER_HEADERS, type PartnerBookingRequest, type PartnerFlightEvent } from '@airwheels/types';
import { signPartnerRequest } from '@airwheels/types/signing';

/**
 * Plays the airline's side of the partner API (PRD 4.6): signs every request the way a real
 * airline integration must, then sends bookings, changes, cancellations and flight alerts.
 */
const API = process.env.API_PUBLIC_URL ?? 'http://localhost:4000';
const KEY_ID = process.env.MOCK_AIRLINE_KEY_ID ?? 'mock-key-1';
const SECRET = process.env.MOCK_AIRLINE_SECRET ?? '';

export async function partnerCall(method: string, path: string, body?: unknown, idempotencyKey?: string) {
  if (!SECRET) throw new Error('MOCK_AIRLINE_SECRET is empty. Run `pnpm setup:env` and `pnpm db:seed`.');
  const raw = body === undefined ? '' : JSON.stringify(body);
  const ts = String(Date.now());
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      [PARTNER_HEADERS.keyId]: KEY_ID,
      [PARTNER_HEADERS.timestamp]: ts,
      [PARTNER_HEADERS.signature]: signPartnerRequest(SECRET, ts, method, path, raw),
      ...(idempotencyKey ? { [PARTNER_HEADERS.idempotencyKey]: idempotencyKey } : {}),
    },
    body: raw || undefined,
  });
  const text = await res.text();
  let json: unknown = text;
  try {
    json = JSON.parse(text);
  } catch {
    /* plain text */
  }
  return { status: res.status, body: json };
}

const tomorrow = () => {
  const d = new Date(Date.now() + 24 * 3_600_000);
  return d.toISOString().slice(0, 10);
};
const lagos = (date: string, hhmm: string) => new Date(`${date}T${hhmm}:00+01:00`).toISOString();

export const randomReference = () => randomUUID().replace(/-/g, '').slice(0, 6).toUpperCase();

/** A realistic Lagos booking: home in Lekki Phase 1 to the domestic terminal, and back. */
export function sampleBooking(reference = randomReference()): PartnerBookingRequest {
  const date = tomorrow();
  const airport = { text: 'Murtala Muhammed Airport, Domestic Terminal', location: { lat: 6.5774, lng: 3.3212 } };
  const home = {
    text: '12 Admiralty Way, Lekki Phase 1',
    location: { lat: 6.4474, lng: 3.4723 },
    landmark: 'Opposite the filling station',
  };
  return {
    airlineBookingReference: reference,
    traveller: { name: 'Ada Obi', phone: '+2348012345678', whatsapp: true, email: 'ada@example.com' },
    passengers: 1,
    bags: 2,
    rideType: 'PRIVATE',
    plan: 'STANDARD',
    paidAmountKobo: 0, // replaced with the quoted total
    legs: [
      {
        type: 'DEPARTURE',
        pickup: home,
        dropoff: airport,
        flight: {
          flightNumber: 'MK101',
          date,
          origin: 'LOS',
          destination: 'ABV',
          scheduledDeparture: lagos(date, '09:30'),
          scheduledArrival: lagos(date, '10:40'),
          terminal: 'Domestic',
        },
      },
    ],
  };
}

/** Quote first (as the widget would), then confirm the paid booking with the quote id. */
export async function sendBooking(reference?: string) {
  const booking = sampleBooking(reference);
  const quote = await partnerCall('POST', '/v1/partner/quotes', {
    legs: booking.legs,
    passengers: booking.passengers,
    bags: booking.bags,
    rideType: booking.rideType,
    plan: booking.plan,
  });
  if (quote.status !== 201) return { step: 'quote', ...quote };
  const q = quote.body as { quoteId: string; totalKobo: number };
  booking.quoteId = q.quoteId;
  booking.paidAmountKobo = q.totalKobo;
  const created = await partnerCall('POST', '/v1/partner/bookings', booking, `booking-${booking.airlineBookingReference}`);
  return { step: 'booking', reference: booking.airlineBookingReference, quote: q, ...created };
}

export const getBooking = (ref: string) => partnerCall('GET', `/v1/partner/bookings/${ref}`);

export const changeBooking = (ref: string) =>
  partnerCall('PATCH', `/v1/partner/bookings/${ref}`, { passengers: 2, bags: 3 });

export const cancelBooking = (ref: string) =>
  partnerCall('POST', `/v1/partner/bookings/${ref}/cancel`, { reason: 'Traveller cancelled the flight booking' });

export function flightAlert(type: PartnerFlightEvent['type'] = 'TIME_SHIFTED', delayMinutes = 45) {
  const date = tomorrow();
  const event: PartnerFlightEvent = {
    flightNumber: 'MK101',
    date,
    type,
    estimatedDeparture:
      type === 'TIME_SHIFTED' ? new Date(Date.parse(lagos(date, '09:30')) + delayMinutes * 60_000).toISOString() : undefined,
    occurredAt: new Date().toISOString(),
  };
  return partnerCall('POST', '/v1/partner/flight-events', event);
}
