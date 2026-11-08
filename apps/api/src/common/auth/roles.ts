import { SetMetadata } from '@nestjs/common';
import type { Airline } from '@prisma/client';
import type { Request } from 'express';

/** Every role that can call the API (PRD 2.1). Travellers use public, token-scoped routes. */
export const ROLES = [
  'DRIVER',
  'OPS_AGENT',
  'SUPER_ADMIN',
  'FINANCE',
  'PARTNER',
  'SYSTEM',
] as const;
export type Role = (typeof ROLES)[number];
export type AdminRoleName = 'OPS_AGENT' | 'SUPER_ADMIN' | 'FINANCE';

export type Principal =
  | {
      kind: 'admin';
      role: AdminRoleName;
      userId: string;
      adminId: string;
      sessionId: string;
      email: string;
      name: string;
    }
  | {
      kind: 'driver';
      role: 'DRIVER';
      userId: string;
      driverId: string;
      sessionId: string;
      phone: string;
    }
  | { kind: 'partner'; role: 'PARTNER'; airline: Airline; keyId: string }
  | { kind: 'system'; role: 'SYSTEM' };

export type AdminPrincipal = Extract<Principal, { kind: 'admin' }>;
export type DriverPrincipal = Extract<Principal, { kind: 'driver' }>;

export type AuthedRequest = Request & {
  principal?: Principal;
  airline?: Airline;
  rawBody?: Buffer;
};

export const ROLES_KEY = 'aw:roles';
export const PUBLIC_KEY = 'aw:public';
export const SELF_SERVICE_KEY = 'aw:self-service';
export const RATE_LIMIT_KEY = 'aw:rate-limit';

/** Who may call this route. Routes with neither @Roles nor @Public are blocked (deny by default). */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);

/** Open to anyone. Only for sign-in doors, public widget data and token-scoped traveller pages. */
export const Public = () => SetMetadata(PUBLIC_KEY, true);

/**
 * A write that concerns only the caller (sign out). Finance is read-only everywhere else,
 * so this marker is the only way a finance user can make a non-GET call.
 */
export const SelfService = () => SetMetadata(SELF_SERVICE_KEY, true);

/** Role groups from PRD 2.2. */
export const ADMIN_READ: Role[] = ['OPS_AGENT', 'SUPER_ADMIN', 'FINANCE'];
export const ADMIN_WRITE: Role[] = ['OPS_AGENT', 'SUPER_ADMIN'];

export const AdminRead = () => Roles(...ADMIN_READ);
export const AdminWrite = () => Roles(...ADMIN_WRITE);
export const SuperAdminOnly = () => Roles('SUPER_ADMIN');

/** Rate limit bucket for a route (ACC-09). Limits live in config under `rateLimits`. */
export type RateLimitBy = 'ip' | 'partner' | 'principal';
export const RateLimit = (bucket: string, by: RateLimitBy = 'ip') =>
  SetMetadata(RATE_LIMIT_KEY, { bucket, by });

export const clientIp = (req: Request): string | undefined =>
  req.ip ?? req.socket?.remoteAddress ?? undefined;

export function requireAdmin(req: AuthedRequest): AdminPrincipal {
  if (req.principal?.kind !== 'admin') throw new Error('Admin principal expected');
  return req.principal;
}

export function requireDriver(req: AuthedRequest): DriverPrincipal {
  if (req.principal?.kind !== 'driver') throw new Error('Driver principal expected');
  return req.principal;
}
