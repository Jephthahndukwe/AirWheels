import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  HttpCode,
  HttpException,
  HttpStatus,
  Injectable,
  Module,
  Param,
  Post,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Prisma, RideLeg } from '@prisma/client';
import { z } from 'zod';
import { Public, RateLimit } from '../../common/auth/roles';
import { numericCode, randomToken, sha256 } from '../../common/crypto';
import { isDevelopment } from '../../common/env';
import { PrismaService } from '../../common/prisma.service';
import { ApiZodBody, ZodPipe } from '../../common/zod';
import { RealtimeGateway } from '../../realtime/realtime.gateway';
import { BookingsModule } from '../bookings/bookings.module';
import { BookingsService } from '../bookings/bookings.service';
import { CallsModule, CallsService } from '../calls/calls.module';
import { ConfigStore } from '../config/config.service';
import { CONFIG } from '../config/keys';
import { MessagingModule, MessagingService } from '../messaging/messaging.module';
import { PaymentsModule } from '../payments/payments.module';
import { PaymentsService } from '../payments/payments.service';
import type { ChangeDecision, ChangeKind } from '../policy/change-policy';
import { PolicyModule, PolicyService } from '../policy/policy.module';
import { PricingModule } from '../pricing/pricing.module';
import { PricingService } from '../pricing/pricing.service';
import { AlertsService } from '../support/alerts.service';
import { SupportModule } from '../support/support.module';
import { TravellerAccessModule, TravellerAccessService } from './traveller-access.module';

interface CodeSettings {
  digits: number;
  ttlMinutes: number;
  maxAttempts: number;
  resendCooldownSeconds: number;
  grantMinutes: number;
}

/** Codes are kept as a keyed hash, so a database read alone never reveals one. */
const codeHash = (bookingId: string, code: string) =>
  sha256(`change-code:${bookingId}:${code}:${process.env.JWT_SECRET ?? ''}`);

const Grant = z.string().regex(/^[A-Za-z0-9_-]{20,64}$/);
const VerifyBody = z.object({ code: z.string().regex(/^\d{6}$/, 'Enter the six-digit code.') });
const ChangeBody = z
  .object({
    grant: Grant,
    legId: z.string().uuid(),
    kind: z.enum(['CHANGE_TIME', 'CHANGE_ADDRESS']),
    pickupAt: z.string().datetime({ offset: true }).optional(),
    address: z
      .object({
        text: z.string().trim().min(3).max(300),
        lat: z.number().min(-90).max(90),
        lng: z.number().min(-180).max(180),
        landmark: z.string().trim().max(200).optional(),
      })
      .optional(),
    /** false (default): show the cost only. true: do it, accepting the cost shown. */
    apply: z.boolean().default(false),
    acceptFeeKobo: z.number().int().min(0).optional(),
  })
  .refine((b) => (b.kind === 'CHANGE_TIME' ? !!b.pickupAt : !!b.address), {
    message: 'Give the new time or the new address.',
  });
const CancelBody = z.object({
  grant: Grant,
  apply: z.boolean().default(false),
  acceptRefundKobo: z.number().int().min(0).optional(),
});
const RatingBody = z.object({
  legId: z.string().uuid(),
  score: z.number().int().min(1).max(5),
  comment: z.string().trim().max(1000).optional(),
});
const LegBody = z.object({ legId: z.string().uuid() });
const EmergencyBody = z.object({
  legId: z.string().uuid(),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
});

const fmtNaira = (kobo: number) =>
  `₦${(kobo / 100).toLocaleString('en-NG', { maximumFractionDigits: 2 })}`;

/**
 * What the traveller can do from the tracking link (PRD 7.2, 20): change or cancel behind a six-digit
 * code (ACC-02, TRV-07, with the cost shown first), rate (TRV-08), call the driver through a masked
 * line (TRV-05) and raise an emergency (TRV-06).
 */
@Injectable()
export class TravellerActionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: TravellerAccessService,
    private readonly config: ConfigStore,
    private readonly messaging: MessagingService,
    private readonly policy: PolicyService,
    private readonly pricing: PricingService,
    private readonly bookings: BookingsService,
    private readonly payments: PaymentsService,
    private readonly calls: CallsService,
    private readonly alerts: AlertsService,
    private readonly realtime: RealtimeGateway,
  ) {}

  private settings() {
    return this.config.get<CodeSettings>(CONFIG.changeCode);
  }

  private async open(token: string) {
    const r = await this.access.resolve(token);
    if (r.receiptOnly)
      throw new ForbiddenException({
        code: 'LINK_EXPIRED',
        message: 'This link now shows your receipt only.',
      });
    return r.bookingId;
  }

  // ---------- six-digit code (ACC-02) ----------

  async sendCode(token: string) {
    const bookingId = await this.open(token);
    const s = await this.settings();
    const last = await this.prisma.changeCode.findFirst({
      where: { bookingId },
      orderBy: { createdAt: 'desc' },
    });
    const wait = last
      ? Math.ceil((last.createdAt.getTime() + s.resendCooldownSeconds * 1000 - Date.now()) / 1000)
      : 0;
    if (wait > 0)
      throw new HttpException(
        {
          code: 'CODE_COOLDOWN',
          message: `Please wait ${wait} seconds before asking for another code.`,
          retryAfterSeconds: wait,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    const code = numericCode(s.digits);
    const row = await this.prisma.$transaction(async (tx) => {
      // A new code replaces any earlier one.
      await tx.changeCode.updateMany({
        where: { bookingId, usedAt: null },
        data: { usedAt: new Date() },
      });
      return tx.changeCode.create({
        data: {
          bookingId,
          codeHash: codeHash(bookingId, code),
          expiresAt: new Date(Date.now() + s.ttlMinutes * 60_000),
        },
      });
    });
    await this.messaging.notify('change.code', {
      bookingId,
      extra: { changeCode: code },
      instance: row.id,
    });
    return {
      sent: true,
      expiresAt: row.expiresAt,
      resendInSeconds: s.resendCooldownSeconds,
      // ACC-12: shown on screen only when the environment is explicitly development.
      ...(isDevelopment() ? { devCode: code } : {}),
    };
  }

  async verifyCode(token: string, code: string) {
    const bookingId = await this.open(token);
    const s = await this.settings();
    const row = await this.prisma.changeCode.findFirst({
      where: { bookingId, usedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    if (!row || row.expiresAt < new Date())
      throw new BadRequestException({
        code: 'CODE_EXPIRED',
        message: 'This code has expired. Ask for a new one.',
      });
    if (row.attempts >= s.maxAttempts)
      throw new BadRequestException({
        code: 'CODE_LOCKED',
        message: 'Too many wrong tries. Ask for a new code.',
      });
    if (row.codeHash !== codeHash(bookingId, code)) {
      // Counted atomically, so parallel guesses cannot exceed the limit.
      const bumped = await this.prisma.changeCode.update({
        where: { id: row.id },
        data: { attempts: { increment: 1 } },
      });
      const left = Math.max(0, s.maxAttempts - bumped.attempts);
      if (left === 0)
        await this.prisma.changeCode.update({
          where: { id: row.id },
          data: { usedAt: new Date() },
        });
      throw new BadRequestException({
        code: left === 0 ? 'CODE_LOCKED' : 'CODE_WRONG',
        message:
          left === 0
            ? 'Too many wrong tries. Ask for a new code.'
            : `That code is not right. ${left} tries left.`,
        attemptsLeft: left,
      });
    }
    const grant = randomToken(24);
    const grantExpiresAt = new Date(Date.now() + s.grantMinutes * 60_000);
    const used = await this.prisma.changeCode.updateMany({
      where: { id: row.id, usedAt: null },
      data: { usedAt: new Date(), grantHash: sha256(grant), grantExpiresAt },
    });
    if (used.count !== 1)
      throw new BadRequestException({ code: 'CODE_EXPIRED', message: 'Ask for a new code.' });
    return { grant, expiresAt: grantExpiresAt };
  }

  private async checkGrant(bookingId: string, grant: string) {
    const row = await this.prisma.changeCode.findUnique({ where: { grantHash: sha256(grant) } });
    if (
      !row ||
      row.bookingId !== bookingId ||
      !row.grantExpiresAt ||
      row.grantExpiresAt < new Date()
    )
      throw new ForbiddenException({
        code: 'CODE_REQUIRED',
        message: 'Enter the six-digit code we sent you first.',
      });
  }

  // ---------- change and cancel (TRV-07, BKG-06) ----------

  private async booking(bookingId: string) {
    return this.prisma.transferBooking.findUniqueOrThrow({
      where: { id: bookingId },
      include: { legs: true },
    });
  }

  private legChange(
    kind: ChangeKind,
    plan: 'STANDARD' | 'FLEX',
    leg: RideLeg,
    repriceDeltaKobo?: number,
  ) {
    return {
      kind,
      plan,
      legStatus: leg.status,
      pickupAt: leg.scheduledAt,
      legAmountKobo: leg.amountKobo,
      driverAssigned: !!leg.driverId,
      repriceDeltaKobo,
      now: new Date(),
    };
  }

  async change(token: string, body: z.infer<typeof ChangeBody>) {
    const bookingId = await this.open(token);
    await this.checkGrant(bookingId, body.grant);
    const b = await this.booking(bookingId);
    if (!['CONFIRMED', 'PENDING_PAYMENT'].includes(b.status))
      throw new BadRequestException({
        code: 'BOOKING_STATE',
        message: 'This booking can no longer be changed here.',
      });
    const leg = b.legs.find((l) => l.id === body.legId);
    if (!leg)
      throw new BadRequestException({
        code: 'LEG_INVALID',
        message: 'That ride is not on this booking.',
      });

    let newTime: Date | undefined;
    let delta: Awaited<ReturnType<PricingService['addressChangeDeltaKobo']>> | undefined;
    if (body.kind === 'CHANGE_TIME') {
      if (leg.type === 'ARRIVAL')
        throw new BadRequestException({
          code: 'ARRIVAL_FOLLOWS_FLIGHT',
          message:
            'Your arrival pickup follows your flight automatically. Call support to change it.',
        });
      newTime = new Date(body.pickupAt!);
      if (newTime.getTime() < Date.now() + 60 * 60_000)
        throw new BadRequestException({
          code: 'TIME_TOO_SOON',
          message: 'Choose a time at least an hour from now.',
        });
      const flight = leg.flightId
        ? await this.prisma.flightRecord.findUnique({
            where: { id: leg.flightId },
            include: { snapshots: { orderBy: { observedAt: 'desc' }, take: 1 } },
          })
        : null;
      const dep =
        flight?.snapshots[0]?.estimatedDeparture ?? flight?.snapshots[0]?.scheduledDeparture;
      if (dep && newTime.getTime() > dep.getTime() - 90 * 60_000)
        throw new BadRequestException({
          code: 'TIME_TOO_LATE',
          message: 'That is too close to your flight. Choose an earlier time.',
        });
    } else {
      const from =
        leg.type === 'DEPARTURE'
          ? { lat: leg.pickupLat, lng: leg.pickupLng }
          : { lat: leg.dropoffLat, lng: leg.dropoffLng };
      delta = await this.pricing.addressChangeDeltaKobo(from, body.address!, leg.vehicleClass);
    }

    const change = this.legChange(body.kind, b.plan, leg, delta?.deltaKobo);
    if (!body.apply)
      return {
        preview: true,
        decision: await this.policy.previewChange(change),
        ...(delta ? { zones: delta } : {}),
      };

    const decision = await this.policy.decideChange(
      bookingId,
      `traveller.${body.kind.toLowerCase()}`,
      change,
    );
    this.assertAccepted(decision, body.acceptFeeKobo, 'fee');
    await this.prisma.$transaction(async (tx) => {
      const data: Prisma.RideLegUpdateInput =
        body.kind === 'CHANGE_TIME'
          ? { scheduledAt: newTime, nextActionAt: newTime }
          : leg.type === 'DEPARTURE'
            ? {
                pickupText: body.address!.text,
                pickupLat: body.address!.lat,
                pickupLng: body.address!.lng,
                pickupLandmark: body.address!.landmark ?? null,
              }
            : {
                dropoffText: body.address!.text,
                dropoffLat: body.address!.lat,
                dropoffLng: body.address!.lng,
                dropoffLandmark: body.address!.landmark ?? null,
              };
      await tx.rideLeg.update({ where: { id: leg.id }, data });
      await tx.bookingEvent.create({
        data: {
          bookingId,
          type:
            body.kind === 'CHANGE_TIME' ? 'traveller.changed_time' : 'traveller.changed_address',
          actorRole: 'TRAVELLER',
          reason: decision.reasonCode,
          data: {
            legId: leg.id,
            before:
              body.kind === 'CHANGE_TIME'
                ? leg.scheduledAt?.toISOString()
                : leg.type === 'DEPARTURE'
                  ? leg.pickupText
                  : leg.dropoffText,
            after: body.kind === 'CHANGE_TIME' ? newTime!.toISOString() : body.address!.text,
            feeKobo: decision.feeKobo,
            zones: delta ?? null,
          } as Prisma.InputJsonValue,
        },
      });
    });
    if (decision.feeKobo > 0)
      // Fees are collected by ops with a Paystack link until the M7 policy engine automates it (PRD 12.4).
      await this.alerts.raise({
        type: 'FEE_TO_COLLECT',
        message: `Traveller changed a ride with a fee of ${fmtNaira(decision.feeKobo)} (${decision.reasonCode}). Send a payment link.`,
        bookingId,
        legId: leg.id,
        data: { feeKobo: decision.feeKobo },
      });
    const cost = decision.feeKobo > 0 ? fmtNaira(decision.feeKobo) : 'free';
    if (body.kind === 'CHANGE_TIME')
      await this.messaging.notify('pickup_time.changed', {
        bookingId,
        legId: leg.id,
        extra: { reason: 'you changed it' },
        instance: `t${newTime!.getTime()}`,
      });
    else
      await this.messaging.notify('booking.changed', {
        bookingId,
        legId: leg.id,
        extra: { cost },
        instance: `a${Date.now()}`,
      });
    this.realtime.emit(`booking:${bookingId}`, 'leg.updated', { bookingId, legId: leg.id });
    return { applied: true, decision };
  }

  async cancel(token: string, body: z.infer<typeof CancelBody>) {
    const bookingId = await this.open(token);
    await this.checkGrant(bookingId, body.grant);
    const b = await this.booking(bookingId);
    if (!['CONFIRMED', 'PENDING_PAYMENT'].includes(b.status))
      throw new BadRequestException({
        code: 'BOOKING_STATE',
        message: 'This booking can no longer be cancelled here.',
      });
    const open = b.legs.filter((l) => !['CANCELLED', 'COMPLETED', 'NO_SHOW'].includes(l.status));
    const unpaid = b.status === 'PENDING_PAYMENT';
    const decide = async (apply: boolean) => {
      const out: (ChangeDecision & { legId: string })[] = [];
      for (const leg of open) {
        const change = this.legChange('CANCEL', b.plan, leg);
        const d = apply
          ? await this.policy.decideChange(bookingId, 'traveller.cancel', change)
          : await this.policy.previewChange(change);
        out.push({ ...d, legId: leg.id });
      }
      return out;
    };
    const legs = await decide(false);
    const blocked = legs.find((d) => !d.allowed);
    const refundKobo = unpaid ? 0 : legs.reduce((s, d) => s + d.refundKobo, 0);
    if (!body.apply)
      return {
        preview: true,
        allowed: !blocked,
        message: blocked?.message,
        refundKobo,
        paidKobo: unpaid ? 0 : b.amountKobo,
        legs,
      };
    if (blocked)
      throw new BadRequestException({ code: blocked.reasonCode, message: blocked.message });
    const final = await decide(true);
    const total = unpaid ? 0 : final.reduce((s, d) => s + d.refundKobo, 0);
    this.assertAccepted({ ...final[0]!, refundKobo: total }, body.acceptRefundKobo, 'refund');

    await this.bookings.cancelById(bookingId, { role: 'TRAVELLER' }, 'cancelled by the traveller');
    let refund: { status: string } | null = null;
    if (total > 0) {
      const { refundableKobo } = await this.payments.refundable(bookingId);
      const amount = Math.min(total, refundableKobo);
      if (amount > 0)
        refund = await this.payments.refund({
          bookingId,
          amountKobo: amount,
          reason: `Traveller cancelled (${final.map((d) => d.reasonCode).join(', ')})`,
          actor: { role: 'SYSTEM' },
        });
    }
    await this.messaging.notify('booking.cancelled', {
      bookingId,
      extra: {
        cost: total > 0 ? `${fmtNaira(total)}, back to how you paid` : 'none under your plan',
      },
    });
    return { applied: true, refundKobo: total, refundStatus: refund?.status ?? null };
  }

  /** The traveller confirms the exact amount they were shown, so a rule change in between never surprises them. */
  private assertAccepted(d: ChangeDecision, accepted: number | undefined, what: 'fee' | 'refund') {
    if (!d.allowed) throw new BadRequestException({ code: d.reasonCode, message: d.message });
    const amount = what === 'fee' ? d.feeKobo : d.refundKobo;
    if ((what === 'fee' && amount > 0) || what === 'refund') {
      if (accepted !== amount)
        throw new BadRequestException({
          code: 'COST_CHANGED',
          message: `The ${what} is now ${fmtNaira(amount)}. Please check it and confirm again.`,
          [`${what}Kobo`]: amount,
        });
    }
  }

  // ---------- rating, emergency, call ----------

  private async leg(bookingId: string, legId: string) {
    const leg = await this.prisma.rideLeg.findFirst({ where: { id: legId, bookingId } });
    if (!leg)
      throw new BadRequestException({
        code: 'LEG_INVALID',
        message: 'That ride is not on this booking.',
      });
    return leg;
  }

  async rate(token: string, body: z.infer<typeof RatingBody>) {
    const { bookingId } = await this.access.resolve(token); // rating stays open on the receipt
    const leg = await this.leg(bookingId, body.legId);
    if (leg.status !== 'COMPLETED')
      throw new BadRequestException({
        code: 'NOT_COMPLETED',
        message: 'You can rate a ride after it ends.',
      });
    const r = await this.prisma.rating.upsert({
      where: { legId: leg.id },
      create: { legId: leg.id, score: body.score, comment: body.comment },
      update: { score: body.score, comment: body.comment },
    });
    if (leg.driverId) {
      const agg = await this.prisma.rating.aggregate({
        where: { leg: { driverId: leg.driverId } },
        _avg: { score: true },
        _count: true,
      });
      await this.prisma.driverProfile.update({
        where: { id: leg.driverId },
        data: { ratingAvg: agg._avg.score, ratingCount: agg._count },
      });
    }
    if (body.score <= 2)
      await this.alerts.raise({
        type: 'LOW_RATING',
        message: `A traveller rated a ride ${body.score} of 5.`,
        bookingId,
        legId: leg.id,
      });
    return { rated: true, score: r.score };
  }

  /** TRV-06: alerts ops at once with the traveller's location if the phone shared it. */
  async emergency(token: string, body: z.infer<typeof EmergencyBody>) {
    const bookingId = await this.open(token);
    const leg = await this.leg(bookingId, body.legId);
    const driverPing = leg.driverId
      ? await this.prisma.locationPing.findFirst({
          where: { legId: leg.id },
          orderBy: { time: 'desc' },
        })
      : null;
    const alert = await this.alerts.raise({
      type: 'EMERGENCY',
      message: 'URGENT: the traveller pressed the emergency button. Call them now.',
      bookingId,
      legId: leg.id,
      driverId: leg.driverId ?? undefined,
      data: {
        travellerLocation:
          body.lat !== undefined && body.lng !== undefined
            ? { lat: body.lat, lng: body.lng }
            : null,
        driverLocation: driverPing
          ? { lat: driverPing.lat, lng: driverPing.lng, at: driverPing.time }
          : null,
      },
    });
    await this.prisma.bookingEvent.create({
      data: {
        bookingId,
        type: 'traveller.emergency',
        actorRole: 'TRAVELLER',
        data: { legId: leg.id, alertId: alert.id },
      },
    });
    return { alerted: true, message: 'Our team has been alerted and will call you now.' };
  }

  async call(token: string, legId: string) {
    const bookingId = await this.open(token);
    await this.leg(bookingId, legId);
    return this.calls.start(legId, 'TRAVELLER');
  }
}

@ApiTags('traveller')
@Controller({ path: 't', version: '1' })
export class TravellerActionsController {
  constructor(private readonly svc: TravellerActionsService) {}

  /** POST /v1/t/:token/code — sends a six-digit code to the booking's phone (ACC-02). */
  @Post(':token/code')
  @HttpCode(200)
  @Public()
  @RateLimit('changeCodeRequest')
  sendCode(@Param('token') token: string) {
    return this.svc.sendCode(token);
  }

  @Post(':token/code/verify')
  @HttpCode(200)
  @Public()
  @RateLimit('changeCodeVerify')
  @ApiZodBody(VerifyBody)
  verify(
    @Param('token') token: string,
    @Body(new ZodPipe(VerifyBody)) body: z.infer<typeof VerifyBody>,
  ) {
    return this.svc.verifyCode(token, body.code);
  }

  /** Preview (apply: false) shows the cost; apply: true makes the change (TRV-07). */
  @Post(':token/changes')
  @HttpCode(200)
  @Public()
  @RateLimit('travellerActions')
  @ApiZodBody(ChangeBody)
  change(
    @Param('token') token: string,
    @Body(new ZodPipe(ChangeBody)) body: z.infer<typeof ChangeBody>,
  ) {
    return this.svc.change(token, body);
  }

  @Post(':token/cancel')
  @HttpCode(200)
  @Public()
  @RateLimit('travellerActions')
  @ApiZodBody(CancelBody)
  cancel(
    @Param('token') token: string,
    @Body(new ZodPipe(CancelBody)) body: z.infer<typeof CancelBody>,
  ) {
    return this.svc.cancel(token, body);
  }

  @Post(':token/rating')
  @HttpCode(200)
  @Public()
  @RateLimit('travellerActions')
  @ApiZodBody(RatingBody)
  rate(
    @Param('token') token: string,
    @Body(new ZodPipe(RatingBody)) body: z.infer<typeof RatingBody>,
  ) {
    return this.svc.rate(token, body);
  }

  @Post(':token/emergency')
  @HttpCode(200)
  @Public()
  @RateLimit('travellerActions')
  @ApiZodBody(EmergencyBody)
  emergency(
    @Param('token') token: string,
    @Body(new ZodPipe(EmergencyBody)) body: z.infer<typeof EmergencyBody>,
  ) {
    return this.svc.emergency(token, body);
  }

  @Post(':token/call')
  @HttpCode(200)
  @Public()
  @RateLimit('travellerActions')
  @ApiZodBody(LegBody)
  call(@Param('token') token: string, @Body(new ZodPipe(LegBody)) body: z.infer<typeof LegBody>) {
    return this.svc.call(token, body.legId);
  }
}

@Module({
  imports: [
    TravellerAccessModule,
    BookingsModule,
    PaymentsModule,
    PolicyModule,
    PricingModule,
    CallsModule,
    MessagingModule,
    SupportModule,
  ],
  controllers: [TravellerActionsController],
  providers: [TravellerActionsService],
})
export class TravellerModule {}
