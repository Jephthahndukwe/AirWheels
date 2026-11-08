import { Injectable, Logger, Module } from '@nestjs/common';
import type { FlightStatus, Prisma } from '@prisma/client';
import type { PartnerFlightEvent } from '@airwheels/types';
import { z } from 'zod';
import { FlightSegment } from '@airwheels/types';
import { PrismaService } from '../../common/prisma.service';
import { RealtimeGateway } from '../../realtime/realtime.gateway';
import { MessagingModule, MessagingService } from '../messaging/messaging.module';

type Segment = z.infer<typeof FlightSegment>;

const statusFor: Record<PartnerFlightEvent['type'], FlightStatus> = {
  TIME_SHIFTED: 'DELAYED',
  CANCELLED: 'CANCELLED',
  DIVERTED: 'DIVERTED',
  REBOOKED: 'SCHEDULED',
  DEPARTED: 'DEPARTED',
  LANDED: 'LANDED',
};

/**
 * Flight records and append-only snapshots (PRD 9). Airline alerts carry HIGH confidence.
 * The backup watcher, change detection and policy hand-off come in M7.
 */
@Injectable()
export class FlightsService {
  private readonly log = new Logger(FlightsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeGateway,
    private readonly messaging: MessagingService,
  ) {}

  async upsertFromSegment(tx: Prisma.TransactionClient, seg: Segment, airlineCode: string) {
    const flight = await tx.flightRecord.upsert({
      where: { flightNumber_date: { flightNumber: seg.flightNumber, date: seg.date } },
      update: {},
      create: {
        flightNumber: seg.flightNumber,
        date: seg.date,
        airlineCode,
        origin: seg.origin,
        destination: seg.destination,
      },
    });
    const existing = await tx.flightSnapshot.count({ where: { flightId: flight.id } });
    if (existing === 0) {
      await tx.flightSnapshot.create({
        data: {
          flightId: flight.id,
          scheduledDeparture: new Date(seg.scheduledDeparture),
          scheduledArrival: new Date(seg.scheduledArrival),
          status: 'SCHEDULED',
          terminal: seg.terminal,
          source: 'AIRLINE',
          confidence: 'HIGH',
          observedAt: new Date(),
        },
      });
    }
    return flight;
  }

  async recordAirlineEvent(e: PartnerFlightEvent) {
    const flight = await this.prisma.flightRecord.findUnique({
      where: { flightNumber_date: { flightNumber: e.flightNumber, date: e.date } },
      include: { snapshots: { orderBy: { observedAt: 'desc' }, take: 1 } },
    });
    if (!flight) {
      this.log.warn(
        { flight: e.flightNumber, date: e.date },
        'Alert for a flight with no bookings; ignored',
      );
      return { accepted: true, matchedBookings: 0 };
    }
    const prev = flight.snapshots[0];
    const toDate = (s?: string) => (s ? new Date(s) : undefined);
    const snapshot = await this.prisma.flightSnapshot.create({
      data: {
        flightId: flight.id,
        scheduledDeparture: prev?.scheduledDeparture,
        scheduledArrival: prev?.scheduledArrival,
        estimatedDeparture: toDate(e.estimatedDeparture) ?? prev?.estimatedDeparture,
        estimatedArrival: toDate(e.estimatedArrival) ?? prev?.estimatedArrival,
        actualDeparture: toDate(e.actualDeparture) ?? prev?.actualDeparture,
        actualArrival: toDate(e.actualArrival) ?? prev?.actualArrival,
        status: statusFor[e.type],
        terminal: e.terminal ?? prev?.terminal,
        source: 'AIRLINE',
        confidence: 'HIGH',
        rawPayload: e as object,
        observedAt: new Date(e.occurredAt),
      },
    });
    const legs = await this.prisma.rideLeg.findMany({
      where: { flightId: flight.id, status: { notIn: ['CANCELLED', 'COMPLETED', 'NO_SHOW'] } },
      select: { id: true, bookingId: true, type: true, booking: { select: { status: true } } },
    });
    // Traveller messages (PRD 7.1): welcome on landing, change notice on a delay or cancellation.
    // Pickup times and fees move with the policy engine in M7; until then ops handles the options.
    const reason: Partial<Record<PartnerFlightEvent['type'], string>> = {
      TIME_SHIFTED: 'delayed',
      CANCELLED: 'cancelled',
      DIVERTED: 'diverted',
      REBOOKED: 'rebooked',
    };
    for (const leg of legs) {
      if (!['CONFIRMED', 'IN_PROGRESS'].includes(leg.booking.status)) continue;
      const instance = `${e.type}${new Date(e.occurredAt).getTime()}`;
      if (e.type === 'LANDED' && leg.type === 'ARRIVAL')
        await this.messaging.notify('flight.landed', { bookingId: leg.bookingId, legId: leg.id });
      else if (reason[e.type])
        await this.messaging.notify('flight.changed', {
          bookingId: leg.bookingId,
          legId: leg.id,
          instance,
          extra: {
            reason: reason[e.type]!,
            options:
              e.type === 'CANCELLED'
                ? 'You can cancel free or move to your new flight.'
                : 'We will move your pickup to match.',
            cost: 'none',
          },
        });
    }
    for (const { bookingId } of legs) {
      this.realtime.emit(`booking:${bookingId}`, 'flight.updated', {
        flightNumber: e.flightNumber,
        status: snapshot.status,
      });
    }
    this.realtime.emit('ops', 'flight.updated', { flightNumber: e.flightNumber, type: e.type });
    return { accepted: true, matchedBookings: legs.length };
  }
}

@Module({ imports: [MessagingModule], providers: [FlightsService], exports: [FlightsService] })
export class FlightsModule {}
