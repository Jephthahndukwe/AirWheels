import { Injectable, Logger, Module } from '@nestjs/common';
import type { FlightStatus, Prisma } from '@prisma/client';
import type { PartnerFlightEvent } from '@airwheels/types';
import { z } from 'zod';
import { FlightSegment } from '@airwheels/types';
import { PrismaService } from '../../common/prisma.service';
import { RealtimeGateway } from '../../realtime/realtime.gateway';

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
      this.log.warn({ flight: e.flightNumber, date: e.date }, 'Alert for a flight with no bookings; ignored');
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
    const legs = await this.prisma.rideLeg.findMany({ where: { flightId: flight.id }, select: { bookingId: true } });
    for (const { bookingId } of legs) {
      this.realtime.emit(`booking:${bookingId}`, 'flight.updated', { flightNumber: e.flightNumber, status: snapshot.status });
    }
    this.realtime.emit('ops', 'flight.updated', { flightNumber: e.flightNumber, type: e.type });
    return { accepted: true, matchedBookings: legs.length };
  }
}

@Module({ providers: [FlightsService], exports: [FlightsService] })
export class FlightsModule {}
