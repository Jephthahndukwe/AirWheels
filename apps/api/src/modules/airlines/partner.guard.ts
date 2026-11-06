import type { Airline } from '@prisma/client';
import type { AuthedRequest } from '../../common/auth/roles';

/**
 * Request on a partner route. Airline authentication (key id, timestamped HMAC over the raw body,
 * key status and expiry, IP allow-list) runs in PrincipalResolver for every @Roles('PARTNER') route,
 * which attaches the airline so each airline only ever sees its own bookings (ACC-08).
 */
export type PartnerRequest = AuthedRequest & { airline: Airline };
