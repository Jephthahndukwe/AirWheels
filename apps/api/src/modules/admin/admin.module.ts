import { Injectable, Module } from '@nestjs/common';

/**
 * Admin module boundary. Admin users, roles and role guards for every admin endpoint (PRD 2, 17).
 * Owns its own tables and talks to other modules through services and domain events.
 * Implementation lands in M1 (PRD 24).
 */
@Injectable()
export class AdminService {}

@Module({ providers: [AdminService], exports: [AdminService] })
export class AdminModule {}
