import { Injectable, Module } from '@nestjs/common';

/**
 * Calls module boundary. Masked calls between traveller and driver, with call logs (TRV-05, DRV-08).
 * Owns its own tables and talks to other modules through services and domain events.
 * Implementation lands in M3 (PRD 24).
 */
@Injectable()
export class CallsService {}

@Module({ providers: [CallsService], exports: [CallsService] })
export class CallsModule {}
