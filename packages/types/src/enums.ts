import { z } from 'zod';

export const BookingChannel = z.enum(['ADDON', 'WIDGET', 'LINK', 'OWN_PAGE', 'OPS']);
export const Plan = z.enum(['STANDARD', 'FLEX']);
export const RideType = z.enum(['PRIVATE', 'SHARED']);
export const LegType = z.enum(['DEPARTURE', 'ARRIVAL']);
export const VehicleClass = z.enum(['SEDAN', 'SUV', 'VAN']);
export const CollectedBy = z.enum(['AIRLINE', 'AIRWHEELS']);

/** PRD 8.4 booking states */
export const BookingStatus = z.enum([
  'QUOTED',
  'PENDING_PAYMENT',
  'CONFIRMED',
  'IN_PROGRESS',
  'COMPLETED',
  'PAYMENT_FAILED',
  'REJECTED',
  'CANCELLING',
  'CANCELLED',
  'REFUNDING',
  'REFUNDED',
]);
/** PRD 8.4 ride leg states */
export const LegStatus = z.enum([
  'SCHEDULED',
  'ASSIGNED',
  'DRIVER_CONFIRMED',
  'EN_ROUTE',
  'ARRIVED',
  'PICKED_UP',
  'COMPLETED',
  'CANCELLED',
  'NO_SHOW',
]);
export const SharedGroupStatus = z.enum([
  'OPEN',
  'LOCKED',
  'ASSIGNED',
  'IN_PROGRESS',
  'COMPLETED',
  'DISSOLVED',
]);
export const DriverStatus = z.enum(['ONBOARDING', 'INVITED', 'ACTIVATED', 'ACTIVE', 'SUSPENDED']);
export const AdminRole = z.enum(['OPS_AGENT', 'SUPER_ADMIN', 'FINANCE']);
export const FlightEventType = z.enum([
  'TIME_SHIFTED',
  'CANCELLED',
  'DIVERTED',
  'REBOOKED',
  'DEPARTED',
  'LANDED',
]);
export const FlightSource = z.enum(['AIRLINE', 'BACKUP_API', 'OPS', 'DRIVER', 'TRAVELLER']);
export const Confidence = z.enum(['HIGH', 'MEDIUM', 'LOW']);

export type BookingChannel = z.infer<typeof BookingChannel>;
export type Plan = z.infer<typeof Plan>;
export type RideType = z.infer<typeof RideType>;
export type LegType = z.infer<typeof LegType>;
export type VehicleClass = z.infer<typeof VehicleClass>;
export type BookingStatus = z.infer<typeof BookingStatus>;
export type LegStatus = z.infer<typeof LegStatus>;
export type FlightEventType = z.infer<typeof FlightEventType>;
