import { Injectable, Module } from '@nestjs/common';

/**
 * Matching module boundary. Corridors, shared groups, the four checks and the stop-order solver (PRD 11).
 * Owns its own tables and talks to other modules through services and domain events.
 * Implementation lands in M6 (PRD 24).
 */
@Injectable()
export class MatchingService {}

@Module({ providers: [MatchingService], exports: [MatchingService] })
export class MatchingModule {}
