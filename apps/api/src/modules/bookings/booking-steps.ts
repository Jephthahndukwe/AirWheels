import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Queue } from 'bullmq';
import { PrismaService } from '../../common/prisma.service';
import { QUEUES } from '../../queues/queues';

/** The steps after a booking is confirmed, in order (PRD 8.3 steps 5 and 6). */
export const AFTER_CONFIRM_STEPS = ['post_ledger', 'notify_confirmed'] as const;
export type BookingStepName = (typeof AFTER_CONFIRM_STEPS)[number] | 'confirm_payment';

export interface AfterConfirmJob {
  bookingId: string;
}

/**
 * Runs each booking step once (PRD 8.6). A step row records RUNNING, DONE or FAILED with its
 * result, so a retried job, a duplicate webhook or the sweeper never repeats a finished step.
 */
@Injectable()
export class BookingStepsService {
  private readonly log = new Logger(BookingStepsService.name);

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(QUEUES.bookings) private readonly queue: Queue,
  ) {}

  async run<T>(bookingId: string, step: BookingStepName, fn: () => Promise<T>): Promise<{ result: T | unknown; skipped: boolean }> {
    const row = await this.prisma.bookingStep.upsert({
      where: { bookingId_step: { bookingId, step } },
      update: { attempts: { increment: 1 } },
      create: { bookingId, step, attempts: 1 },
    });
    if (row.status === 'DONE') return { result: row.result, skipped: true };
    try {
      const result = await fn();
      await this.prisma.bookingStep.update({
        where: { id: row.id },
        data: { status: 'DONE', result: (result ?? null) as Prisma.InputJsonValue, error: null, completedAt: new Date() },
      });
      return { result, skipped: false };
    } catch (e) {
      await this.prisma.bookingStep.update({ where: { id: row.id }, data: { status: 'FAILED', error: (e as Error).message.slice(0, 500) } });
      throw e;
    }
  }

  /** Queue the after-confirm steps. One job per booking, so enqueuing twice is harmless. */
  async enqueueAfterConfirm(bookingId: string, opts: { retry?: boolean } = {}) {
    const jobId = `after-confirm-${bookingId}${opts.retry ? `-${Date.now()}` : ''}`;
    try {
      await this.queue.add('after-confirm', { bookingId } satisfies AfterConfirmJob, { jobId });
    } catch (err) {
      // The booking is safe in Postgres. The sweeper re-queues it within a minute.
      this.log.error({ bookingId, err: (err as Error).message }, 'Could not queue booking steps; the sweeper will retry');
    }
  }
}
