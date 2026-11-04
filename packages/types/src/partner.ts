import { z } from 'zod';
import { Kobo } from './money';
import { FlightEventType, LegType, Plan, RideType, VehicleClass } from './enums';

/** Nigerian or international mobile number in E.164 form (PRD CHN-08). */
export const PhoneE164 = z
  .string()
  .regex(/^\+[1-9]\d{7,14}$/, 'Phone must be E.164, e.g. +2348012345678');

export const GeoPoint = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});

export const Address = z.object({
  text: z.string().min(3),
  location: GeoPoint,
  landmark: z.string().max(200).optional(),
});
export type Address = z.infer<typeof Address>;

export const FlightSegment = z.object({
  flightNumber: z.string().regex(/^[A-Z0-9]{2}\d{1,4}$/),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  origin: z.string().length(3),
  destination: z.string().length(3),
  scheduledDeparture: z.string().datetime(),
  scheduledArrival: z.string().datetime(),
  terminal: z.string().optional(),
});

export const LegRequest = z.object({
  type: LegType,
  pickup: Address,
  dropoff: Address,
  flight: FlightSegment,
});
export type LegRequest = z.infer<typeof LegRequest>;

/** POST /v1/partner/quotes */
export const PartnerQuoteRequest = z.object({
  legs: z.array(LegRequest).min(1).max(2),
  passengers: z.number().int().min(1).max(8),
  bags: z.number().int().min(0).max(12),
  rideType: RideType.default('PRIVATE'),
  vehicleClass: VehicleClass.optional(),
  plan: Plan.default('STANDARD'),
});
export type PartnerQuoteRequest = z.infer<typeof PartnerQuoteRequest>;

/** POST /v1/partner/bookings — the airline confirms a paid booking (PRD CHN-03). */
export const PartnerBookingRequest = z.object({
  quoteId: z.string().uuid().optional(),
  airlineBookingReference: z.string().min(5).max(12),
  traveller: z.object({
    name: z.string().min(2),
    phone: PhoneE164,
    whatsapp: z.boolean().default(true),
    email: z.string().email().optional(),
  }),
  passengers: z.number().int().min(1).max(8),
  bags: z.number().int().min(0).max(12),
  rideType: RideType.default('PRIVATE'),
  plan: Plan.default('STANDARD'),
  legs: z.array(LegRequest).min(1).max(2),
  paidAmountKobo: Kobo,
});
export type PartnerBookingRequest = z.infer<typeof PartnerBookingRequest>;

/** PATCH /v1/partner/bookings/:ref */
export const PartnerBookingUpdate = z.object({
  traveller: PartnerBookingRequest.shape.traveller.partial().optional(),
  passengers: PartnerBookingRequest.shape.passengers.optional(),
  bags: PartnerBookingRequest.shape.bags.optional(),
  legs: PartnerBookingRequest.shape.legs.optional(),
});
export type PartnerBookingUpdate = z.infer<typeof PartnerBookingUpdate>;

export const PartnerCancelRequest = z.object({ reason: z.string().max(200).optional() });
export type PartnerCancelRequest = z.infer<typeof PartnerCancelRequest>;

/** POST /v1/partner/flight-events (PRD FLT-01) */
export const PartnerFlightEvent = z.object({
  flightNumber: FlightSegment.shape.flightNumber,
  date: FlightSegment.shape.date,
  type: FlightEventType,
  estimatedDeparture: z.string().datetime().optional(),
  estimatedArrival: z.string().datetime().optional(),
  actualDeparture: z.string().datetime().optional(),
  actualArrival: z.string().datetime().optional(),
  newFlightNumber: z.string().optional(),
  terminal: z.string().optional(),
  occurredAt: z.string().datetime(),
});
export type PartnerFlightEvent = z.infer<typeof PartnerFlightEvent>;

/** Headers every partner call carries (PRD ACC-08, BKG-03). */
export const PARTNER_HEADERS = {
  keyId: 'x-airwheels-key-id',
  timestamp: 'x-airwheels-timestamp',
  signature: 'x-airwheels-signature',
  idempotencyKey: 'idempotency-key',
} as const;
