import { Injectable, Module } from '@nestjs/common';

/**
 * Auth module boundary. Driver OTP + PIN login, admin email + password + TOTP, JWT sessions (PRD 5).
 * Owns its own tables and talks to other modules through services and domain events.
 * Implementation lands in M1 (PRD 24).
 */
@Injectable()
export class AuthService {}

@Module({ providers: [AuthService], exports: [AuthService] })
export class AuthModule {}
