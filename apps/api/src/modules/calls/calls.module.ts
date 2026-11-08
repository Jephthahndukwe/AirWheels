import {
  BadRequestException,
  Controller,
  Header,
  HttpCode,
  Inject,
  Injectable,
  Logger,
  Module,
  NotFoundException,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';
import type { ActorRole } from '@prisma/client';
import { dialXml, hangupXml } from '../../adapters/africastalking';
import { VOICE, type VoiceAdapter } from '../../adapters/interfaces';
import { type AuthedRequest, Public, RateLimit } from '../../common/auth/roles';
import { PrismaService } from '../../common/prisma.service';
import { AlertsService } from '../support/alerts.service';
import { SupportModule } from '../support/support.module';

type Party = 'TRAVELLER' | 'DRIVER';

/**
 * Masked calls between traveller and driver (TRV-05, DRV-08). Every attempt is a CallLog row, which
 * is also the no-show evidence (PRD 10.5). Neither side ever receives the other's number.
 */
@Injectable()
export class CallsService {
  private readonly log = new Logger(CallsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly alerts: AlertsService,
    @Inject(VOICE) private readonly voice: VoiceAdapter,
  ) {}

  private async phones(legId: string) {
    const leg = await this.prisma.rideLeg.findUnique({
      where: { id: legId },
      include: { booking: { include: { traveller: true } }, driver: { include: { user: true } } },
    });
    if (!leg) throw new NotFoundException({ code: 'LEG_NOT_FOUND', message: 'No such ride.' });
    return {
      leg,
      traveller: leg.booking.traveller?.phone ?? null,
      driver: leg.driver?.user.phone ?? null,
    };
  }

  /** Starts a masked call from one party to the other on a leg. */
  async start(legId: string, from: Party) {
    const { leg, traveller, driver } = await this.phones(legId);
    const to: Party = from === 'TRAVELLER' ? 'DRIVER' : 'TRAVELLER';
    if (['COMPLETED', 'CANCELLED', 'NO_SHOW'].includes(leg.status))
      throw new BadRequestException({
        code: 'LEG_CLOSED',
        message: 'This ride has finished, so calls are closed.',
      });
    const fromPhone = from === 'TRAVELLER' ? traveller : driver;
    const toPhone = to === 'TRAVELLER' ? traveller : driver;
    const log = await this.prisma.callLog.create({
      data: {
        legId,
        fromRole: from as ActorRole,
        toRole: to as ActorRole,
        time: new Date(),
        outcome: 'REQUESTED',
      },
    });
    if (!fromPhone || !toPhone) {
      await this.prisma.callLog.update({
        where: { id: log.id },
        data: { outcome: 'NO_DRIVER_YET' },
      });
      throw new BadRequestException({
        code: 'NO_DRIVER_YET',
        message: 'Your driver is not assigned yet. Call support if you need help now.',
      });
    }
    try {
      const r = await this.voice.bridgeCall({ from: fromPhone, to: toPhone, callLogId: log.id });
      await this.prisma.callLog.update({
        where: { id: log.id },
        data: { outcome: 'RINGING', providerReference: r.callId },
      });
      return {
        callLogId: log.id,
        status: 'RINGING',
        message: 'We are calling your phone now. Answer to be connected.',
      };
    } catch (e) {
      this.log.warn({ legId, err: (e as Error).message }, 'masked call failed');
      await this.prisma.callLog.update({ where: { id: log.id }, data: { outcome: 'FAILED' } });
      await this.alerts.raise({
        type: 'CALL_FAILED',
        message: `A masked call from the ${from.toLowerCase()} could not be placed.`,
        bookingId: leg.bookingId,
        legId,
      });
      throw new BadRequestException({
        code: 'CALL_FAILED',
        message: 'We could not place the call. Please call support.',
      });
    }
  }

  /** Africa's Talking voice callback: connect when answered, log the outcome when it ends. */
  async callback(body: Record<string, string>): Promise<string> {
    const id = body.clientRequestId;
    const log =
      id && /^[0-9a-f-]{36}$/.test(id)
        ? await this.prisma.callLog.findUnique({ where: { id } })
        : body.sessionId
          ? await this.prisma.callLog.findFirst({ where: { providerReference: body.sessionId } })
          : null;
    if (!log) return hangupXml('Sorry, this call could not be connected.');
    if (body.isActive === '1') {
      const { traveller, driver } = await this.phones(log.legId);
      const target = log.toRole === 'DRIVER' ? driver : traveller;
      await this.prisma.callLog.update({ where: { id: log.id }, data: { outcome: 'ANSWERED' } });
      return target
        ? dialXml(target, process.env.AFRICASTALKING_VOICE_NUMBER ?? '')
        : hangupXml('Sorry, we could not reach the other person.');
    }
    const duration = Number(body.durationInSeconds);
    await this.prisma.callLog.update({
      where: { id: log.id },
      data: {
        durationSeconds: Number.isFinite(duration) ? duration : null,
        outcome: (body.status ?? 'ENDED').toUpperCase().slice(0, 40),
      },
    });
    return '';
  }
}

@ApiTags('webhooks')
@Controller({ path: 'webhooks/voice', version: '1' })
export class VoiceWebhookController {
  constructor(
    private readonly calls: CallsService,
    @Inject(VOICE) private readonly voice: VoiceAdapter,
  ) {}

  /** POST /v1/webhooks/voice?key=... (form-encoded, from Africa's Talking). Answers with voice XML. */
  @Post()
  @HttpCode(200)
  @Public()
  @RateLimit('webhooks')
  @Header('content-type', 'application/xml')
  @ApiExcludeEndpoint()
  async voiceCallback(@Query('key') key: string | undefined, @Req() req: AuthedRequest) {
    if (!this.voice.verifyCallback(key)) throw new NotFoundException();
    return this.calls.callback((req.body ?? {}) as Record<string, string>);
  }
}

@Module({
  imports: [SupportModule],
  controllers: [VoiceWebhookController],
  providers: [CallsService],
  exports: [CallsService],
})
export class CallsModule {}
