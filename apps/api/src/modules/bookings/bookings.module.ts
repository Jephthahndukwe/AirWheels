import { Processor, WorkerHost } from '@nestjs/bullmq';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Injectable,
  Logger,
  Module,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ApiTags } from '@nestjs/swagger';
import type { BookingStatus } from '@prisma/client';
import type { Job } from 'bullmq';
import { z } from 'zod';
import { AdminRead, AdminWrite, type AuthedRequest, requireAdmin } from '../../common/auth/roles';
import { ApiZodBody, ZodPipe } from '../../common/zod';
import { QUEUES } from '../../queues/queues';
import { AuditService } from '../audit/audit.service';
import { DispatchModule } from '../dispatch/dispatch.module';
import { FlightsModule } from '../flights/flights.module';
import { MessagingModule } from '../messaging/messaging.module';
import { PricingModule } from '../pricing/pricing.module';
import { TravellerAccessModule } from '../traveller-access/traveller-access.module';
import { type AfterConfirmJob, BookingStepsService } from './booking-steps';
import { BookingsService } from './bookings.service';

const STATUSES: BookingStatus[] = [
  'QUOTED',
  'PENDING_PAYMENT',
  'CONFIRMED',
  'IN_PROGRESS',
  'COMPLETED',
  'PAYMENT_FAILED',
  'REJECTED',
  'CANCELLING',
  'CANCELLED',
  'REFUNDING',
  'REFUNDED',
];
const Cancel = z.object({ reason: z.string().trim().min(3).max(500) });

/** Bookings in the admin (ADM-05, ADM-06, BKG-08). */
@ApiTags('admin')
@Controller({ path: 'admin/bookings', version: '1' })
export class AdminBookingsController {
  constructor(
    private readonly bookings: BookingsService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  @AdminRead()
  list(@Query('limit') limit?: string, @Query('q') q?: string, @Query('status') status?: string) {
    return this.bookings.list({
      limit: Math.min(Number(limit) || 50, 200),
      search: q,
      status: STATUSES.find((s) => s === status),
    });
  }

  @Get('stuck')
  @AdminRead()
  stuck() {
    return this.bookings.stuck();
  }

  @Get(':id')
  @AdminRead()
  detail(@Param('id', ParseUUIDPipe) id: string) {
    return this.bookings.detail(id);
  }

  @Post(':id/retry')
  @HttpCode(200)
  @AdminWrite()
  async retry(@Param('id', ParseUUIDPipe) id: string) {
    const r = await this.bookings.retry(id);
    await this.audit.record({
      action: 'booking.retry_steps',
      entity: 'TransferBooking',
      entityId: id,
    });
    return r;
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @AdminWrite()
  @ApiZodBody(Cancel)
  async cancel(
    @Req() req: AuthedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(Cancel)) body: z.infer<typeof Cancel>,
  ) {
    const before = await this.bookings.detail(id);
    const after = await this.bookings.cancelById(
      id,
      { role: 'OPS', id: requireAdmin(req).userId },
      body.reason,
    );
    await this.audit.record({
      action: 'booking.cancel',
      entity: 'TransferBooking',
      entityId: id,
      before: { status: before.status },
      after: { status: after.status, reason: body.reason },
    });
    return { id, status: after.status };
  }
}

/** Runs the after-confirm steps (ledger, confirmation message) with BullMQ retries. */
@Processor(QUEUES.bookings)
export class BookingsProcessor extends WorkerHost {
  constructor(private readonly bookings: BookingsService) {
    super();
  }

  async process(job: Job<AfterConfirmJob>) {
    return this.bookings.runAfterConfirm(job.data.bookingId);
  }
}

/** Catches anything the queue missed, every minute (PRD 8.6, DSP-05). */
@Injectable()
export class BookingsSweeper {
  private readonly log = new Logger(BookingsSweeper.name);

  constructor(private readonly bookings: BookingsService) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async sweep() {
    if (process.env.JOBS_ENABLED === 'false') return;
    try {
      await this.bookings.sweep();
    } catch (err) {
      this.log.warn({ err: (err as Error).message }, 'Booking sweep failed');
    }
  }
}

@Module({
  imports: [FlightsModule, MessagingModule, PricingModule, TravellerAccessModule, DispatchModule],
  controllers: [AdminBookingsController],
  providers: [BookingsService, BookingStepsService, BookingsProcessor, BookingsSweeper],
  exports: [BookingsService, BookingStepsService],
})
export class BookingsModule {}
