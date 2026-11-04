import { Injectable, Module } from '@nestjs/common';

/**
 * Settlement module boundary. Airline settlement statements and reconciliation (PRD 14.3, 14.7).
 * Owns its own tables and talks to other modules through services and domain events.
 * Implementation lands in M5 (PRD 24).
 */
@Injectable()
export class SettlementService {}

@Module({ providers: [SettlementService], exports: [SettlementService] })
export class SettlementModule {}
