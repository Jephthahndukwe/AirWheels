import { Controller, Get, HttpCode, Injectable, Module, NotFoundException, Param, Post, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { OPERATOR_NAME } from '@airwheels/ui';
import { randomToken, sha256 } from '../../common/crypto';
import { PrismaService } from '../../common/prisma.service';
import { DevOnlyGuard } from '../admin/dev-only.guard';
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
  view(@Param('token') token: string) {
    return this.access.view(token);
  }
}

/** Ops reissue a pickup code (new version, attempts reset). Behind admin auth in M1. */
@ApiTags('admin')
@UseGuards(DevOnlyGuard)
@Controller({ path: 'admin/legs', version: '1' })
export class AdminPickupCodeController {
  constructor(private readonly codes: PickupCodesService) {}

  @Post(':id/pickup-code/reissue')
  @HttpCode(200)
  reissue(@Param('id') id: string) {
    return this.codes.reissue(id);
  }
}

@Module({
  controllers: [TrackingController, AdminPickupCodeController],
  providers: [TravellerAccessService, PickupCodesService],
  exports: [TravellerAccessService, PickupCodesService],
})
export class TravellerAccessModule {}
