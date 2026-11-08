import { InjectQueue } from '@nestjs/bullmq';
import {
  BadRequestException,
  ForbiddenException,
  GoneException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Queue } from 'bullmq';
import { randomBytes } from 'node:crypto';
import { PAYMENTS, type GatewayTransaction, type PaymentsAdapter } from '../../adapters/interfaces';
import { PrismaService } from '../../common/prisma.service';
import type { AdminRoleName } from '../../common/auth/roles';
import { QUEUES } from '../../queues/queues';
import { AuditService } from '../audit/audit.service';
import { BookingsService } from '../bookings/bookings.service';
import { BookingStepsService } from '../bookings/booking-steps';
import { ConfigStore } from '../config/config.service';
import { CONFIG } from '../config/keys';
import { AlertsService } from '../support/alerts.service';
import { lagosParts } from '../dispatch/dispatch.module';
import { refund as refundPosting } from './ledger';
import { LedgerService } from './ledger.service';
import { MessagingService } from '../messaging/messaging.service';

export interface PaymentEventJob {
  reference: string;
  event: 'charge.success' | 'charge.failed' | 'refund.processed' | 'refund.failed';
  /** For refund events: the gateway's refund id. */
  refundId?: string;
  source: 'webhook' | 'reconciliation';
}

/** What we keep from a webhook: never card, bank or payer details (rules: never log payment details). */
export function redactWebhook(body: unknown): Prisma.InputJsonValue {
  const b = (body ?? {}) as { event?: string; data?: Record<string, unknown> };
  const d = b.data ?? {};
  const t = (d.transaction ?? {}) as Record<string, unknown>;
  return {
    event: b.event ?? null,
    data: {
      id: (d.id as number | string | undefined) ?? null,
      reference: (d.reference as string | undefined) ?? (t.reference as string | undefined) ?? null,
      status: (d.status as string | undefined) ?? null,
      amount: (d.amount as number | undefined) ?? null,
      currency: (d.currency as string | undefined) ?? null,
      fees: (d.fees as number | undefined) ?? null,
      paid_at: (d.paid_at as string | undefined) ?? null,
    },
  };
}

/** Decides which webhook events we act on and dedupes them by identity (PAY-02). */
export function webhookIdentity(body: unknown): {
  event: string;
  reference: string | null;
  status: string | null;
  key: string;
  refundId?: string;
} {
  const b = (body ?? {}) as { event?: string; data?: Record<string, unknown> };
  const d = b.data ?? {};
  const t = (d.transaction ?? {}) as Record<string, unknown>;
  const event = String(b.event ?? 'unknown');
  const reference =
    (d.reference as string | undefined) ??
    (d.transaction_reference as string | undefined) ??
    (t.reference as string | undefined) ??
    null;
  const status = (d.status as string | undefined) ?? null;
  const refundId = event.startsWith('refund.') && d.id !== undefined ? String(d.id) : undefined;
  return {
    event,
    reference,
    status,
    refundId,
    key: `${event}:${reference ?? '-'}:${status ?? '-'}:${refundId ?? '-'}`,
  };
}

const newReference = () =>
  `AW-${randomBytes(9)
    .toString('base64url')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, 'X')}`;

/**
 * Payments for our own channel (PRD 14.2): one payment intent per booking, Paystack checkout,
 * a signature-checked webhook applied once, and daily reconciliation. The browser never marks a
 * payment as successful: only the gateway does, and we re-check its answer before confirming.
 */
@Injectable()
export class PaymentsService {
  private readonly log = new Logger(PaymentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly bookings: BookingsService,
    private readonly steps: BookingStepsService,
    private readonly ledger: LedgerService,
    private readonly config: ConfigStore,
    private readonly alerts: AlertsService,
    private readonly audit: AuditService,
    @Inject(PAYMENTS) private readonly gateway: PaymentsAdapter,
    @InjectQueue(QUEUES.payments) private readonly queue: Queue,
    private readonly messaging: MessagingService,
  ) {}

  get gatewayMode() {
    return this.gateway.mode;
  }

  /** The traveller's email is optional, but Paystack needs one: use a stable no-reply address. */
  private payerEmail(bookingId: string, email?: string | null) {
    return email ?? `traveller+${bookingId.slice(0, 8)}@pay.airwheels.ng`;
  }

  /**
   * Starts (or resumes) payment for a booking. Idempotent: a booking has one live payment, so
   * pressing Pay twice returns the same checkout and can never charge twice.
   */
  async initialize(bookingId: string, callbackUrl: string) {
    const b = await this.prisma.transferBooking.findUnique({
      where: { id: bookingId },
      include: { quote: true, traveller: true, paymentIntents: true },
    });
    if (!b) throw new NotFoundException({ code: 'BOOKING_NOT_FOUND', message: 'No such booking.' });
    if (b.collectedBy !== 'AIRWHEELS')
      throw new BadRequestException({
        code: 'NOT_OUR_PAYMENT',
        message: 'The airline collects payment for this booking.',
      });
    if (b.status === 'CONFIRMED' || b.paymentIntents.some((i) => i.status === 'SUCCEEDED')) {
      return { status: 'PAID' as const, bookingId };
    }
    if (b.status !== 'PENDING_PAYMENT' && b.status !== 'PAYMENT_FAILED') {
      throw new BadRequestException({
        code: 'BOOKING_STATE',
        message: `This booking is ${b.status.toLowerCase()} and cannot be paid.`,
      });
    }
    // The price was held until the quote expired. After that it cannot be paid (PRC-03).
    if (!b.quote || b.quote.expiresAt <= new Date()) {
      throw new GoneException({
        code: 'QUOTE_EXPIRED',
        message: 'This price is no longer held. Go back and get a new price.',
      });
    }
    const pending = b.paymentIntents.find((i) => i.status === 'PENDING' && i.authorizationUrl);
    if (pending)
      return {
        status: 'PENDING' as const,
        authorizationUrl: pending.authorizationUrl!,
        reference: pending.gatewayReference,
      };

    const intent = await this.prisma.paymentIntent.create({
      data: {
        bookingId,
        gatewayReference: newReference(),
        amountKobo: b.quote.totalKobo,
        idempotencyKey: `pay:${bookingId}:${b.paymentIntents.length + 1}`,
      },
    });
    if (b.status === 'PAYMENT_FAILED')
      await this.bookings.transition(
        bookingId,
        'PENDING_PAYMENT',
        { role: 'TRAVELLER' },
        'retrying payment',
      );
    const init = await this.gateway.initialize({
      reference: intent.gatewayReference,
      amountKobo: intent.amountKobo,
      email: this.payerEmail(bookingId, b.traveller?.email),
      callbackUrl,
      metadata: { bookingId, reference: b.airlineBookingReference },
    });
    await this.prisma.paymentIntent.update({
      where: { id: intent.id },
      data: { authorizationUrl: init.authorizationUrl },
    });
    return {
      status: 'PENDING' as const,
      authorizationUrl: init.authorizationUrl,
      reference: intent.gatewayReference,
    };
  }

  /**
   * POST /v1/webhooks/payments. Checks the signature, stores the event once (duplicates stop here)
   * and queues it. The job re-asks Paystack for the transaction before changing anything.
   */
  async receiveWebhook(rawBody: Buffer | undefined, signature: string | undefined) {
    if (!rawBody || !signature || !this.gateway.verifyWebhookSignature(rawBody, signature)) {
      throw new UnauthorizedException({
        code: 'SIGNATURE_INVALID',
        message: 'Webhook signature is not valid.',
      });
    }
    let body: unknown;
    try {
      body = JSON.parse(rawBody.toString('utf8'));
    } catch {
      throw new BadRequestException({ code: 'BODY_INVALID', message: 'Webhook body is not JSON.' });
    }
    const id = webhookIdentity(body);
    try {
      await this.prisma.paymentWebhookEvent.create({
        data: {
          gateway: 'paystack',
          eventKey: id.key,
          event: id.event,
          reference: id.reference,
          payload: redactWebhook(body),
        },
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002')
        return { received: true, duplicate: true };
      throw e;
    }
    const handled = ['charge.success', 'charge.failed', 'refund.processed', 'refund.failed'];
    if (!handled.includes(id.event) || !id.reference) {
      await this.prisma.paymentWebhookEvent.update({
        where: { eventKey: id.key },
        data: { processedAt: new Date(), result: 'ignored' },
      });
      return { received: true, ignored: true };
    }
    await this.enqueue(
      {
        reference: id.reference,
        event: id.event as PaymentEventJob['event'],
        refundId: id.refundId,
        source: 'webhook',
      },
      id.key,
    );
    return { received: true };
  }

  private async enqueue(job: PaymentEventJob, key: string) {
    try {
      await this.queue.add('payment-event', job, { jobId: key.replace(/[^A-Za-z0-9_-]/g, '_') });
    } catch (err) {
      // Never lose a webhook: process it now if the queue is down. It is idempotent either way.
      this.log.error(
        { err: (err as Error).message },
        'Payments queue unavailable; processing inline',
      );
      await this.process(job);
    }
  }

  /** The queued job. Safe to run any number of times and in any order. */
  async process(job: PaymentEventJob) {
    if (job.event.startsWith('refund.')) return this.applyRefundEvent(job);
    const intent = await this.prisma.paymentIntent.findUnique({
      where: { gatewayReference: job.reference },
    });
    if (!intent) {
      await this.alerts.raise({
        type: 'PAYMENT_UNKNOWN_REFERENCE',
        message: `Paystack sent ${job.event} for ${job.reference}, which we do not know.`,
        data: { reference: job.reference },
      });
      return { result: 'unknown_reference' };
    }
    // Ask Paystack what really happened: the final word, whatever order the webhooks came in.
    const tx = await this.gateway.verify(job.reference);
    return this.applyGatewayState(intent.id, tx, job.source);
  }

  /** Applies the gateway's state to an intent. Success always wins; failure never undoes a success. */
  async applyGatewayState(intentId: string, tx: GatewayTransaction | null, source: string) {
    const intent = await this.prisma.paymentIntent.findUniqueOrThrow({ where: { id: intentId } });
    if (!tx) return { result: 'not_at_gateway' };

    if (tx.status === 'success') {
      if (tx.amountKobo !== intent.amountKobo || tx.currency !== 'NGN') {
        await this.alerts.raise({
          type: 'PAYMENT_AMOUNT_MISMATCH',
          message: `Paystack shows ${tx.amountKobo} ${tx.currency} for ${intent.gatewayReference}, we expected ${intent.amountKobo} NGN. Not confirmed.`,
          bookingId: intent.bookingId,
          data: { reference: intent.gatewayReference },
        });
        await this.prisma.transferBooking.update({
          where: { id: intent.bookingId },
          data: { flaggedForOps: true, flagReason: 'PAYMENT_AMOUNT_MISMATCH' },
        });
        return { result: 'amount_mismatch' };
      }
      const confirmed = await this.prisma.$transaction(async (t) => {
        // Compare-and-set: only one worker moves this intent to SUCCEEDED.
        const moved = await t.paymentIntent.updateMany({
          where: { id: intent.id, status: { not: 'SUCCEEDED' } },
          data: {
            status: 'SUCCEEDED',
            paidAt: tx.paidAt ? new Date(tx.paidAt) : new Date(),
            gatewayFeeKobo: tx.feesKobo,
            failureReason: null,
          },
        });
        if (moved.count !== 1) return false;
        await this.bookings.confirmPaid(intent.bookingId, t, {
          reference: intent.gatewayReference,
          source,
        });
        return true;
      });
      if (confirmed) await this.steps.enqueueAfterConfirm(intent.bookingId);
      return { result: confirmed ? 'confirmed' : 'already_confirmed' };
    }

    if (tx.status === 'failed' || tx.status === 'abandoned') {
      const moved = await this.prisma.paymentIntent.updateMany({
        where: { id: intent.id, status: 'PENDING' },
        data: { status: tx.status === 'failed' ? 'FAILED' : 'ABANDONED', failureReason: tx.status },
      });
      if (moved.count === 1) {
        const b = await this.prisma.transferBooking.findUniqueOrThrow({
          where: { id: intent.bookingId },
        });
        if (b.status === 'PENDING_PAYMENT')
          await this.bookings.transition(
            b.id,
            'PAYMENT_FAILED',
            { role: 'SYSTEM' },
            `payment ${tx.status}`,
            { source },
          );
      }
      return { result: moved.count === 1 ? 'failed' : 'no_change' };
    }
    return { result: 'still_pending' };
  }

  // ---------- refunds (PAY-05, PAY-08) ----------

  async refundable(bookingId: string) {
    const b = await this.prisma.transferBooking.findUniqueOrThrow({
      where: { id: bookingId },
      include: {
        paymentIntents: { where: { status: 'SUCCEEDED' } },
        refunds: { where: { status: { not: 'FAILED' } } },
      },
    });
    const paid =
      b.collectedBy === 'AIRWHEELS'
        ? b.paymentIntents.reduce((s, i) => s + i.amountKobo, 0)
        : ['CONFIRMED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'REFUNDING'].includes(b.status)
          ? b.amountKobo
          : 0;
    const refunded = b.refunds.reduce((s, r) => s + r.amountKobo, 0);
    return { booking: b, paidKobo: paid, refundedKobo: refunded, refundableKobo: paid - refunded };
  }

  /**
   * Refund by route: Paystack for our channel, an adjustment on the airline's statement for
   * airline-collected bookings. Ops agents are capped by config; larger refunds need a super admin.
   */
  async refund(input: {
    bookingId: string;
    amountKobo: number;
    reason: string;
    legId?: string;
    /** SYSTEM: a refund decided by the change policy when the traveller cancels (TRV-07). */
    actor: { userId?: string; role: AdminRoleName | 'SYSTEM' };
  }) {
    const actorRole = input.actor.role === 'SYSTEM' ? ('SYSTEM' as const) : ('OPS' as const);
    if (!Number.isSafeInteger(input.amountKobo) || input.amountKobo <= 0)
      throw new BadRequestException({
        code: 'AMOUNT_INVALID',
        message: 'Enter an amount in kobo greater than zero.',
      });
    if (input.actor.role === 'FINANCE')
      throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Finance is read-only.' });
    if (input.actor.role === 'OPS_AGENT') {
      const limit = await this.config.get<number>(CONFIG.refundOpsAgentLimitKobo);
      if (input.amountKobo > limit) {
        throw new ForbiddenException({
          code: 'REFUND_OVER_LIMIT',
          message: `Ops agents can refund up to ${limit / 100} naira at a time. Ask a super admin for larger refunds.`,
          limitKobo: limit,
        });
      }
    }
    const { booking: b, paidKobo, refundableKobo } = await this.refundable(input.bookingId);
    if (paidKobo === 0)
      throw new BadRequestException({
        code: 'NOTHING_PAID',
        message: 'Nothing has been paid on this booking.',
      });
    if (input.amountKobo > refundableKobo) {
      throw new BadRequestException({
        code: 'REFUND_TOO_LARGE',
        message: `At most ${refundableKobo / 100} naira can still be refunded.`,
        refundableKobo,
      });
    }
    if (input.legId) {
      const leg = await this.prisma.rideLeg.findFirst({
        where: { id: input.legId, bookingId: b.id },
      });
      if (!leg)
        throw new BadRequestException({
          code: 'LEG_INVALID',
          message: 'That leg is not on this booking.',
        });
    }
    const route = b.collectedBy === 'AIRWHEELS' ? ('PAYSTACK' as const) : ('AIRLINE' as const);
    const airline = b.airlineId
      ? await this.prisma.airline.findUnique({ where: { id: b.airlineId } })
      : null;
    const full = input.amountKobo === refundableKobo;

    const refund = await this.prisma.$transaction(async (t) => {
      const r = await t.refund.create({
        data: {
          bookingId: b.id,
          legId: input.legId,
          amountKobo: input.amountKobo,
          route,
          status: 'REQUESTED',
          reason: input.reason,
          issuedById: input.actor.userId ?? null,
          issuedByRole: input.actor.role,
        },
      });
      // The refund is committed money: post it now, once (reference refund:<id>).
      await this.ledger.post(
        refundPosting({
          reference: `refund:${r.id}`,
          bookingId: b.id,
          amountKobo: r.amountKobo,
          route,
          airline: airline ? { id: airline.id, code: airline.code } : null,
        }),
        t,
      );
      if (full)
        await this.bookings.transition(
          b.id,
          'REFUNDING',
          { role: actorRole, id: input.actor.userId },
          input.reason,
          { refundId: r.id, amountKobo: r.amountKobo },
          t,
        );
      else
        await t.bookingEvent.create({
          data: {
            bookingId: b.id,
            type: 'refund.partial',
            actorRole,
            actorId: input.actor.userId ?? null,
            reason: input.reason,
            data: { refundId: r.id, amountKobo: r.amountKobo },
          },
        });
      return r;
    });

    let status = refund.status;
    if (route === 'PAYSTACK') {
      const intent = await this.prisma.paymentIntent.findFirstOrThrow({
        where: { bookingId: b.id, status: 'SUCCEEDED' },
      });
      try {
        const res = await this.gateway.refund(intent.gatewayReference, refund.amountKobo);
        status = res.status === 'processed' ? 'COMPLETED' : 'PROCESSING';
        await this.prisma.refund.update({
          where: { id: refund.id },
          data: {
            gatewayRefundId: res.refundId,
            status,
            completedAt: status === 'COMPLETED' ? new Date() : null,
          },
        });
      } catch (e) {
        // The ledger line stands as a liability until ops retries or Paystack confirms; ops is told.
        await this.prisma.refund.update({
          where: { id: refund.id },
          data: { status: 'PROCESSING' },
        });
        await this.alerts.raise({
          type: 'REFUND_GATEWAY_ERROR',
          message: `Paystack did not accept refund ${refund.id}: ${(e as Error).message}`,
          bookingId: b.id,
        });
        status = 'PROCESSING';
      }
    } else {
      // The airline returns the money under its agreement; we track it on the next statement (M5).
      status = 'PROCESSING';
      await this.prisma.refund.update({ where: { id: refund.id }, data: { status } });
    }
    if (full && status === 'COMPLETED')
      await this.bookings.transition(b.id, 'REFUNDED', { role: 'SYSTEM' }, 'refund completed', {
        refundId: refund.id,
      });

    // The traveller's own cancellation message already states the refund.
    if (input.actor.role !== 'SYSTEM')
      await this.messaging.notify('refund.issued', {
        bookingId: b.id,
        extra: { cost: `₦${(refund.amountKobo / 100).toLocaleString('en-NG')}` },
        instance: refund.id,
      });
    await this.audit.record({
      action: 'booking.refund',
      entity: 'Refund',
      entityId: refund.id,
      after: {
        bookingId: b.id,
        amountKobo: refund.amountKobo,
        route,
        status,
        reason: input.reason,
        full,
      },
    });
    return {
      id: refund.id,
      amountKobo: refund.amountKobo,
      route,
      status,
      bookingStatus: (await this.prisma.transferBooking.findUniqueOrThrow({ where: { id: b.id } }))
        .status,
    };
  }

  private async applyRefundEvent(job: PaymentEventJob) {
    const r = job.refundId
      ? await this.prisma.refund.findUnique({ where: { gatewayRefundId: job.refundId } })
      : null;
    if (!r) return { result: 'unknown_refund' };
    if (job.event === 'refund.processed' && r.status !== 'COMPLETED') {
      await this.prisma.refund.update({
        where: { id: r.id },
        data: { status: 'COMPLETED', completedAt: new Date() },
      });
      const { refundableKobo } = await this.refundable(r.bookingId);
      const b = await this.prisma.transferBooking.findUniqueOrThrow({ where: { id: r.bookingId } });
      if (refundableKobo === 0 && b.status === 'REFUNDING')
        await this.bookings.transition(b.id, 'REFUNDED', { role: 'SYSTEM' }, 'refund completed');
      return { result: 'refund_completed' };
    }
    if (job.event === 'refund.failed') {
      await this.alerts.raise({
        type: 'REFUND_FAILED',
        message: `Paystack could not complete refund ${r.id}.`,
        bookingId: r.bookingId,
      });
      return { result: 'refund_failed' };
    }
    return { result: 'no_change' };
  }

  // ---------- reconciliation (PAY-06, PRD 8.5 and 14.7) ----------

  /**
   * 1. Payments still pending: ask Paystack and settle them (the webhook may never have come).
   * 2. The day's Paystack transactions against our records: anything missing or different is
   *    flagged to ops. 3. The ledger must balance.
   */
  async reconcile(
    trigger: 'schedule' | 'ops' | 'system',
    day = lagosParts(new Date(Date.now() - 86_400_000)).date,
  ) {
    const run = await this.prisma.reconciliationRun.create({
      data: { day, trigger, mismatches: [] },
    });
    const mismatches: { kind: string; reference: string; detail: string }[] = [];
    let settled = 0;
    let failed = 0;

    const [checkAfter, abandonAfter] = await Promise.all([
      this.config.get<number>(CONFIG.paymentPendingCheckMinutes),
      this.config.get<number>(CONFIG.paymentAbandonAfterHours),
    ]);
    const pending = await this.prisma.paymentIntent.findMany({
      where: { status: 'PENDING', createdAt: { lt: new Date(Date.now() - checkAfter * 60_000) } },
      take: 500,
    });
    for (const p of pending) {
      const tx = await this.gateway.verify(p.gatewayReference).catch(() => null);
      const old = p.createdAt < new Date(Date.now() - abandonAfter * 3_600_000);
      const r = await this.applyGatewayState(
        p.id,
        tx ??
          (old
            ? {
                reference: p.gatewayReference,
                status: 'abandoned',
                amountKobo: p.amountKobo,
                currency: 'NGN',
                feesKobo: 0,
              }
            : null),
        'reconciliation',
      );
      if (r.result === 'confirmed') settled++;
      if (r.result === 'failed') failed++;
      if (r.result === 'amount_mismatch')
        mismatches.push({
          kind: 'AMOUNT_MISMATCH',
          reference: p.gatewayReference,
          detail: 'Paystack amount differs from ours',
        });
    }

    // Lagos day window [00:00, 24:00) in UTC.
    const from = new Date(`${day}T00:00:00+01:00`);
    const to = new Date(from.getTime() + 86_400_000);
    const gatewayTxns = await this.gateway.listTransactions(from, to);
    const ours = await this.prisma.paymentIntent.findMany({
      where: { createdAt: { gte: from, lt: to } },
    });
    const byRef = new Map(ours.map((o) => [o.gatewayReference, o]));
    for (const g of gatewayTxns) {
      const o = byRef.get(g.reference);
      if (!o) {
        if (g.status === 'success')
          mismatches.push({
            kind: 'MISSING_AT_AIRWHEELS',
            reference: g.reference,
            detail: `Paystack has a successful ${g.amountKobo} kobo payment we have no record of`,
          });
        continue;
      }
      if (g.status === 'success' && o.status !== 'SUCCEEDED')
        mismatches.push({
          kind: 'STATUS_MISMATCH',
          reference: g.reference,
          detail: `Paystack: success, us: ${o.status}`,
        });
      if (g.status === 'success' && g.amountKobo !== o.amountKobo)
        mismatches.push({
          kind: 'AMOUNT_MISMATCH',
          reference: g.reference,
          detail: `Paystack ${g.amountKobo}, us ${o.amountKobo}`,
        });
    }
    const gatewayRefs = new Set(
      gatewayTxns.filter((g) => g.status === 'success').map((g) => g.reference),
    );
    for (const o of ours) {
      if (o.status === 'SUCCEEDED' && !gatewayRefs.has(o.gatewayReference))
        mismatches.push({
          kind: 'MISSING_AT_PAYSTACK',
          reference: o.gatewayReference,
          detail: 'We show it paid; Paystack does not list it as successful',
        });
    }
    const trial = await this.ledger.trialBalance();
    if (!trial.balanced)
      mismatches.push({
        kind: 'LEDGER_UNBALANCED',
        reference: '-',
        detail: `Debits ${trial.debitsKobo}, credits ${trial.creditsKobo}`,
      });

    if (mismatches.length) {
      await this.alerts.raise({
        type: 'PAYMENT_RECONCILIATION_MISMATCH',
        message: `Reconciliation for ${day} found ${mismatches.length} mismatch${mismatches.length > 1 ? 'es' : ''} with Paystack. Open Payments to review.`,
        data: { runId: run.id },
      });
    }
    return this.prisma.reconciliationRun.update({
      where: { id: run.id },
      data: {
        checked: pending.length + gatewayTxns.length,
        settled,
        failed,
        mismatches,
        finishedAt: new Date(),
      },
    });
  }
}
