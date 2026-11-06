import {
  Body,
  ConflictException,
  Controller,
  Get,
  Headers,
  HttpCode,
  Module,
  NotFoundException,
  Param,
  Patch,
  Post,
  Req,
} from '@nestjs/common';
import { ApiHeader, ApiTags } from '@nestjs/swagger';
import {
  PARTNER_HEADERS,
  PartnerBookingRequest,
  PartnerBookingUpdate,
  PartnerCancelRequest,
  PartnerFlightEvent,
  PartnerQuoteRequest,
} from '@airwheels/types';
import { Prisma } from '@prisma/client';
import { ApiZodBody, ZodPipe } from '../../common/zod';
import { AirlinesModule } from '../airlines/airlines.module';
import { RateLimit, Roles } from '../../common/auth/roles';
import type { PartnerRequest } from '../airlines/partner.guard';
import { BookingsModule } from '../bookings/bookings.module';
import { BookingsService } from '../bookings/bookings.service';
import { FlightsModule, FlightsService } from '../flights/flights.module';
import { PricingModule } from '../pricing/pricing.module';
import { PricingService } from '../pricing/pricing.service';
import { IdempotencyService } from './idempotency';

/**
 * Partner API for airline systems (PRD 6, 20). Every channel funnels into BookingsService,
 * so the rest of the system sees one booking shape.
 */
@ApiTags('partner')
@ApiHeader({ name: PARTNER_HEADERS.keyId, required: true })
@ApiHeader({ name: PARTNER_HEADERS.timestamp, required: true, description: 'Unix ms' })
@ApiHeader({ name: PARTNER_HEADERS.signature, required: true, description: 'HMAC-SHA256 hex' })
@Roles('PARTNER')
@RateLimit('partner', 'partner')
@Controller({ path: 'partner', version: '1' })
export class PartnerController {
  constructor(
    private readonly pricing: PricingService,
    private readonly bookings: BookingsService,
    private readonly flights: FlightsService,
    private readonly idempotency: IdempotencyService,
  ) {}

  @Post('quotes')
  @ApiZodBody(PartnerQuoteRequest)
  quote(@Req() req: PartnerRequest, @Body(new ZodPipe(PartnerQuoteRequest)) body: PartnerQuoteRequest) {
    return this.pricing.quote(body, req.airline);
  }

  @Post('bookings')
  @ApiZodBody(PartnerBookingRequest)
  @ApiHeader({ name: PARTNER_HEADERS.idempotencyKey, required: false })
  async create(
    @Req() req: PartnerRequest,
    @Body(new ZodPipe(PartnerBookingRequest)) body: PartnerBookingRequest,
    @Headers(PARTNER_HEADERS.idempotencyKey) key?: string,
  ) {
    return this.idempotency.run(`airline:${req.airline.id}`, key, body, async () => {
      try {
        const b = await this.bookings.create({
          airline: req.airline,
          channel: 'WIDGET',
          collectedBy: 'AIRLINE',
          payload: body,
        });
        return { bookingId: b.id, status: b.status, airlineBookingReference: b.airlineBookingReference };
      } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
          throw new ConflictException({
            code: 'BOOKING_EXISTS',
            message: 'A transfer already exists for this booking reference. Use PATCH to change it.',
          });
        }
        throw e;
      }
    });
  }

  @Get('bookings/:ref')
  async get(@Req() req: PartnerRequest, @Param('ref') ref: string) {
    const b = await this.bookings.findByReference(req.airline.id, ref);
    if (!b) throw new NotFoundException({ code: 'BOOKING_NOT_FOUND', message: 'No booking with that reference.' });
    return b;
  }

  @Patch('bookings/:ref')
  @ApiZodBody(PartnerBookingUpdate)
  update(
    @Req() req: PartnerRequest,
    @Param('ref') ref: string,
    @Body(new ZodPipe(PartnerBookingUpdate)) body: PartnerBookingUpdate,
  ) {
    return this.bookings.update(req.airline, ref, body);
  }

  @Post('bookings/:ref/cancel')
  @HttpCode(200)
  @ApiZodBody(PartnerCancelRequest)
  cancel(
    @Req() req: PartnerRequest,
    @Param('ref') ref: string,
    @Body(new ZodPipe(PartnerCancelRequest)) body: PartnerCancelRequest,
  ) {
    return this.bookings.cancel(req.airline, ref, body.reason);
  }

  @Post('flight-events')
  @HttpCode(202)
  @ApiZodBody(PartnerFlightEvent)
  flightEvent(@Body(new ZodPipe(PartnerFlightEvent)) body: PartnerFlightEvent) {
    return this.flights.recordAirlineEvent(body);
  }

  /** Settlement statements (PAY-04) are built in M5. */
  @Get('settlements')
  settlements() {
    return { statements: [] };
  }
}

@Module({
  imports: [AirlinesModule, BookingsModule, FlightsModule, PricingModule],
  controllers: [PartnerController],
  providers: [IdempotencyService],
})
export class IntakeModule {}
