import { Injectable, Module } from '@nestjs/common';

/**
 * Payments module boundary. Paystack payments for our channel, double-entry ledger, refunds, payouts (PRD 14).
 * Owns its own tables and talks to other modules through services and domain events.
 * Implementation lands in M2 (PRD 24).
 */
@Injectable()
export class PaymentsService {}

@Module({ providers: [PaymentsService], exports: [PaymentsService] })
export class PaymentsModule {}
