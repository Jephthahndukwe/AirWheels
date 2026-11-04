import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { Airline, BookingChannel, CollectedBy } from '@prisma/client';
import type { PartnerBookingRequest, PartnerBookingUpdate } from '@airwheels/types';
import { MAPS, type MapsAdapter } from '../../adapters/interfaces';
import { track } from '../../common/observability';
import { PrismaService } from '../../common/prisma.service';
import { RealtimeGateway } from '../../realtime/realtime.gateway';
import { ConfigStore } from '../config/config.service';
import { CONFIG } from '../config/keys';
import { LAGOS_UTC_OFFSET_MINUTES, departurePickupTime } from '../dispatch/timing';
import { FlightsService } from '../flights/flights.module';
import { MessagingService } from '../messaging/messaging.module';
import { PricingService } from '../pricing/pricing.service';
import { pickupCodeFor, pickupCodeHash } from '../traveller-access/codes';
import { TravellerAccessService } from '../traveller-access/traveller-access.module';

/**
 * TransferBooking aggregate (PRD 8). One parent record per airline booking reference,
 * up to two ride legs. Every state change writes a BookingEvent.
 */
@Injectable()
export class BookingsService {
  private readonly log = new Logger(BookingsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigStore,
    private readonly flights: FlightsService,
    private readonly access: TravellerAccessService,
    private readonly messaging: MessagingService,
    private readonly pricing: PricingService,
    private readonly realtime: RealtimeGateway,
    @Inject(MAPS) private readonly maps: MapsAdapter,
  ) {}

  /** PRD 8.3 steps 3 to 5: check the quote, create booking and legs, then notify. */
  async create(input: {
    airline: Airline | null;
    channel: BookingChannel;
    collectedBy: CollectedBy;
    payload: PartnerBookingRequest;
  }) {
    const { airline, payload } = input;
    const { flagged, reason, quote } = await this.checkQuote(payload);

    const pickupTimes = await Promise.all(payload.legs.map((leg) => this.pickupTimeFor(leg)));
    const lastLegEnd = Math.max(...payload.legs.map((l) => new Date(l.flight.scheduledArrival).getTime()));
    const linkHours = await this.config.get<number>(CONFIG.trackingLinkHoursAfterLastLeg);
    const { token, data: tokenData } = this.access.newToken(new Date(lastLegEnd + linkHours * 3_600_000));
    const vehicleClass = this.pricing.suggestVehicleClass(payload.passengers, payload.bags);
    const legAmounts = (quote?.breakdown as { legs?: { amountKobo: number }[] } | null)?.legs;

    const booking = await this.prisma.$transaction(async (tx) => {
      const b = await tx.transferBooking.create({
        data: {
          airlineId: airline?.id,
          channel: input.channel,
          airlineBookingReference: payload.airlineBookingReference,
          plan: payload.plan,
          rideType: payload.rideType,
          status: 'CONFIRMED',
          quoteId: quote?.id,
          quoteSnapshot: (quote?.breakdown as object) ?? undefined,
          pricingRuleVersion: quote?.pricingRuleVersion,
          collectedBy: input.collectedBy,
          amountKobo: payload.paidAmountKobo,
          airlineShareKobo: Math.round((payload.paidAmountKobo * (airline?.revenueShareBps ?? 0)) / 10_000),
          passengers: payload.passengers,
          bags: payload.bags,
          flaggedForOps: flagged,
          flagReason: reason,
          rawPayload: redact(payload),
          traveller: { create: payload.traveller },
          trackingToken: { create: tokenData },
        },
      });
      if (quote) await tx.quote.update({ where: { id: quote.id }, data: { lockedAt: new Date() } });

      for (const [i, leg] of payload.legs.entries()) {
        const flight = await this.flights.upsertFromSegment(tx, leg.flight, airline?.code ?? 'XX');
        const created = await tx.rideLeg.create({
          data: {
            bookingId: b.id,
            type: leg.type,
            rideType: payload.rideType,
            pickupText: leg.pickup.text,
            pickupLat: leg.pickup.location.lat,
            pickupLng: leg.pickup.location.lng,
            pickupLandmark: leg.pickup.landmark,
            dropoffText: leg.dropoff.text,
            dropoffLat: leg.dropoff.location.lat,
            dropoffLng: leg.dropoff.location.lng,
            dropoffLandmark: leg.dropoff.landmark,
            flightId: flight.id,
            scheduledAt: pickupTimes[i],
            nextActionAt: pickupTimes[i],
            vehicleClass,
            amountKobo: legAmounts?.[i]?.amountKobo ?? Math.round(payload.paidAmountKobo / payload.legs.length),
            pickupCodeHash: 'pending',
          },
        });
        await tx.rideLeg.update({
          where: { id: created.id },
          data: { pickupCodeHash: pickupCodeHash(created.id, 1, pickupCodeFor(created.id, 1)) },
        });
      }

      await tx.bookingEvent.create({
        data: {
          bookingId: b.id,
          type: 'booking.confirmed',
          actorRole: 'SYSTEM',
          reason: flagged ? reason : undefined,
          data: { channel: input.channel },
        },
      });
      return tx.transferBooking.findUniqueOrThrow({ where: { id: b.id }, include: { legs: true } });
    });

    // The booking is committed. A queue failure must not turn into an error for a paid traveller (8.5):
    // log it for ops. The DSP-05 sweeper and an outbox retry it in M3/M4.
    await this.messaging.enqueueTraveller({
      bookingId: booking.id,
      event: 'booking.confirmed',
      to: payload.traveller.phone,
      whatsapp: payload.traveller.whatsapp,
      variables: {
        serviceName: airline?.serviceBrandName ?? 'Airwheels',
        trackingUrl: this.access.trackingUrl(token),
        pickupCodes: booking.legs.map((l) => pickupCodeFor(l.id, l.pickupCodeVersion)).join(' / '),
      },
    }).catch((err: unknown) => {
      this.log.error({ bookingId: booking.id, err }, 'Could not queue the confirmation message');
    });
    this.realtime.emit('ops', 'booking.created', { bookingId: booking.id });
    track('airline booking confirmed', booking.id, {
      booking_id: booking.id,
      airline: airline?.code,
      channel: input.channel,
      plan: payload.plan,
    });

    return booking;
  }

  /** PRD 8.5: never reject a paid traveller. Accept and flag when the quote is missing, expired or off. */
  private async checkQuote(payload: PartnerBookingRequest) {
    if (!payload.quoteId) return { flagged: true, reason: 'NO_QUOTE', quote: null };
    const quote = await this.prisma.quote.findUnique({ where: { id: payload.quoteId } });
    if (!quote) return { flagged: true, reason: 'UNKNOWN_QUOTE', quote: null };
    const tolerancePct = await this.config.get<number>(CONFIG.quoteTolerancePct);
    const diffPct = (Math.abs(quote.totalKobo - payload.paidAmountKobo) / Math.max(1, quote.totalKobo)) * 100;
    if (diffPct > tolerancePct) return { flagged: true, reason: 'PRICE_MISMATCH', quote };
    if (quote.expiresAt < new Date()) return { flagged: false, reason: 'QUOTE_EXPIRED_WITHIN_TOLERANCE', quote };
    return { flagged: quote.flagged, reason: quote.flagged ? 'MARGIN_BELOW_FLOOR' : undefined, quote };
  }

  private async pickupTimeFor(leg: PartnerBookingRequest['legs'][number]): Promise<Date> {
    if (leg.type === 'ARRIVAL') return new Date(leg.flight.scheduledArrival);
    const departure = new Date(leg.flight.scheduledDeparture);
    const [travelMinutes, buffer, margin, extra, beforeHour] = await Promise.all([
      this.maps.travelTimeMinutes(leg.pickup.location, leg.dropoff.location, departure),
      this.config.get<number>(CONFIG.airportBufferDomesticMin),
      this.config.get<number>(CONFIG.safetyMarginMin),
      this.config.get<number>(CONFIG.earlyMorningMarginMin),
      this.config.get<number>(CONFIG.earlyMorningBeforeHour),
    ]);
    return departurePickupTime({
      departure,
      travelMinutes,
      airportBufferMinutes: buffer,
      safetyMarginMinutes: margin,
      earlyMorningExtraMarginMinutes: extra,
      earlyMorningBeforeHour: beforeHour,
      utcOffsetMinutes: LAGOS_UTC_OFFSET_MINUTES,
    });
  }

  findByReference(airlineId: string, reference: string) {
    return this.prisma.transferBooking.findUnique({
      where: { airlineId_airlineBookingReference: { airlineId, airlineBookingReference: reference } },
      include: { legs: true, traveller: true, events: { orderBy: { time: 'asc' } } },
    });
  }

  async update(airline: Airline, reference: string, patch: PartnerBookingUpdate) {
    const b = await this.findByReference(airline.id, reference);
    if (!b) throw new NotFoundException({ code: 'BOOKING_NOT_FOUND', message: 'No booking with that reference.' });
    await this.prisma.$transaction([
      this.prisma.transferBooking.update({
        where: { id: b.id },
        data: { passengers: patch.passengers, bags: patch.bags },
      }),
      ...(patch.traveller
        ? [this.prisma.traveller.update({ where: { bookingId: b.id }, data: patch.traveller })]
        : []),
      this.prisma.bookingEvent.create({
        data: { bookingId: b.id, type: 'booking.updated', actorRole: 'SYSTEM', data: patch as object, reason: 'airline update' },
      }),
    ]);
    // Leg and flight changes are re-planned by dispatch in M4/M7. Logged for ops for now.
    this.realtime.emit(`booking:${b.id}`, 'booking.updated', { bookingId: b.id });
    return this.findByReference(airline.id, reference);
  }

  async cancel(airline: Airline, reference: string, reason?: string) {
    const b = await this.findByReference(airline.id, reference);
    if (!b) throw new NotFoundException({ code: 'BOOKING_NOT_FOUND', message: 'No booking with that reference.' });
    if (b.status === 'CANCELLED') return b;
    await this.prisma.$transaction([
      this.prisma.transferBooking.update({ where: { id: b.id }, data: { status: 'CANCELLED' } }),
      this.prisma.rideLeg.updateMany({ where: { bookingId: b.id }, data: { status: 'CANCELLED', nextActionAt: null } }),
      this.prisma.bookingEvent.create({
        data: { bookingId: b.id, type: 'booking.cancelled', actorRole: 'SYSTEM', reason: reason ?? 'airline cancelled' },
      }),
    ]);
    // The refund decision belongs to the policy engine (M7).
    this.realtime.emit(`booking:${b.id}`, 'booking.updated', { bookingId: b.id, status: 'CANCELLED' });
    return this.findByReference(airline.id, reference);
  }

  list(limit = 50) {
    return this.prisma.transferBooking.findMany({
      take: limit,
      orderBy: { createdAt: 'desc' },
      include: { traveller: true, legs: true, airline: { select: { code: true, name: true } } },
    });
  }
}

/** Keep raw payloads for debugging (8.6) without contact details. */
function redact(p: PartnerBookingRequest): object {
  return { ...p, traveller: { ...p.traveller, phone: '[redacted]', email: p.traveller.email ? '[redacted]' : undefined } };
}
