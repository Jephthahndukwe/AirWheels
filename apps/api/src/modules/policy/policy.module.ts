import { Injectable, Module } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma.service';
import { ConfigStore } from '../config/config.service';
import { CONFIG } from '../config/keys';
import {
  type ChangeDecision,
  type ChangePolicy,
  type ChangeRules,
  type LegChange,
  SimpleChangePolicy,
} from './change-policy';

/**
 * Policy module boundary (PRD 13). In M3 it answers one question, the cost of a traveller's change or
 * cancellation, from the simple config rule set. M7 swaps `policy` for the versioned rules engine;
 * callers keep using `previewChange` and `decideChange`.
 */
@Injectable()
export class PolicyService {
  private readonly policy: ChangePolicy = new SimpleChangePolicy();

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigStore,
  ) {}

  async rules(): Promise<{ rules: ChangeRules; version: number }> {
    const rules = await this.config.get<ChangeRules>(CONFIG.travellerChangeRules);
    const row = await this.prisma.configEntry.findFirst({
      where: { key: CONFIG.travellerChangeRules },
      orderBy: { version: 'desc' },
      select: { version: true },
    });
    return { rules, version: row?.version ?? 0 };
  }

  /** What it would cost. Nothing is stored: the page shows this before the traveller confirms. */
  async previewChange(change: LegChange): Promise<ChangeDecision> {
    const { rules } = await this.rules();
    return this.policy.decide(change, rules);
  }

  /** The decision that is acted on, logged with its inputs and rule version (POL-04). */
  async decideChange(
    bookingId: string,
    event: string,
    change: LegChange,
    tx?: Prisma.TransactionClient,
  ) {
    const { rules, version } = await this.rules();
    const decision = this.policy.decide(change, rules);
    await (tx ?? this.prisma).policyDecision.create({
      data: {
        bookingId,
        event,
        inputs: {
          ...change,
          pickupAt: change.pickupAt?.toISOString() ?? null,
          now: change.now.toISOString(),
        },
        output: decision as unknown as Prisma.InputJsonValue,
        reasonCode: decision.reasonCode,
        ruleVersion: version,
      },
    });
    return decision;
  }
}

@Module({ providers: [PolicyService], exports: [PolicyService] })
export class PolicyModule {}
