/**
 * What a traveller's change or cancellation costs (TRV-07, POL-07).
 *
 * Until the policy engine lands in M7, one simple rule set from config (`traveller.changeRules`)
 * answers. M7 replaces `SimpleChangePolicy` with the engine behind this same `ChangePolicy`
 * interface, so the tracking page and the traveller API do not change. Pure: no I/O.
 */
import type { LegStatus, Plan } from '@prisma/client';

export type ChangeKind = 'CANCEL' | 'CHANGE_TIME' | 'CHANGE_ADDRESS';

export interface ChangeRules {
  /** At least this many hours before pickup, changes and cancellations are free. */
  freeUntilHoursBefore: number;
  /** Late time or address change fee per leg, by plan. */
  lateChangeFeeKobo: Record<Plan, number>;
  /** Share of the leg price refunded on a late cancellation, by plan, in basis points. */
  lateCancelRefundBps: Record<Plan, number>;
  /** Once a leg is in one of these states, the traveller must call support. */
  lockedStatuses: LegStatus[];
}

export interface LegChange {
  kind: ChangeKind;
  plan: Plan;
  legStatus: LegStatus;
  pickupAt: Date | null;
  legAmountKobo: number;
  driverAssigned: boolean;
  /** CHANGE_ADDRESS: new price minus old price for the leg (positive if the new zone costs more). */
  repriceDeltaKobo?: number;
  now: Date;
}

export interface ChangeDecision {
  allowed: boolean;
  reasonCode: string;
  message: string;
  feeKobo: number;
  refundKobo: number;
  policy: 'simple-config-v1';
}

export interface ChangePolicy {
  decide(change: LegChange, rules: ChangeRules): ChangeDecision;
}

const no = (reasonCode: string, message: string): ChangeDecision => ({
  allowed: false,
  reasonCode,
  message,
  feeKobo: 0,
  refundKobo: 0,
  policy: 'simple-config-v1',
});

export class SimpleChangePolicy implements ChangePolicy {
  decide(c: LegChange, r: ChangeRules): ChangeDecision {
    if (c.legStatus === 'CANCELLED' || c.legStatus === 'COMPLETED' || c.legStatus === 'NO_SHOW')
      return no('LEG_CLOSED', 'This ride is already finished or cancelled.');
    if (r.lockedStatuses.includes(c.legStatus))
      return no('DRIVER_ON_THE_WAY', 'Your driver is already on the way. Please call support.');
    if (c.kind === 'CHANGE_ADDRESS' && c.driverAssigned)
      return no(
        'DRIVER_ASSIGNED',
        'A driver is already assigned, so the address can no longer change here. Please call support.',
      );

    const hoursLeft = c.pickupAt ? (c.pickupAt.getTime() - c.now.getTime()) / 3_600_000 : Infinity;
    const early = hoursLeft >= r.freeUntilHoursBefore;
    const ok = (reasonCode: string, message: string, feeKobo: number, refundKobo: number) => ({
      allowed: true,
      reasonCode,
      message,
      feeKobo,
      refundKobo,
      policy: 'simple-config-v1' as const,
    });

    if (c.kind === 'CANCEL') {
      if (early) return ok('EARLY_CANCEL', 'Free cancellation: full refund.', 0, c.legAmountKobo);
      const bps = r.lateCancelRefundBps[c.plan];
      const refund = Math.floor((c.legAmountKobo * bps) / 10_000);
      return ok(
        'LATE_CANCEL',
        `Less than ${r.freeUntilHoursBefore} hours before pickup: ${bps / 100}% refund under your plan.`,
        0,
        refund,
      );
    }

    const lateFee = early ? 0 : r.lateChangeFeeKobo[c.plan];
    // Price never drops a traveller into paying more than the new zone costs; a cheaper zone is not refunded.
    const repriceFee = c.kind === 'CHANGE_ADDRESS' ? Math.max(0, c.repriceDeltaKobo ?? 0) : 0;
    const fee = lateFee + repriceFee;
    const parts = [
      early ? 'Free change' : `Late change fee under your plan`,
      repriceFee > 0 ? 'plus the difference for the new area' : '',
    ].filter(Boolean);
    return ok(
      early && repriceFee === 0 ? 'EARLY_CHANGE' : 'CHANGE_WITH_FEE',
      parts.join(' ') + '.',
      fee,
      0,
    );
  }
}

export const DEFAULT_CHANGE_RULES: ChangeRules = {
  freeUntilHoursBefore: 24,
  lateChangeFeeKobo: { STANDARD: 150_000, FLEX: 0 },
  lateCancelRefundBps: { STANDARD: 5_000, FLEX: 10_000 },
  lockedStatuses: ['EN_ROUTE', 'ARRIVED', 'PICKED_UP'],
};
