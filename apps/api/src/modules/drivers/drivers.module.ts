import { Injectable, Module } from '@nestjs/common';

/**
 * Drivers module boundary. Driver profiles, invites, KYC, documents, vehicles and duty status (PRD 5.2, 15).
 * Owns its own tables and talks to other modules through services and domain events.
 * Implementation lands in M1 (PRD 24).
 */
@Injectable()
export class DriversService {}

@Module({ providers: [DriversService], exports: [DriversService] })
export class DriversModule {}
