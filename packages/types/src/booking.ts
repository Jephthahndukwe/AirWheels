import { z } from 'zod';
import { LegType, Plan, RideType, VehicleClass } from './enums';
import { Address, PhoneE164 } from './partner';

/**
 * Our own channel (PRD 6.2, CHN-04 to CHN-06): our booking page, the post-booking link from the
 * airline's email, and ops manual entry. The traveller types the airline booking reference and the
 * flight number; we look the flight up instead of asking for times.
 */
export const OwnLegRequest = z.object({
  type: LegType,
  flightNumber: z
    .string()
    .transform((v) => v.replace(/\s+/g, '').toUpperCase())
    .pipe(z.string().regex(/^[A-Z0-9]{2}\d{1,4}$/, 'Enter a flight number like P47121')),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Pick the flight date'),
  /** Home or destination: the end that is not the airport. */
  address: Address,
});
export type OwnLegRequest = z.infer<typeof OwnLegRequest>;

export const Extras = z.object({
  childSeats: z.number().int().min(0).max(3).default(0),
  extraStops: z.number().int().min(0).max(3).default(0),
});

/** POST /v1/quotes */
export const OwnQuoteRequest = z.object({
  /** Set by the post-booking link (CHN-04): the airline whose passenger this is. */
  airlineCode: z.string().min(2).max(3).optional(),
  legs: z
    .array(OwnLegRequest)
    .min(1)
    .max(2)
    .refine((l) => new Set(l.map((x) => x.type)).size === l.length, 'One departure and one arrival at most'),
  passengers: z.number().int().min(1).max(7),
  bags: z.number().int().min(0).max(12),
  rideType: RideType.default('PRIVATE'),
  vehicleClass: VehicleClass.optional(),
  plan: Plan.default('STANDARD'),
  extras: Extras.default({ childSeats: 0, extraStops: 0 }),
  promoCode: z.string().max(20).optional(),
});
export type OwnQuoteRequest = z.infer<typeof OwnQuoteRequest>;

export const Traveller = z.object({
  name: z.string().trim().min(2, 'Enter the name on the airline booking').max(80),
  phone: PhoneE164,
  whatsapp: z.boolean().default(true),
  email: z.string().email().optional(),
});

/** POST /v1/bookings (needs an Idempotency-Key header) */
export const OwnBookingRequest = z.object({
  quoteId: z.string().uuid(),
  airlineBookingReference: z
    .string()
    .transform((v) => v.trim().toUpperCase())
    .pipe(z.string().regex(/^[A-Z0-9]{5,12}$/, 'The booking reference has 5 to 12 letters and numbers')),
  traveller: Traveller,
  channel: z.enum(['OWN_PAGE', 'LINK']).default('OWN_PAGE'),
});
export type OwnBookingRequest = z.infer<typeof OwnBookingRequest>;

/** POST /v1/admin/bookings: ops manual entry for phone and WhatsApp bookings (CHN-06). */
export const OpsBookingRequest = OwnQuoteRequest.extend({
  airlineBookingReference: OwnBookingRequest.shape.airlineBookingReference,
  traveller: Traveller,
  note: z.string().max(500).optional(),
});
export type OpsBookingRequest = z.infer<typeof OpsBookingRequest>;

export interface QuoteLine {
  code: string;
  label: string;
  amountKobo: number;
}

export interface QuoteResponse {
  quoteId: string;
  currency: 'NGN';
  totalKobo: number;
  expiresAt: string;
  vehicleClass: z.infer<typeof VehicleClass>;
  rideType: z.infer<typeof RideType>;
  plan: z.infer<typeof Plan>;
  legs: { type: z.infer<typeof LegType>; amountKobo: number; pickupAt: string; lines: QuoteLine[]; flight: { number: string; date: string; departure: string; arrival: string } }[];
}

export interface Place {
  placeId: string;
  name: string;
  description: string;
  location: { lat: number; lng: number };
}
