import { Injectable, Module } from '@nestjs/common';

/**
 * Dispatch module boundary. Night-before plan, arrival offers, sweeper, trip steps (PRD 10).
 * Owns its own tables and talks to other modules through services and domain events.
 * Implementation lands in M4 (PRD 24).
 */
@Injectable()
export class DispatchService {}

@Module({ providers: [DispatchService], exports: [DispatchService] })
export class DispatchModule {}
