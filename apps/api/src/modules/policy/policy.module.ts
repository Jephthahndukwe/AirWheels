import { Injectable, Module } from '@nestjs/common';

/**
 * Policy module boundary. Pure decision function over versioned PolicyRules, with a decision log (PRD 13).
 * Owns its own tables and talks to other modules through services and domain events.
 * Implementation lands in M7 (PRD 24).
 */
@Injectable()
export class PolicyService {}

@Module({ providers: [PolicyService], exports: [PolicyService] })
export class PolicyModule {}
