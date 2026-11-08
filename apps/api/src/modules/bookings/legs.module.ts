import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  Injectable,
  Logger,
  Module,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ApiTags } from '@nestjs/swagger';
import type { LegStatus } from '@prisma/client';
import { z } from 'zod';
import {
  AdminWrite,
  type AuthedRequest,
  RateLimit,
  Roles,
  requireAdmin,
  requireDriver,
} from '../../common/auth/roles';
import { PrismaService } from '../../common/prisma.service';
import { ApiZodBody, ZodPipe } from '../../common/zod';
import { RealtimeGateway } from '../../realtime/realtime.gateway';
import { AuditService } from '../audit/audit.service';
import { ConfigStore } from '../config/config.service';
import { CONFIG } from '../config/keys';
import { MessagingModule, MessagingService } from '../messaging/messaging.module';
import { BookingsModule } from './bookings.module';
import { BookingsService } from './bookings.service';

/** Leg steps the driver presses (PRD 10.5). Ops may correct them (DSP-07). */
const STEP_ORDER: LegStatus[] = [
  'SCHEDULED',
  'ASSIGNED',
  'DRIVER_CONFIRMED',
  'EN_ROUTE',
  'ARRIVED',
  'PICKED_UP',
  'COMPLETED',
];

type Actor = { role: 'OPS' | 'DRIVER' | 'SYSTEM'; id?: string };

/**
 * Leg events and the traveller messages they trigger (TRV-02, PRD 7.1 and 10.5). The driver app (M4)
 * calls the same methods; until then ops assigns drivers and corrects steps from the admin.
 */
@Injectable()
export class LegEventsService {
  private readonly log = new Logger(LegEventsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly messaging: MessagingService,
    private readonly bookings: BookingsService,
    private readonly realtime: RealtimeGateway,
    private readonly config: ConfigStore,
  ) {}

  private async load(legId: string) {
    const leg = await this.prisma.rideLeg.findUnique({
      where: { id: legId },
      include: { booking: true },
    });
    if (!leg) throw new NotFoundException({ code: 'LEG_NOT_FOUND', message: 'No such leg.' });
    return leg;
  }

  /** Assign or reassign a driver and car (ADM-04). */
  async assign(legId: string, driverId: string, vehicleIdIn: string | undefined, actor: Actor) {
    const leg = await this.load(legId);
    if (['COMPLETED', 'CANCELLED', 'NO_SHOW', 'PICKED_UP'].includes(leg.status))
      throw new BadRequestException({
        code: 'LEG_CLOSED',
        message: 'This leg can no longer be assigned.',
      });
    const driver = await this.prisma.driverProfile.findUnique({ where: { id: driverId } });
    if (!driver || driver.status !== 'ACTIVE')
      throw new BadRequestException({
        code: 'DRIVER_NOT_ACTIVE',
        message: 'Only an active driver can take a job.',
      });
    // Default to the car the driver is currently assigned (PRD 2.3: one active vehicle at a time).
    const vehicleId =
      vehicleIdIn ??
      (
        await this.prisma.vehicleAssignment.findFirst({
          where: { driverId, to: null },
          orderBy: { from: 'desc' },
        })
      )?.vehicleId;
    if (!vehicleId)
      throw new BadRequestException({
        code: 'VEHICLE_INVALID',
        message: 'This driver has no car assigned. Choose one.',
      });
    const vehicle = await this.prisma.vehicle.findUnique({ where: { id: vehicleId } });
    if (!vehicle?.active)
      throw new BadRequestException({
        code: 'VEHICLE_INVALID',
        message: 'Choose an active vehicle.',
      });
    const replaced = !!leg.driverId && leg.driverId !== driverId;
    await this.prisma.$transaction(async (tx) => {
      await tx.rideLeg.update({
        where: { id: legId },
        data: { driverId, vehicleId, status: 'ASSIGNED' },
      });
      await tx.bookingEvent.create({
        data: {
          bookingId: leg.bookingId,
          type: replaced ? 'leg.reassigned' : 'leg.assigned',
          actorRole: actor.role,
          actorId: actor.id,
          data: { legId, driverId, vehicleId, previousDriverId: leg.driverId },
        },
      });
    });
    // PRD 10.2: a departure traveller hears about the driver only once the driver confirms.
    // Arrivals are assigned 60 to 90 minutes before landing and go straight out (PRD 7.1).
    if (replaced)
      await this.messaging.notify('driver.replaced', {
        bookingId: leg.bookingId,
        legId,
        instance: driverId,
      });
    else if (leg.type === 'ARRIVAL')
      await this.messaging.notify('arrival.driver_assigned', {
        bookingId: leg.bookingId,
        legId,
        instance: driverId,
      });
    this.realtime.emit(`booking:${leg.bookingId}`, 'leg.updated', { legId, status: 'ASSIGNED' });
    return {
      legId,
      status: 'ASSIGNED',
      travellerMessage: replaced
        ? 'driver.replaced'
        : leg.type === 'ARRIVAL'
          ? 'arrival.driver_assigned'
          : 'after driver confirms',
    };
  }

  /** A trip step (driver press or ops correction), and its traveller message. */
  async step(legId: string, to: LegStatus, actor: Actor, extra: { minutesAway?: number } = {}) {
    const leg = await this.load(legId);
    if (!leg.driverId && to !== 'CANCELLED')
      throw new BadRequestException({ code: 'NO_DRIVER', message: 'Assign a driver first.' });
    const forward = STEP_ORDER.indexOf(to) > STEP_ORDER.indexOf(leg.status);
    if (!forward && actor.role !== 'OPS')
      throw new BadRequestException({
        code: 'LEG_STATE',
        message: `A ${leg.status.toLowerCase()} leg cannot go to ${to.toLowerCase()}.`,
      });
    if (to === 'PICKED_UP' && actor.role === 'DRIVER')
      throw new BadRequestException({
        code: 'PICKUP_CODE_REQUIRED',
        message: 'Start the trip with the pickup code.',
      });
    await this.prisma.$transaction(async (tx) => {
      await tx.rideLeg.update({ where: { id: legId }, data: { status: to } });
      await tx.bookingEvent.create({
        data: {
          bookingId: leg.bookingId,
          type: `leg.${to.toLowerCase()}`,
          actorRole: actor.role,
          actorId: actor.id,
          reason: actor.role === 'OPS' ? 'ops correction' : undefined,
          data: { legId, from: leg.status },
        },
      });
    });
    // Booking state follows its legs (PRD 8.4).
    if (['EN_ROUTE', 'ARRIVED', 'PICKED_UP'].includes(to) && leg.booking.status === 'CONFIRMED')
      await this.bookings.transition(
        leg.bookingId,
        'IN_PROGRESS',
        { role: 'SYSTEM' },
        `leg ${to.toLowerCase()}`,
      );
    if (to === 'COMPLETED') {
      const open = await this.prisma.rideLeg.count({
        where: {
          bookingId: leg.bookingId,
          status: { notIn: ['COMPLETED', 'CANCELLED', 'NO_SHOW'] },
        },
      });
      if (open === 0) {
        if (leg.booking.status === 'CONFIRMED')
          await this.bookings.transition(
            leg.bookingId,
            'IN_PROGRESS',
            { role: 'SYSTEM' },
            'leg completed',
          );
        await this.bookings.transition(
          leg.bookingId,
          'COMPLETED',
          { role: 'SYSTEM' },
          'all legs done',
        );
      }
    }
    const b = leg.bookingId;
    if (to === 'DRIVER_CONFIRMED' && leg.type === 'DEPARTURE')
      await this.messaging.notify('driver.assigned', {
        bookingId: b,
        legId,
        instance: leg.driverId ?? '',
      });
    if (to === 'EN_ROUTE')
      await this.messaging.notify('driver.en_route', {
        bookingId: b,
        legId,
        extra: { minutesAway: String(extra.minutesAway ?? 20) },
      });
    if (to === 'ARRIVED') await this.messaging.notify('driver.arrived', { bookingId: b, legId });
    if (to === 'COMPLETED') await this.messaging.notify('trip.completed', { bookingId: b, legId });
    this.realtime.emit(`booking:${b}`, 'leg.updated', { legId, status: to });
    return { legId, status: to };
  }

  /** Driver location (TRV-04): stored as a trail, pushed live to the traveller on an active leg. */
  async location(
    driverId: string,
    p: { legId?: string; lat: number; lng: number; accuracyM?: number },
  ) {
    let leg = null;
    if (p.legId) {
      leg = await this.prisma.rideLeg.findFirst({ where: { id: p.legId, driverId } });
      if (!leg)
        throw new BadRequestException({ code: 'LEG_INVALID', message: 'That job is not yours.' });
    }
    const ping = await this.prisma.locationPing.create({
      data: {
        driverId,
        legId: leg?.id,
        lat: p.lat,
        lng: p.lng,
        accuracyM: p.accuracyM,
        time: new Date(),
      },
    });
    if (leg && ['EN_ROUTE', 'ARRIVED', 'PICKED_UP'].includes(leg.status))
      this.realtime.emit(`booking:${leg.bookingId}`, 'driver.location', {
        legId: leg.id,
        lat: ping.lat,
        lng: ping.lng,
        at: ping.time.toISOString(),
      });
    return { ok: true };
  }

  /** "Arrival pickup confirmed" goes out a few hours before the inbound flight boards (PRD 7.1). */
  async sendArrivalConfirmations() {
    const t = await this.config.get<{ arrivalConfirmedHoursBeforeDeparture: number }>(
      CONFIG.messagingTimings,
    );
    const until = new Date(Date.now() + t.arrivalConfirmedHoursBeforeDeparture * 3_600_000);
    const legs = await this.prisma.rideLeg.findMany({
      where: {
        type: 'ARRIVAL',
        status: { in: ['SCHEDULED', 'ASSIGNED'] },
        booking: { status: 'CONFIRMED' },
        flight: { snapshots: { some: { scheduledDeparture: { gt: new Date(), lte: until } } } },
      },
      select: { id: true, bookingId: true },
      take: 500,
    });
    for (const l of legs)
      await this.messaging.notify('arrival.confirmed', { bookingId: l.bookingId, legId: l.id });
    return legs.length;
  }
}

@Injectable()
export class ArrivalMessagesSchedule {
  private readonly log = new Logger(ArrivalMessagesSchedule.name);
  constructor(private readonly legs: LegEventsService) {}

  @Cron(CronExpression.EVERY_5_MINUTES)
  async run() {
    if (process.env.JOBS_ENABLED === 'false') return;
    try {
      await this.legs.sendArrivalConfirmations();
    } catch (err) {
      this.log.warn({ err: (err as Error).message }, 'Arrival confirmations failed');
    }
  }
}

const Assign = z.object({ driverId: z.string().uuid(), vehicleId: z.string().uuid().optional() });
const Step = z.object({
  status: z.enum(['DRIVER_CONFIRMED', 'EN_ROUTE', 'ARRIVED', 'PICKED_UP', 'COMPLETED']),
  minutesAway: z.number().int().min(1).max(240).optional(),
  reason: z.string().trim().min(3).max(300),
});
const Location = z.object({
  legId: z.string().uuid().optional(),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  accuracyM: z.number().min(0).max(10_000).optional(),
});

@ApiTags('admin')
@Controller({ path: 'admin/legs', version: '1' })
export class AdminLegsController {
  constructor(
    private readonly legs: LegEventsService,
    private readonly audit: AuditService,
  ) {}

  @Post(':id/assign')
  @HttpCode(200)
  @AdminWrite()
  @ApiZodBody(Assign)
  async assign(
    @Req() req: AuthedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(Assign)) b: z.infer<typeof Assign>,
  ) {
    const admin = requireAdmin(req);
    const r = await this.legs.assign(id, b.driverId, b.vehicleId, {
      role: 'OPS',
      id: admin.userId,
    });
    await this.audit.record({ action: 'leg.assign', entity: 'RideLeg', entityId: id, after: b });
    return r;
  }

  /** Ops corrects a step (DSP-07), with a reason. */
  @Post(':id/status')
  @HttpCode(200)
  @AdminWrite()
  @ApiZodBody(Step)
  async status(
    @Req() req: AuthedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(Step)) b: z.infer<typeof Step>,
  ) {
    const admin = requireAdmin(req);
    const r = await this.legs.step(
      id,
      b.status,
      { role: 'OPS', id: admin.userId },
      { minutesAway: b.minutesAway },
    );
    await this.audit.record({
      action: 'leg.status',
      entity: 'RideLeg',
      entityId: id,
      after: { status: b.status, reason: b.reason },
    });
    return r;
  }
}

@ApiTags('driver')
@Controller({ path: 'driver', version: '1' })
export class DriverLocationController {
  constructor(private readonly legs: LegEventsService) {}

  /** POST /v1/driver/location (PRD 20). The driver app sends this on a job (DRV-14, M4). */
  @Post('location')
  @HttpCode(200)
  @Roles('DRIVER')
  @RateLimit('driverLocation', 'principal')
  @ApiZodBody(Location)
  location(@Req() req: AuthedRequest, @Body(new ZodPipe(Location)) b: z.infer<typeof Location>) {
    return this.legs.location(requireDriver(req).driverId, b);
  }
}

@Module({
  imports: [BookingsModule, MessagingModule],
  controllers: [AdminLegsController, DriverLocationController],
  providers: [LegEventsService, ArrivalMessagesSchedule],
  exports: [LegEventsService],
})
export class LegsModule {}
