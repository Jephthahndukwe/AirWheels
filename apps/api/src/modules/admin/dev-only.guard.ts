import { type CanActivate, ForbiddenException, Injectable } from '@nestjs/common';

/**
 * Admin endpoints are open only when NODE_ENV is exactly "development".
 * Any other value (staging, production, test) or no value at all means blocked.
 * Temporary until admin auth (email + password + TOTP, ACC-07) and role guards land in M1.
 */
export const adminEndpointsOpen = (nodeEnv: string | undefined): boolean => nodeEnv === 'development';

@Injectable()
export class DevOnlyGuard implements CanActivate {
  canActivate(): boolean {
    if (adminEndpointsOpen(process.env.NODE_ENV)) return true;
    throw new ForbiddenException({ code: 'ADMIN_AUTH_REQUIRED', message: 'Admin auth is not enabled yet.' });
  }
}
