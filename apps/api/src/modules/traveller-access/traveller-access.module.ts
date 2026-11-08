import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Injectable,
  Module,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
} from '@nestjs/common';
import { z } from 'zod';
import { ApiTags } from '@nestjs/swagger';
import { OPERATOR_NAME } from '@airwheels/ui';
import { randomToken, sha256 } from '../../common/crypto';
import { MAPS, type MapsAdapter } from '../../adapters/interfaces';
import { PrismaService } from '../../common/prisma.service';
import { ConfigStore } from '../config/config.service';
import { CONFIG } from '../config/keys';
import {
  AdminWrite,
  type AuthedRequest,
  Public,
  RateLimit,
  Roles,
  requireAdmin,
  requireDriver,
} from '../../common/auth/roles';
import { ApiZodBody, ZodPipe } from '../../common/zod';
import { MessagingModule } from '../messaging/messaging.module';
import { pickupCodeFor } from './codes';
import { PickupCodesService } from './pickup-codes.service';

/**
 * Tracking links and the traveller's view of their booking (ACC-01, TRV-03, TRV-04).
 * The page carries only what this traveller needs: first names, their own pickup code, and for
 * shared rides their stop number and the driver's progress (PRD 11.9), never other travellers'
 * addresses, phones or codes.
 */
@Injectable()
export class TravellerAccessService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigStore,
    @Inject(MAPS) private readonly maps: MapsAdapter,
  ) {}

  /** Returns the plain token once, to put in messages. Only the hash is stored. */
  newToken(expiresAt: Date) {
    const token = randomToken();
    return { token, data: { tokenHash: sha256(token), expiresAt } };
  }

  trackingUrl(token: string) {
    return `${process.env.WEB_PUBLIC_URL ?? 'http://localhost:3000'}/t/${token}`;
  }

  /** The booking a tracking token opens, or 404. `receiptOnly` once the link has expired (5.1). */
  async resolve(token: string) {
    if (!/^[A-Za-z0-9_-]{16,128}$/.test(token))
      throw new NotFoundException({
        code: 'TRACKING_LINK_INVALID',
        message: 'This link is not valid.',
      });
    const row = await this.prisma.trackingToken.findUnique({ where: { tokenHash: sha256(token) } });
    if (!row)
      throw new NotFoundException({
        code: 'TRACKING_LINK_INVALID',
        message: 'This link is not valid.',
      });
    return {
      bookingId: row.bookingId,
      receiptOnly: row.expiresAt < new Date(),
      expiresAt: row.expiresAt,
    };
  }

  async view(token: string) {
    const { bookingId, receiptOnly } = await this.resolve(token);
    const b = await this.prisma.transferBooking.findUniqueOrThrow({
      where: { id: bookingId },
      include: {
        traveller: true,
        airline: { include: { themes: { orderBy: { createdAt: 'desc' }, take: 1 } } },
        refunds: { where: { status: { not: 'FAILED' } } },
        replies: { orderBy: { time: 'desc' }, take: 5 },
        legs: {
          orderBy: { type: 'asc' },
          include: {
            driver: true,
            vehicle: true,
            ratings: true,
            flight: { include: { snapshots: { orderBy: { observedAt: 'desc' }, take: 1 } } },
            group: { include: { stops: { orderBy: { order: 'asc' } } } },
          },
        },
      },
    });
    const support = await this.config.get<{ phone: string; whatsapp: string }>(
      CONFIG.travellerSupport,
    );
    const legs = await Promise.all(
      b.legs.map(async (l) => {
        const live = ['EN_ROUTE', 'ARRIVED', 'PICKED_UP'].includes(l.status);
        const ping =
          live && l.driverId
            ? await this.prisma.locationPing.findFirst({
                where: { legId: l.id },
                orderBy: { time: 'desc' },
              })
            : null;
        const target =
          l.status === 'PICKED_UP'
            ? { lat: l.dropoffLat, lng: l.dropoffLng }
            : { lat: l.pickupLat, lng: l.pickupLng };
        const etaMinutes =
          ping && l.status !== 'ARRIVED'
            ? await this.maps
                .travelTimeMinutes({ lat: ping.lat, lng: ping.lng }, target, new Date())
                .catch(() => null)
            : null;
        const snap = l.flight?.snapshots[0];
        const stops = l.group?.stops ?? [];
        const myStop = stops.find((s) => s.legId === l.id);
        return {
          id: l.id,
          type: l.type,
          status: l.status,
          rideType: l.rideType,
          pickup: l.pickupText,
          pickupLandmark: l.pickupLandmark,
          dropoff: l.dropoffText,
          dropoffLandmark: l.dropoffLandmark,
          pickupPoint: { lat: l.pickupLat, lng: l.pickupLng },
          dropoffPoint: { lat: l.dropoffLat, lng: l.dropoffLng },
          scheduledAt: l.scheduledAt,
          amountKobo: l.amountKobo,
          // The traveller's own code, from this leg's current version (ACC-03, ACC-10).
          pickupCode:
            receiptOnly || ['COMPLETED', 'CANCELLED'].includes(l.status)
              ? null
              : pickupCodeFor(l.id, l.pickupCodeVersion),
          pickupCodeLocked: !!l.pickupCodeLockedAt,
          driver:
            l.driver && l.status !== 'SCHEDULED'
              ? {
                  firstName: l.driver.firstName,
                  photoUrl: l.driver.photoUrl,
                  rating: l.driver.ratingAvg,
                  car: l.vehicle ? `${l.vehicle.brand} ${l.vehicle.model}` : null,
                  colour: l.vehicle?.colour ?? null,
                  plate: l.vehicle?.plate ?? null,
                }
              : null,
          live: live
            ? {
                location: ping ? { lat: ping.lat, lng: ping.lng, at: ping.time } : null,
                etaMinutes,
              }
            : null,
          shared:
            l.rideType === 'SHARED'
              ? {
                  stopNumber: myStop?.order ?? l.stopNumber,
                  stopCount: stops.length || null,
                  // Only progress through earlier stops, never who or where they are.
                  stopsDone: stops.filter(
                    (s) => (myStop ? s.order < myStop.order : false) && !!s.actualTime,
                  ).length,
                  plannedTime: myStop?.plannedTime ?? l.scheduledAt,
                }
              : null,
          flight: l.flight
            ? {
                number: l.flight.flightNumber,
                date: l.flight.date,
                status: snap?.status ?? 'SCHEDULED',
                estimatedDeparture: snap?.estimatedDeparture ?? snap?.scheduledDeparture ?? null,
                estimatedArrival: snap?.estimatedArrival ?? snap?.scheduledArrival ?? null,
              }
            : null,
          rating: l.ratings[0] ? { score: l.ratings[0].score } : null,
        };
      }),
    );
    const theme = b.airline?.themes[0];
    return {
      bookingId: b.id,
      reference: b.airlineBookingReference,
      status: b.status,
      receiptOnly,
      serviceName: b.airline?.serviceBrandName ?? 'Airwheels',
      theme: theme
        ? { primary: (theme.colours as { primary?: string } | null)?.primary ?? null }
        : null,
      operator: OPERATOR_NAME,
      travellerFirstName: b.traveller?.name.trim().split(/\s+/)[0] ?? '',
      plan: b.plan,
      rideType: b.rideType,
      amountKobo: b.amountKobo,
      refundedKobo: b.refunds.reduce((s, r) => s + r.amountKobo, 0),
      collectedBy: b.collectedBy,
      bookedAt: b.createdAt,
      support: { phone: support.phone, whatsapp: support.whatsapp },
      lastReply: b.replies[0] ? { intent: b.replies[0].mappedIntent, at: b.replies[0].time } : null,
      legs,
    };
  }
}

@ApiTags('traveller')
@Controller({ path: 't', version: '1' })
export class TrackingController {
  constructor(private readonly access: TravellerAccessService) {}

  /** GET /v1/t/:token — tracking page data. */
  @Get(':token')
  @Public()
  @RateLimit('trackingPage')
  view(@Param('token') token: string) {
    return this.access.view(token);
  }
}

const PickupCodeEntry = z.object({ code: z.string().regex(/^\d{4}$/) });

/** Ops reissue a pickup code (ACC-10): new version, lock and attempts cleared, traveller sent the new code. */
@ApiTags('admin')
@Controller({ path: 'admin/legs', version: '1' })
export class AdminPickupCodeController {
  constructor(private readonly codes: PickupCodesService) {}

  @Post(':id/pickup-code/reissue')
  @HttpCode(200)
  @AdminWrite()
  reissue(@Req() req: AuthedRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.codes.reissue(id, requireAdmin(req).userId);
  }
}

/** The assigned driver enters the traveller's code before Start trip (DSP-08, DRV-07). */
@ApiTags('driver')
@Controller({ path: 'driver/legs', version: '1' })
export class DriverPickupCodeController {
  constructor(private readonly codes: PickupCodesService) {}

  @Post(':id/pickup-code')
  @HttpCode(200)
  @Roles('DRIVER')
  @RateLimit('pickupCode', 'principal')
  @ApiZodBody(PickupCodeEntry)
  check(
    @Req() req: AuthedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(PickupCodeEntry)) body: z.infer<typeof PickupCodeEntry>,
  ) {
    return this.codes.verify(id, body.code, requireDriver(req).driverId);
  }
}

@Module({
  imports: [MessagingModule],
  controllers: [TrackingController, AdminPickupCodeController, DriverPickupCodeController],
  providers: [TravellerAccessService, PickupCodesService],
  exports: [TravellerAccessService, PickupCodesService],
})
export class TravellerAccessModule {}
