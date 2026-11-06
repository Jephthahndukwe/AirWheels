import { Processor, WorkerHost } from '@nestjs/bullmq';
import {
  Body,
  Controller,
  Get,
  Global,
  Headers,
  HttpCode,
  Inject,
  Injectable,
  Logger,
  Module,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';
import type { Job } from 'bullmq';
import { z } from 'zod';
import { PAYMENTS, type PaymentsAdapter } from '../../adapters/interfaces';
import { FakePayments } from '../../adapters/fakes';
import { PrismaService } from '../../common/prisma.service';
import { fakeProvidersAllowed } from '../../common/env';
import { AdminRead, AdminWrite, type AuthedRequest, Public, RateLimit, Roles, requireAdmin } from '../../common/auth/roles';
import { ApiZodBody, ZodPipe } from '../../common/zod';
import { QUEUES } from '../../queues/queues';
import { BookingsModule } from '../bookings/bookings.module';
import { ConfigStore } from '../config/config.service';
import { CONFIG } from '../config/keys';
import { lagosParts } from '../dispatch/dispatch.module';
import { LedgerService } from './ledger.service';
import { type PaymentEventJob, PaymentsService } from './payments.service';

/** Background jobs are on unless JOBS_ENABLED=false (the route-access test turns them off). */
export const jobsEnabled = () => process.env.JOBS_ENABLED !== 'false';

/** Paystack webhooks (PAY-02). Public: the HMAC signature over the raw body is the access check. */
@ApiTags('webhooks')
@Controller({ path: 'webhooks', version: '1' })
export class PaymentWebhookController {
  constructor(private readonly payments: PaymentsService) {}

  @Post('payments')
  @HttpCode(200)
  @Public()
  @RateLimit('webhooks')
  receive(@Req() req: AuthedRequest, @Headers('x-paystack-signature') signature?: string) {
    return this.payments.receiveWebhook(req.rawBody, signature);
  }
}

const FakeComplete = z.object({ outcome: z.enum(['success', 'failed']) });

/**
 * The fake checkout page's "Pay" button (development and tests only, ACC-12). It settles the fake
 * transaction and feeds the exact webhook Paystack would send through the real handler.
 */
@ApiTags('dev')
@Controller({ path: 'dev/fake-paystack', version: '1' })
export class FakePaystackController {
  constructor(
    private readonly payments: PaymentsService,
    @Inject(PAYMENTS) private readonly gateway: PaymentsAdapter,
  ) {}

  @Post(':reference/complete')
  @HttpCode(200)
  @Public()
  @ApiExcludeEndpoint()
  async complete(@Param('reference') reference: string, @Body(new ZodPipe(FakeComplete)) body: z.infer<typeof FakeComplete>) {
    if (!fakeProvidersAllowed() || !(this.gateway instanceof FakePayments)) throw new NotFoundException();
    const hook = this.gateway.complete(reference, body.outcome);
    if (!hook) throw new NotFoundException({ code: 'REFERENCE_UNKNOWN', message: 'No such fake payment.' });
    return this.payments.receiveWebhook(hook.rawBody, hook.signature);
  }
}

const Refund = z.object({
  amountKobo: z.number().int().positive(),
  reason: z.string().trim().min(3).max(500),
  legId: z.string().uuid().optional(),
});

/** Payments, refunds, ledger and reconciliation in the admin (PRD 17.1). Finance reads. */
@ApiTags('admin')
@Controller({ path: 'admin', version: '1' })
export class AdminPaymentsController {
  constructor(
    private readonly payments: PaymentsService,
    private readonly ledger: LedgerService,
    private readonly prisma: PrismaService,
  ) {}

  @Post('bookings/:id/refunds')
  @AdminWrite()
  @ApiZodBody(Refund)
  refund(@Req() req: AuthedRequest, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(Refund)) body: z.infer<typeof Refund>) {
    const a = requireAdmin(req);
    return this.payments.refund({ bookingId: id, ...body, actor: { userId: a.userId, role: a.role } });
  }

  @Get('bookings/:id/refundable')
  @AdminRead()
  async refundable(@Param('id', ParseUUIDPipe) id: string) {
    const r = await this.payments.refundable(id);
    return { paidKobo: r.paidKobo, refundedKobo: r.refundedKobo, refundableKobo: r.refundableKobo };
  }

  @Get('payments')
  @AdminRead()
  async list(@Query('status') status?: string) {
    const s = ['PENDING', 'SUCCEEDED', 'FAILED', 'ABANDONED'].includes(status ?? '') ? (status as 'PENDING') : undefined;
    const [intents, runs] = await Promise.all([
      this.prisma.paymentIntent.findMany({
        where: s ? { status: s } : {},
        orderBy: { createdAt: 'desc' },
        take: 100,
        select: {
          id: true,
          gatewayReference: true,
          amountKobo: true,
          status: true,
          gatewayFeeKobo: true,
          paidAt: true,
          createdAt: true,
          booking: { select: { id: true, airlineBookingReference: true, status: true } },
        },
      }),
      this.prisma.reconciliationRun.findMany({ orderBy: { createdAt: 'desc' }, take: 20 }),
    ]);
    return { gateway: this.payments.gatewayMode, intents, reconciliation: runs };
  }

  @Post('payments/reconcile')
  @HttpCode(200)
  @AdminWrite()
  reconcile(@Body() body: { day?: string }) {
    const day = typeof body?.day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.day) ? body.day : undefined;
    return this.payments.reconcile('ops', day);
  }

  @Get('ledger/balances')
  @AdminRead()
  async balances() {
    return { accounts: await this.ledger.balances(), trialBalance: await this.ledger.trialBalance() };
  }
}

/** Reconciliation for background callers holding SYSTEM_API_TOKEN. */
@ApiTags('system')
@Controller({ path: 'system/payments', version: '1' })
export class SystemPaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Post('reconcile')
  @HttpCode(200)
  @Roles('SYSTEM')
  reconcile() {
    return this.payments.reconcile('system');
  }
}

@Processor(QUEUES.payments)
export class PaymentsProcessor extends WorkerHost {
  constructor(private readonly payments: PaymentsService) {
    super();
  }

  async process(job: Job<PaymentEventJob>) {
    return this.payments.process(job.data);
  }
}

/** Daily reconciliation at the configured Lagos hour, once per day. */
@Injectable()
export class PaymentsSchedule {
  private readonly log = new Logger(PaymentsSchedule.name);

  constructor(
    private readonly payments: PaymentsService,
    private readonly config: ConfigStore,
    private readonly prisma: PrismaService,
  ) {}

  @Cron(CronExpression.EVERY_10_MINUTES)
  async maybeReconcile() {
    if (!jobsEnabled()) return;
    try {
      const now = lagosParts(new Date());
      if (now.hour !== (await this.config.get<number>(CONFIG.reconciliationHour))) return;
      const day = lagosParts(new Date(Date.now() - 86_400_000)).date;
      const done = await this.prisma.reconciliationRun.findFirst({ where: { day, trigger: 'schedule' } });
      if (done) return;
      await this.payments.reconcile('schedule', day);
    } catch (err) {
      this.log.error({ err: (err as Error).message }, 'Scheduled reconciliation failed');
    }
  }
}

@Global()
@Module({ providers: [LedgerService], exports: [LedgerService] })
export class LedgerModule {}

@Module({
  imports: [BookingsModule],
  controllers: [PaymentWebhookController, FakePaystackController, AdminPaymentsController, SystemPaymentsController],
  providers: [PaymentsService, PaymentsProcessor, PaymentsSchedule],
  exports: [PaymentsService],
})
export class PaymentsModule {}
