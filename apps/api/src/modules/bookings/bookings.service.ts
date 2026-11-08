import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type {
  Airline,
  BookingChannel,
  BookingStatus,
  CollectedBy,
  Prisma,
  Quote,
} from '@prisma/client';
import type { PartnerBookingRequest, PartnerBookingUpdate } from '@airwheels/types';
import { encrypt } from '../../common/crypto';
import { track } from '../../common/observability';
import { PrismaService } from '../../common/prisma.service';
import { RealtimeGateway } from '../../realtime/realtime.gateway';
import { ConfigStore } from '../config/config.service';
import { CONFIG } from '../config/keys';
import { PickupTimesService } from '../dispatch/dispatch.module';
import { FlightsService } from '../flights/flights.module';
import { MessagingService } from '../messaging/messaging.module';
import { airlineCollectedSale, ourChannelPayment } from '../payments/ledger';
import { LedgerService } from '../payments/ledger.service';
import type { StoredBreakdown } from '../pricing/pricing.service';
import { PricingService } from '../pricing/pricing.service';
import { pickupCodeFor, pickupCodeHash } from '../traveller-access/codes';
import { TravellerAccessService } from '../traveller-access/traveller-access.module';
import { BookingStepsService } from './booking-steps';

type Tx = Prisma.TransactionClient;

/**
 * Allowed booking state changes (PRD 8.4). Anything else is refused, so a late or repeated event
 * can never move a booking backwards (for example a failed-payment webhook after a success).
 */
export const BOOKING_TRANSITIONS: Record<BookingStatus, BookingStatus[]> = {
  QUOTED: ['PENDING_PAYMENT', 'CONFIRMED', 'REJECTED'],
  PENDING_PAYMENT: ['CONFIRMED', 'PAYMENT_FAILED', 'CANCELLED'],
  PAYMENT_FAILED: ['PENDING_PAYMENT', 'CONFIRMED', 'CANCELLED'],
  CONFIRMED: ['IN_PROGRESS', 'CANCELLING', 'CANCELLED', 'REFUNDING', 'REFUNDED'],
  IN_PROGRESS: ['COMPLETED', 'CANCELLING', 'REFUNDING'],
  COMPLETED: ['REFUNDING', 'REFUNDED'],
  REJECTED: [],
  CANCELLING: ['CANCELLED'],
  CANCELLED: ['REFUNDING', 'REFUNDED'],
  REFUNDING: ['REFUNDED', 'CONFIRMED', 'CANCELLED', 'COMPLETED'],
  REFUNDED: [],
};

export const canMove = (from: BookingStatus, to: BookingStatus) =>
  from === to || BOOKING_TRANSITIONS[from].includes(to);

/**
 * TransferBooking aggregate (PRD 8). One parent record per airline booking reference, up to two
 * ride legs. Every state change writes a BookingEvent. Steps after confirmation run as queued jobs.
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
    private readonly pickupTimes: PickupTimesService,
    private readonly realtime: RealtimeGateway,
    private readonly ledger: LedgerService,
    private readonly steps: BookingStepsService,
  ) {}

  /**
   * PRD 8.3 step 4: create the booking, its legs, pickup codes and tracking link (BKG-05).
   * Airline-collected bookings start Confirmed; our channel starts Pending payment.
   */
  async create(input: {
    airline: Airline | null;
    channel: BookingChannel;
    collectedBy: CollectedBy;
    payload: PartnerBookingRequest;
    status?: 'CONFIRMED' | 'PENDING_PAYMENT';
    /** Our channel passes the quote it already checked; partner bookings are matched by quoteId. */
    quote?: Quote;
    payTokenHash?: string;
    actor?: { role: 'SYSTEM' | 'OPS' | 'TRAVELLER'; id?: string };
  }) {
    const { airline, payload } = input;
    const status = input.status ?? 'CONFIRMED';
    const checked = input.quote
      ? {
          flagged: input.quote.flagged,
          reason: input.quote.flagged ? 'MARGIN_BELOW_FLOOR' : undefined,
          quote: input.quote,
        }
      : await this.checkQuote(payload);
    const { flagged, reason, quote } = checked;
    const breakdown = (quote?.breakdown as StoredBreakdown | null) ?? null;

    const pickupTimes =
      breakdown?.pickupTimes?.length === payload.legs.length
        ? breakdown.pickupTimes.map((t) => new Date(t))
        : await Promise.all(payload.legs.map((leg) => this.pickupTimes.forLeg(leg)));
    const lastLegEnd = Math.max(
      ...payload.legs.map((l) => new Date(l.flight.scheduledArrival).getTime()),
    );
    const linkHours = await this.config.get<number>(CONFIG.trackingLinkHoursAfterLastLeg);
    const { token, data: tokenData } = this.access.newToken(
      new Date(lastLegEnd + linkHours * 3_600_000),
    );
    const vehicleClass =
      breakdown?.vehicleClass ??
      (await this.pricing.suggestVehicleClass(payload.passengers, payload.bags));
    const airlineShareKobo =
      breakdown?.airlineShareKobo ??
      Math.round((payload.paidAmountKobo * (airline?.revenueShareBps ?? 0)) / 10_000);

    const booking = await this.prisma.$transaction(async (tx) => {
      const b = await tx.transferBooking.create({
        data: {
          airlineId: airline?.id,
          channel: input.channel,
          airlineBookingReference: payload.airlineBookingReference,
          plan: payload.plan,
          rideType: payload.rideType,
          status,
          quoteId: quote?.id,
          quoteSnapshot: (quote?.breakdown as object) ?? undefined,
          pricingRuleVersion: quote?.pricingRuleVersion,
          collectedBy: input.collectedBy,
          amountKobo: payload.paidAmountKobo,
          airlineShareKobo,
          passengers: payload.passengers,
          bags: payload.bags,
          payTokenHash: input.payTokenHash,
          flaggedForOps: flagged,
          flagReason: reason,
          rawPayload: redact(payload),
          traveller: { create: payload.traveller },
          trackingToken: { create: { ...tokenData, tokenEncrypted: encrypt(token) } },
        },
      });
      // Freeze the quote with the booking (BKG-04). The DB lets lockedAt be set only once.
      if (quote && !quote.lockedAt) {
        const locked = await tx.quote.updateMany({
          where: { id: quote.id, lockedAt: null },
          data: { lockedAt: new Date() },
        });
        // Our channel: one booking per quote. A second, concurrent booking on the same price rolls back.
        if (input.quote && locked.count !== 1)
          throw new ConflictException({
            code: 'QUOTE_USED',
            message: 'This price was already used for a booking.',
          });
      }

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
            nextActionAt: status === 'CONFIRMED' ? pickupTimes[i] : null,
            vehicleClass,
            amountKobo:
              breakdown?.legs?.[i]?.amountKobo ??
              Math.round(payload.paidAmountKobo / payload.legs.length),
            pickupCodeHash: 'pending',
          },
        });
        await tx.rideLeg.update({
          where: { id: created.id },
          data: { pickupCodeHash: pickupCodeHash(created.id, 1, pickupCodeFor(created.id, 1)) },
        });
      }

      await this.event(
        tx,
        b.id,
        status === 'CONFIRMED' ? 'booking.confirmed' : 'booking.pending_payment',
        input.actor ?? { role: 'SYSTEM' },
        flagged ? reason : undefined,
        {
          channel: input.channel,
          collectedBy: input.collectedBy,
          quoteId: quote?.id,
        },
      );
      return tx.transferBooking.findUniqueOrThrow({ where: { id: b.id }, include: { legs: true } });
    });

    if (status === 'CONFIRMED') await this.steps.enqueueAfterConfirm(booking.id);
    this.realtime.emit('ops', 'booking.created', { bookingId: booking.id, status });
    track(status === 'CONFIRMED' ? 'airline booking confirmed' : 'booking created', booking.id, {
      booking_id: booking.id,
      airline: airline?.code,
      channel: input.channel,
      plan: payload.plan,
    });
    return Object.assign(booking, { trackingUrl: this.access.trackingUrl(token) });
  }

  /** Moves a booking to a new state with an event, refusing moves PRD 8.4 does not allow. */
  async transition(
    id: string,
    to: BookingStatus,
    actor: { role: 'SYSTEM' | 'OPS' | 'TRAVELLER'; id?: string },
    reason?: string,
    data?: object,
    tx?: Tx,
  ) {
    const run = async (t: Tx) => {
      const b = await t.transferBooking.findUniqueOrThrow({ where: { id } });
      if (b.status === to) return { changed: false, from: b.status };
      if (!canMove(b.status, to)) {
        throw new BadRequestException({
          code: 'BOOKING_STATE',
          message: `A ${b.status.toLowerCase()} booking cannot become ${to.toLowerCase()}.`,
        });
      }
      // Compare-and-set, so two workers cannot both make the same move.
      const r = await t.transferBooking.updateMany({
        where: { id, status: b.status },
        data: { status: to },
      });
      if (r.count !== 1) return { changed: false, from: b.status };
      await this.event(t, id, `booking.${to.toLowerCase()}`, actor, reason, {
        from: b.status,
        ...(data ?? {}),
      });
      return { changed: true, from: b.status };
    };
    const res = tx ? await run(tx) : await this.prisma.$transaction(run);
    if (res.changed)
      this.realtime.emit(`booking:${id}`, 'booking.updated', { bookingId: id, status: to });
    return res;
  }

  /** Our channel: payment confirmed by Paystack (via webhook or reconciliation). Legs get their next action. */
  async confirmPaid(bookingId: string, tx: Tx, data: object) {
    const res = await this.transition(
      bookingId,
      'CONFIRMED',
      { role: 'SYSTEM' },
      'payment succeeded',
      data,
      tx,
    );
    if (res.changed) {
      const legs = await tx.rideLeg.findMany({ where: { bookingId } });
      for (const l of legs)
        await tx.rideLeg.update({ where: { id: l.id }, data: { nextActionAt: l.scheduledAt } });
    }
    return res;
  }

  // ---------- steps after confirmation (run by the bookings queue) ----------

  async runAfterConfirm(bookingId: string) {
    const b = await this.prisma.transferBooking.findUniqueOrThrow({
      where: { id: bookingId },
      include: { airline: true },
    });
    if (!['CONFIRMED', 'IN_PROGRESS', 'COMPLETED'].includes(b.status))
      return { skipped: `status ${b.status}` };
    await this.steps.run(bookingId, 'post_ledger', () => this.postSale(bookingId));
    await this.steps.run(bookingId, 'notify_confirmed', () => this.notifyConfirmed(bookingId));
    return { done: true };
  }

  /** PRD 14.4: the sale goes into the ledger once, keyed by the booking. */
  async postSale(bookingId: string) {
    const b = await this.prisma.transferBooking.findUniqueOrThrow({
      where: { id: bookingId },
      include: { airline: true, paymentIntents: { where: { status: 'SUCCEEDED' } } },
    });
    const bd = b.quoteSnapshot as StoredBreakdown | null;
    const amounts = {
      totalKobo: b.amountKobo,
      airportFeeKobo: bd?.airportFeeKobo ?? 0,
      taxKobo: bd?.taxKobo ?? 0,
      airlineShareKobo: b.airlineShareKobo,
      disruptionReserveKobo:
        bd?.legs?.reduce((s, l) => s + (l.cost?.disruptionReserveKobo ?? 0), 0) ?? 0,
    };
    if (b.collectedBy === 'AIRLINE') {
      if (!b.airline) throw new Error('Airline-collected booking without an airline');
      const p = airlineCollectedSale({
        ...amounts,
        reference: `sale:${b.id}`,
        bookingId: b.id,
        airline: { id: b.airline.id, code: b.airline.code },
      });
      return this.ledger.post(p);
    }
    const intent = b.paymentIntents[0];
    if (!intent) throw new Error('Our-channel booking has no successful payment yet');
    const p = ourChannelPayment({
      ...amounts,
      totalKobo: intent.amountKobo,
      reference: `payment:${intent.id}`,
      bookingId: b.id,
      gatewayFeeKobo: intent.gatewayFeeKobo ?? 0,
      airline:
        b.airline && b.airlineShareKobo > 0 ? { id: b.airline.id, code: b.airline.code } : null,
    });
    return this.ledger.post(p);
  }

  private async notifyConfirmed(bookingId: string) {
    const b = await this.prisma.transferBooking.findUniqueOrThrow({
      where: { id: bookingId },
      include: { traveller: true },
    });
    if (!b.traveller) return { sent: false, reason: 'no traveller' };
    // PRD 7.1: shared bookings get the matching message with the no-match promise.
    await this.messaging.notify(
      b.rideType === 'SHARED' ? 'shared.confirmed' : 'booking.confirmed',
      {
        bookingId: b.id,
      },
    );
    return { sent: true };
  }

  // ---------- partner channel ----------

  /** PRD 8.5: never reject a paid traveller. Accept and flag when the quote is missing, expired or off. */
  private async checkQuote(payload: PartnerBookingRequest) {
    if (!payload.quoteId) return { flagged: true, reason: 'NO_QUOTE', quote: null };
    const quote = await this.prisma.quote.findUnique({ where: { id: payload.quoteId } });
    if (!quote) return { flagged: true, reason: 'UNKNOWN_QUOTE', quote: null };
    const tolerancePct = await this.config.get<number>(CONFIG.quoteTolerancePct);
    const diffPct =
      (Math.abs(quote.totalKobo - payload.paidAmountKobo) / Math.max(1, quote.totalKobo)) * 100;
    if (diffPct > tolerancePct) return { flagged: true, reason: 'PRICE_MISMATCH', quote };
    if (quote.expiresAt < new Date())
      return { flagged: false, reason: 'QUOTE_EXPIRED_WITHIN_TOLERANCE', quote };
    return {
      flagged: quote.flagged,
      reason: quote.flagged ? 'MARGIN_BELOW_FLOOR' : undefined,
      quote,
    };
  }

  findByReference(airlineId: string, reference: string) {
    return this.prisma.transferBooking.findUnique({
      where: {
        airlineId_airlineBookingReference: { airlineId, airlineBookingReference: reference },
      },
      include: { legs: true, traveller: true, events: { orderBy: { time: 'asc' } } },
    });
  }

  async update(airline: Airline, reference: string, patch: PartnerBookingUpdate) {
    const b = await this.findByReference(airline.id, reference);
    if (!b)
      throw new NotFoundException({
        code: 'BOOKING_NOT_FOUND',
        message: 'No booking with that reference.',
      });
    await this.prisma.$transaction(async (tx) => {
      await tx.transferBooking.update({
        where: { id: b.id },
        data: { passengers: patch.passengers, bags: patch.bags },
      });
      if (patch.traveller)
        await tx.traveller.update({ where: { bookingId: b.id }, data: patch.traveller });
      await this.event(
        tx,
        b.id,
        'booking.updated',
        { role: 'SYSTEM' },
        'airline update',
        patch as object,
      );
    });
    // Leg and flight changes are re-planned by dispatch in M4/M7.
    this.realtime.emit(`booking:${b.id}`, 'booking.updated', { bookingId: b.id });
    return this.findByReference(airline.id, reference);
  }

  async cancel(airline: Airline, reference: string, reason?: string) {
    const b = await this.findByReference(airline.id, reference);
    if (!b)
      throw new NotFoundException({
        code: 'BOOKING_NOT_FOUND',
        message: 'No booking with that reference.',
      });
    await this.cancelById(b.id, { role: 'SYSTEM' }, reason ?? 'airline cancelled');
    return this.findByReference(airline.id, reference);
  }

  /** Cancels the booking and its legs. The refund amount is a separate decision (policy engine, M7; ops refund now). */
  async cancelById(
    id: string,
    actor: { role: 'SYSTEM' | 'OPS' | 'TRAVELLER'; id?: string },
    reason: string,
  ) {
    const b = await this.prisma.transferBooking.findUniqueOrThrow({ where: { id } });
    if (b.status === 'CANCELLED') return b;
    await this.prisma.$transaction(async (tx) => {
      await this.transition(id, 'CANCELLED', actor, reason, undefined, tx);
      await tx.rideLeg.updateMany({
        where: { bookingId: id },
        data: { status: 'CANCELLED', nextActionAt: null },
      });
    });
    return this.prisma.transferBooking.findUniqueOrThrow({ where: { id } });
  }

  // ---------- admin views ----------

  async list(q: { limit: number; search?: string; status?: BookingStatus }) {
    const s = q.search?.trim();
    return this.prisma.transferBooking.findMany({
      take: q.limit,
      where: {
        ...(q.status ? { status: q.status } : {}),
        ...(s
          ? {
              OR: [
                { airlineBookingReference: { contains: s.toUpperCase() } },
                { traveller: { name: { contains: s, mode: 'insensitive' } } },
                { traveller: { phone: { contains: s.replace(/\s/g, '') } } },
              ],
            }
          : {}),
      },
      orderBy: { createdAt: 'desc' },
      include: { traveller: true, legs: true, airline: { select: { code: true, name: true } } },
    });
  }

  async detail(id: string) {
    const b = await this.prisma.transferBooking.findUnique({
      where: { id },
      include: {
        traveller: true,
        airline: { select: { id: true, code: true, name: true } },
        legs: { include: { flight: true }, orderBy: { type: 'asc' } },
        events: { orderBy: { time: 'asc' } },
        steps: { orderBy: { createdAt: 'asc' } },
        paymentIntents: {
          orderBy: { createdAt: 'asc' },
          select: {
            id: true,
            gatewayReference: true,
            amountKobo: true,
            status: true,
            gatewayFeeKobo: true,
            paidAt: true,
            failureReason: true,
            createdAt: true,
            authorizationUrl: true,
          },
        },
        refunds: { orderBy: { createdAt: 'asc' } },
        quote: {
          select: {
            id: true,
            expiresAt: true,
            lockedAt: true,
            totalKobo: true,
            flagged: true,
            channel: true,
          },
        },
      },
    });
    if (!b) throw new NotFoundException({ code: 'BOOKING_NOT_FOUND', message: 'No such booking.' });
    const { rawPayload: _r, payTokenHash: _p, ...rest } = b;
    void _r;
    void _p;
    return { ...rest, ledger: await this.ledger.forBooking(id) };
  }

  /** Bookings stuck in one state, or with a failed or missing step (BKG-08). */
  async stuck() {
    const minutes = await this.config.get<number>(CONFIG.stuckBookingMinutes);
    const before = new Date(Date.now() - minutes * 60_000);
    const rows = await this.prisma.transferBooking.findMany({
      where: {
        updatedAt: { lt: before },
        OR: [
          { status: { in: ['PENDING_PAYMENT', 'CANCELLING', 'REFUNDING'] } },
          { status: 'CONFIRMED', steps: { none: { step: 'notify_confirmed', status: 'DONE' } } },
          { steps: { some: { status: 'FAILED' } } },
        ],
      },
      include: { traveller: true, steps: true },
      orderBy: { updatedAt: 'asc' },
      take: 100,
    });
    return rows.map((b) => ({
      id: b.id,
      reference: b.airlineBookingReference,
      status: b.status,
      traveller: b.traveller?.name,
      since: b.updatedAt,
      failedSteps: b.steps
        .filter((s) => s.status === 'FAILED')
        .map((s) => ({ step: s.step, error: s.error })),
    }));
  }

  /** Safe manual retry: re-queues the after-confirm steps. Finished steps are skipped. */
  async retry(id: string) {
    const b = await this.prisma.transferBooking.findUniqueOrThrow({ where: { id } });
    if (!['CONFIRMED', 'IN_PROGRESS', 'COMPLETED'].includes(b.status)) {
      throw new BadRequestException({
        code: 'NOTHING_TO_RETRY',
        message: `Nothing to retry for a ${b.status.toLowerCase()} booking.`,
      });
    }
    await this.steps.enqueueAfterConfirm(id, { retry: true });
    return { queued: true };
  }

  /** The sweeper (DSP-05 style): confirmed bookings whose steps never finished are queued again. */
  async sweep() {
    const rows = await this.prisma.transferBooking.findMany({
      where: {
        status: { in: ['CONFIRMED', 'IN_PROGRESS', 'COMPLETED'] },
        updatedAt: { lt: new Date(Date.now() - 60_000) },
        steps: { none: { step: 'notify_confirmed', status: 'DONE' } },
      },
      select: { id: true },
      take: 50,
    });
    for (const r of rows) await this.steps.enqueueAfterConfirm(r.id, { retry: true });
    return { requeued: rows.length };
  }

  private event(
    tx: Tx,
    bookingId: string,
    type: string,
    actor: { role: 'SYSTEM' | 'OPS' | 'TRAVELLER'; id?: string },
    reason?: string,
    data?: object,
  ) {
    return tx.bookingEvent.create({
      data: {
        bookingId,
        type,
        actorRole: actor.role,
        actorId: actor.id,
        reason,
        data: data as Prisma.InputJsonValue | undefined,
      },
    });
  }
}

/** Keep raw payloads for debugging (8.6) without contact details. */
function redact(p: PartnerBookingRequest): object {
  return {
    ...p,
    traveller: {
      ...p.traveller,
      phone: '[redacted]',
      email: p.traveller.email ? '[redacted]' : undefined,
    },
  };
}
