import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  GoneException,
  Headers,
  HttpCode,
  Injectable,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { ApiHeader, ApiTags } from '@nestjs/swagger';
import { OpsBookingRequest, OwnBookingRequest, type PartnerBookingRequest } from '@airwheels/types';
import type { BookingChannel, Quote } from '@prisma/client';
import { timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { randomToken, sha256 } from '../../common/crypto';
import { PrismaService } from '../../common/prisma.service';
import { AdminWrite, type AuthedRequest, Public, RateLimit, requireAdmin } from '../../common/auth/roles';
import { ApiZodBody, ZodPipe } from '../../common/zod';
import { AuditService } from '../audit/audit.service';
import { BookingsService } from '../bookings/bookings.service';
import { PaymentsService } from '../payments/payments.service';
import type { StoredBreakdown, StoredQuoteRequest } from '../pricing/pricing.service';
import { PricingService } from '../pricing/pricing.service';
import { IdempotencyService } from './idempotency';

const webUrl = () => process.env.WEB_PUBLIC_URL ?? 'http://localhost:3000';

const OWN_CHANNELS: BookingChannel[] = ['OWN_PAGE', 'LINK', 'OPS'];

/**
 * Our own channel (CHN-04 to CHN-06, PRD 8.3 "our own channel"): quote, create the booking as
 * Pending payment, pay by Paystack, then the webhook confirms it. The traveller has no account:
 * a pay token returned at creation lets them pay and see the status.
 */
@Injectable()
export class OwnChannelService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly bookings: BookingsService,
    private readonly pricing: PricingService,
    private readonly payments: PaymentsService,
  ) {}

  private async usableQuote(quoteId: string): Promise<Quote> {
    const quote = await this.prisma.quote.findUnique({ where: { id: quoteId } });
    if (!quote || !OWN_CHANNELS.includes(quote.channel)) throw new NotFoundException({ code: 'QUOTE_UNKNOWN', message: 'That price was not found. Get a new price.' });
    if (quote.expiresAt <= new Date()) throw new GoneException({ code: 'QUOTE_EXPIRED', message: 'This price is no longer held. Get a new price.' });
    if (quote.lockedAt) throw new ConflictException({ code: 'QUOTE_USED', message: 'This price was already used for a booking.' });
    return quote;
  }

  async create(input: {
    quoteId: string;
    airlineBookingReference: string;
    traveller: PartnerBookingRequest['traveller'];
    actor: { role: 'TRAVELLER' | 'OPS'; id?: string };
  }) {
    const quote = await this.usableQuote(input.quoteId);
    const request = quote.request as unknown as StoredQuoteRequest;
    const airline = quote.airlineId ? await this.prisma.airline.findUnique({ where: { id: quote.airlineId } }) : null;
    const payload: PartnerBookingRequest = {
      quoteId: quote.id,
      airlineBookingReference: input.airlineBookingReference,
      traveller: input.traveller,
      passengers: request.passengers,
      bags: request.bags,
      rideType: request.rideType,
      plan: request.plan,
      legs: request.legs,
      paidAmountKobo: quote.totalKobo,
    };
    const payToken = randomToken(24);
    const booking = await this.bookings.create({
      airline,
      channel: quote.channel,
      collectedBy: 'AIRWHEELS',
      payload,
      status: 'PENDING_PAYMENT',
      quote,
      payTokenHash: sha256(payToken),
      actor: input.actor,
    });
    return {
      bookingId: booking.id,
      payToken,
      status: booking.status,
      totalKobo: quote.totalKobo,
      priceHeldUntil: quote.expiresAt.toISOString(),
      trackingUrl: booking.trackingUrl,
    };
  }

  async checkToken(bookingId: string, token: string | undefined) {
    const b = await this.prisma.transferBooking.findUnique({ where: { id: bookingId }, select: { payTokenHash: true } });
    const given = Buffer.from(sha256(token ?? ''));
    if (!b?.payTokenHash || !token || !timingSafeEqual(given, Buffer.from(b.payTokenHash))) {
      throw new ForbiddenException({ code: 'PAY_TOKEN_INVALID', message: 'This payment link is not valid.' });
    }
  }

  pay(bookingId: string, payToken: string) {
    return this.payments.initialize(bookingId, `${webUrl()}/booking/${bookingId}?t=${encodeURIComponent(payToken)}`);
  }

  async status(bookingId: string) {
    const b = await this.prisma.transferBooking.findUniqueOrThrow({
      where: { id: bookingId },
      include: { legs: { orderBy: { type: 'asc' } }, quote: true, paymentIntents: { orderBy: { createdAt: 'desc' }, take: 1 } },
    });
    const bd = b.quoteSnapshot as StoredBreakdown | null;
    return {
      bookingId: b.id,
      reference: b.airlineBookingReference,
      status: b.status,
      totalKobo: b.amountKobo,
      priceHeldUntil: b.quote?.expiresAt.toISOString() ?? null,
      payment: b.paymentIntents[0] ? { status: b.paymentIntents[0].status } : null,
      legs: b.legs.map((l, i) => ({ type: l.type, pickupAt: l.scheduledAt, pickup: l.pickupText, dropoff: l.dropoffText, amountKobo: l.amountKobo, lines: bd?.legs?.[i]?.lines ?? [] })),
    };
  }
}

const PayBody = z.object({ payToken: z.string().min(16).max(100) });

/** Public booking API for our page and the post-booking link (PRD 20: POST /bookings, POST /bookings/:id/pay). */
@ApiTags('bookings')
@Controller({ path: 'bookings', version: '1' })
export class OwnBookingsController {
  constructor(
    private readonly own: OwnChannelService,
    private readonly idempotency: IdempotencyService,
  ) {}

  /** Needs an Idempotency-Key header: a retried tap or a flaky network never makes a second booking. */
  @Post()
  @Public()
  @RateLimit('bookings')
  @ApiZodBody(OwnBookingRequest)
  @ApiHeader({ name: 'idempotency-key', required: true })
  create(@Body(new ZodPipe(OwnBookingRequest)) body: OwnBookingRequest, @Headers('idempotency-key') key?: string) {
    if (!key || key.length < 8 || key.length > 100) throw new BadRequestException({ code: 'IDEMPOTENCY_KEY_REQUIRED', message: 'Send an Idempotency-Key header.' });
    return this.idempotency.run('own-booking', key, body, () =>
      this.own.create({ quoteId: body.quoteId, airlineBookingReference: body.airlineBookingReference, traveller: body.traveller, actor: { role: 'TRAVELLER' } }),
    );
  }

  @Post(':id/pay')
  @HttpCode(200)
  @Public()
  @RateLimit('payments')
  @ApiZodBody(PayBody)
  async pay(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(PayBody)) body: z.infer<typeof PayBody>) {
    await this.own.checkToken(id, body.payToken);
    return this.own.pay(id, body.payToken);
  }

  @Get(':id')
  @Public()
  @RateLimit('trackingPage')
  async status(@Param('id', ParseUUIDPipe) id: string, @Query('t') token?: string) {
    await this.own.checkToken(id, token);
    return this.own.status(id);
  }
}

/** Ops manual entry for phone and WhatsApp bookings (CHN-06, ADM-07): quote, book, and a pay link to send. */
@ApiTags('admin')
@Controller({ path: 'admin/bookings', version: '1' })
export class OpsBookingsController {
  constructor(
    private readonly own: OwnChannelService,
    private readonly pricing: PricingService,
    private readonly audit: AuditService,
  ) {}

  @Post()
  @AdminWrite()
  @ApiZodBody(OpsBookingRequest)
  async create(@Req() req: AuthedRequest, @Body(new ZodPipe(OpsBookingRequest)) body: OpsBookingRequest) {
    const admin = requireAdmin(req);
    const { airlineBookingReference, traveller, note, ...quoteReq } = body;
    const { quote } = await this.pricing.quoteOwn(quoteReq, 'OPS');
    const created = await this.own.create({ quoteId: quote.id, airlineBookingReference, traveller, actor: { role: 'OPS', id: admin.userId } });
    const pay = await this.own.pay(created.bookingId, created.payToken);
    await this.audit.record({
      action: 'booking.ops_entry',
      entity: 'TransferBooking',
      entityId: created.bookingId,
      after: { reference: airlineBookingReference, totalKobo: created.totalKobo, note },
    });
    return { ...created, paymentUrl: 'authorizationUrl' in pay ? pay.authorizationUrl : null };
  }
}
