import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma.service';
import { type Posting, assertBalanced } from './ledger';

type Tx = Prisma.TransactionClient;

/**
 * Writes postings to the ledger. Each posting has a unique reference, so posting the same event
 * twice (a retried job, a duplicate webhook) writes nothing the second time.
 */
@Injectable()
export class LedgerService {
  constructor(private readonly prisma: PrismaService) {}

  /** Posts inside the caller's transaction when given one, so money and state change together. */
  async post(p: Posting, tx?: Tx): Promise<{ transactionId: string; created: boolean }> {
    assertBalanced(p);
    const run = async (t: Tx) => {
      const existing = await t.ledgerTransaction.findUnique({ where: { reference: p.reference } });
      if (existing) return { transactionId: existing.id, created: false };
      const ids = new Map<string, string>();
      for (const line of p.lines) {
        if (ids.has(line.account.code)) continue;
        const a = await t.ledgerAccount.upsert({
          where: { code: line.account.code },
          update: {},
          create: { code: line.account.code, name: line.account.name, type: line.account.type },
        });
        ids.set(line.account.code, a.id);
      }
      const txn = await t.ledgerTransaction.create({
        data: { reference: p.reference, kind: p.kind, bookingId: p.bookingId, memo: p.memo },
      });
      await t.ledgerEntry.createMany({
        data: p.lines.map((l) => ({
          transactionId: txn.id,
          accountId: ids.get(l.account.code)!,
          bookingId: p.bookingId,
          amountKobo: BigInt(l.amountKobo),
          direction: l.direction,
          reference: p.reference,
          memo: p.memo,
        })),
      });
      return { transactionId: txn.id, created: true };
    };
    if (tx) return run(tx);
    try {
      return await this.prisma.$transaction(run);
    } catch (e) {
      // A concurrent identical posting won the race: it is already in the ledger.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        const existing = await this.prisma.ledgerTransaction.findUniqueOrThrow({ where: { reference: p.reference } });
        return { transactionId: existing.id, created: false };
      }
      throw e;
    }
  }

  async forBooking(bookingId: string) {
    const rows = await this.prisma.ledgerEntry.findMany({
      where: { bookingId },
      include: { account: true, transaction: true },
      orderBy: [{ createdAt: 'asc' }],
    });
    return rows.map((r) => ({
      id: r.id,
      reference: r.reference,
      kind: r.transaction.kind,
      account: r.account.code,
      accountName: r.account.name,
      direction: r.direction,
      amountKobo: Number(r.amountKobo),
      time: r.createdAt,
    }));
  }

  /** Balance per account (debits minus credits for assets and expenses, the other way round otherwise). */
  async balances() {
    const sums = await this.prisma.ledgerEntry.groupBy({ by: ['accountId', 'direction'], _sum: { amountKobo: true } });
    const accounts = await this.prisma.ledgerAccount.findMany({ orderBy: { code: 'asc' } });
    return accounts.map((a) => {
      const get = (d: 'DEBIT' | 'CREDIT') => Number(sums.find((s) => s.accountId === a.id && s.direction === d)?._sum.amountKobo ?? 0n);
      const debitNormal = a.type === 'ASSET' || a.type === 'EXPENSE';
      return { code: a.code, name: a.name, type: a.type, balanceKobo: debitNormal ? get('DEBIT') - get('CREDIT') : get('CREDIT') - get('DEBIT') };
    });
  }

  /** Whole-ledger check used by reconciliation: total debits equal total credits. */
  async trialBalance() {
    const sums = await this.prisma.ledgerEntry.groupBy({ by: ['direction'], _sum: { amountKobo: true } });
    const get = (d: string) => Number(sums.find((s) => s.direction === d)?._sum.amountKobo ?? 0n);
    return { debitsKobo: get('DEBIT'), creditsKobo: get('CREDIT'), balanced: get('DEBIT') === get('CREDIT') };
  }
}
