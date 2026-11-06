import { Body, Controller, Get, HttpCode, Injectable, Module, NotFoundException, Param, ParseUUIDPipe, Post, Req } from '@nestjs/common';
import { z } from 'zod';
import { ApiTags } from '@nestjs/swagger';
import { OPERATOR_NAME } from '@airwheels/ui';
import { randomToken, sha256 } from '../../common/crypto';
import { PrismaService } from '../../common/prisma.service';
import { AdminWrite, type AuthedRequest, Public, RateLimit, Roles, requireAdmin, requireDriver } from '../../common/auth/roles';
import { ApiZodBody, ZodPipe } from '../../common/zod';
import { MessagingModule } from '../messaging/messaging.module';
import { pickupCodeFor } from './codes';
import { PickupCodesService } from './pickup-codes.service';

/** Tracking links and traveller-facing booking view (ACC-01, TRV-03). Change codes (ACC-02) come in M3. */
@Injectable()
export class TravellerAccessService {
  constructor(private readonly prisma: PrismaService) {}

  /** Returns the plain token once, to put in messages. Only the hash is stored. */
  newToken(expiresAt: Date) {
    const token = randomToken();
    return { token, data: { tokenHash: sha256(token), expiresAt } };
  }

  trackingUrl(token: string) {
    return `${process.env.WEB_PUBLIC_URL ?? 'http://localhost:3000'}/t/${token}`;
  }

  async view(token: string) {
    const row = await this.prisma.trackingToken.findUnique({
      where: { tokenHash: sha256(token) },
      include: {
        booking: {
          include: {
            traveller: true,
            airline: true,
            legs: { include: { flight: { include: { snapshots: { orderBy: { observedAt: 'desc' }, take: 1 } } } } },
          },
        },
      },
    });
    if (!row) throw new NotFoundException({ code: 'TRACKING_LINK_INVALID', message: 'This link is not valid.' });
    const b = row.booking;
    const receiptOnly = row.expiresAt < new Date();
    return {
      bookingId: b.id,
      status: b.status,
      receiptOnly,
      serviceName: b.airline?.serviceBrandName ?? 'Airwheels',
      operator: OPERATOR_NAME,
      travellerFirstName: b.traveller?.name.split(' ')[0] ?? '',
      plan: b.plan,
      rideType: b.rideType,
      amountKobo: b.amountKobo,
      legs: b.legs.map((l) => ({
        id: l.id,
        type: l.type,
        status: l.status,
        pickup: l.pickupText,
        dropoff: l.dropoffText,
        scheduledAt: l.scheduledAt,
        pickupCode: receiptOnly ? null : pickupCodeFor(l.id, l.pickupCodeVersion),
        stopNumber: l.stopNumber,
        flight: l.flight
          ? {
              number: l.flight.flightNumber,
              date: l.flight.date,
              status: l.flight.snapshots[0]?.status ?? 'SCHEDULED',
              estimatedDeparture: l.flight.snapshots[0]?.estimatedDeparture ?? l.flight.snapshots[0]?.scheduledDeparture,
              estimatedArrival: l.flight.snapshots[0]?.estimatedArrival ?? l.flight.snapshots[0]?.scheduledArrival,
            }
          : null,
      })),
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
  check(@Req() req: AuthedRequest, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(PickupCodeEntry)) body: z.infer<typeof PickupCodeEntry>) {
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
