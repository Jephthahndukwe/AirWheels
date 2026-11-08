import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  HttpCode,
  Inject,
  Injectable,
  Module,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { FAKE_TERMII_KEY, FAKE_WHATSAPP_APP_SECRET, fakeOutbox } from '../../adapters/fakes';
import { SMS, type SmsAdapter, WHATSAPP, type WhatsAppAdapter } from '../../adapters/interfaces';
import { parseTermiiWebhook, termiiSignature } from '../../adapters/termii';
import { metaSignature, parseMetaWebhook } from '../../adapters/whatsapp-cloud';
import {
  AdminRead,
  AdminWrite,
  type AuthedRequest,
  Public,
  RateLimit,
  SuperAdminOnly,
  requireAdmin,
} from '../../common/auth/roles';
import { fakeProvidersAllowed } from '../../common/env';
import { PrismaService } from '../../common/prisma.service';
import { ApiZodBody, ZodPipe } from '../../common/zod';
import { AuditService } from '../audit/audit.service';
import { CallsModule } from '../calls/calls.module';
import { SupportModule } from '../support/support.module';
import { EVENTS, EVENT_BY_NAME, checkTemplate, variablesIn } from './catalog';
import { MessageComposer } from './composer';
import { MessagingProcessor, MessagingService } from './messaging.service';
import { RepliesService } from './replies.service';

export { MessagingProcessor, MessagingService } from './messaging.service';

/**
 * Provider webhooks (TRV-13, NTF-02). Public: the provider's signature over the raw body is the
 * access check. Delivery reports update Notification rows; inbound messages become replies.
 */
@ApiTags('webhooks')
@Controller({ path: 'webhooks', version: '1' })
export class MessagingWebhookController {
  constructor(
    private readonly messaging: MessagingService,
    private readonly replies: RepliesService,
    @Inject(WHATSAPP) private readonly whatsapp: WhatsAppAdapter,
    @Inject(SMS) private readonly sms: SmsAdapter,
  ) {}

  /** Meta's one-time subscription check (GET with hub.challenge). */
  @Get('messaging')
  @Public()
  @RateLimit('webhooks')
  @ApiExcludeEndpoint()
  verify(
    @Query('hub.mode') mode?: string,
    @Query('hub.verify_token') token?: string,
    @Query('hub.challenge') challenge?: string,
  ) {
    const expected = process.env.WHATSAPP_VERIFY_TOKEN;
    if (mode !== 'subscribe' || !expected || token !== expected) throw new ForbiddenException();
    return challenge ?? '';
  }

  /** POST /v1/webhooks/messaging: WhatsApp Cloud API delivery statuses, button taps and replies. */
  @Post('messaging')
  @HttpCode(200)
  @Public()
  @RateLimit('webhooks')
  @ApiExcludeEndpoint()
  async whatsappHook(
    @Req() req: AuthedRequest,
    @Headers('x-hub-signature-256') signature?: string,
  ) {
    if (!req.rawBody || !signature || !this.whatsapp.verifyWebhookSignature(req.rawBody, signature))
      throw new ForbiddenException({ code: 'SIGNATURE_INVALID', message: 'Bad signature.' });
    const { statuses, messages } = parseMetaWebhook(JSON.parse(req.rawBody.toString('utf8')));
    for (const s of statuses) await this.messaging.applyStatus(s);
    const results = [];
    for (const m of messages) results.push(await this.replies.handle('WHATSAPP', m));
    return { ok: true, statuses: statuses.length, replies: results };
  }

  /** POST /v1/webhooks/sms: Termii delivery reports and inbound SMS ("Reply 1 for ..."). */
  @Post('sms')
  @HttpCode(200)
  @Public()
  @RateLimit('webhooks')
  @ApiExcludeEndpoint()
  async smsHook(@Req() req: AuthedRequest, @Headers('x-termii-signature') signature?: string) {
    if (!req.rawBody || !signature || !this.sms.verifyWebhookSignature(req.rawBody, signature))
      throw new ForbiddenException({ code: 'SIGNATURE_INVALID', message: 'Bad signature.' });
    const { statuses, messages } = parseTermiiWebhook(JSON.parse(req.rawBody.toString('utf8')));
    for (const s of statuses) await this.messaging.applyStatus(s);
    const results = [];
    for (const m of messages) results.push(await this.replies.handle('SMS', m));
    return { ok: true, statuses: statuses.length, replies: results };
  }
}

// ---------- admin: templates (TRV-01, ADM-09) ----------

const TemplateVersion = z.object({
  airlineId: z.string().uuid().nullable(),
  event: z.string().refine((e) => EVENT_BY_NAME.has(e), 'Unknown event'),
  channel: z.enum(['WHATSAPP', 'SMS', 'EMAIL']),
  body: z.string().trim().min(5).max(1000),
  providerName: z
    .string()
    .regex(/^[a-z0-9_]{1,512}$/, 'Meta template names use lowercase letters, digits and _')
    .optional(),
});
const Approve = z.object({ providerName: z.string().regex(/^[a-z0-9_]{1,512}$/) });

@Injectable()
export class TemplatesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(airlineId: string | null) {
    const rows = await this.prisma.messageTemplate.findMany({
      where: { airlineId: airlineId ? { in: [airlineId] } : null },
      orderBy: [{ event: 'asc' }, { channel: 'asc' }, { version: 'desc' }],
    });
    const defaults = airlineId
      ? await this.prisma.messageTemplate.findMany({
          where: { airlineId: null },
          orderBy: { version: 'desc' },
        })
      : [];
    return {
      events: EVENTS.map((e) => ({
        event: e.event,
        label: e.label,
        buttons: e.buttons ?? [],
        initiated: e.initiated,
        defaultBody: e.body,
        channels: (['WHATSAPP', 'SMS', 'EMAIL'] as const).map((channel) => {
          const versions = rows.filter((r) => r.event === e.event && r.channel === channel);
          const inherited =
            defaults.find((r) => r.event === e.event && r.channel === channel) ?? null;
          return { channel, versions, inherited };
        }),
      })),
    };
  }

  /**
   * Saves a new version. SMS and email take effect at once. A WhatsApp version is used inside the
   * 24-hour window at once, but outside it only after Meta approves it and a super admin marks it.
   */
  async addVersion(input: z.infer<typeof TemplateVersion>) {
    const problems = checkTemplate(input.event, input.body);
    if (problems.length)
      throw new BadRequestException({
        code: 'TEMPLATE_UNSAFE',
        message: problems.join(' '),
        problems,
      });
    const latest = await this.prisma.messageTemplate.findFirst({
      where: {
        airlineId: input.airlineId,
        event: input.event,
        channel: input.channel,
        language: 'en',
      },
      orderBy: { version: 'desc' },
    });
    const row = await this.prisma.messageTemplate.create({
      data: {
        airlineId: input.airlineId,
        event: input.event,
        channel: input.channel,
        body: input.body,
        buttons: (EVENT_BY_NAME.get(input.event)?.buttons ??
          []) as unknown as Prisma.InputJsonValue,
        providerName: input.providerName ?? null,
        version: (latest?.version ?? 0) + 1,
        approved: input.channel !== 'WHATSAPP',
      },
    });
    await this.audit.record({
      action: 'message_template.version',
      entity: 'MessageTemplate',
      entityId: row.id,
      before: latest ? { version: latest.version, body: latest.body } : undefined,
      after: { version: row.version, body: row.body, channel: row.channel, event: row.event },
    });
    return row;
  }

  /** Marks a WhatsApp version as approved by Meta under `providerName`. */
  async approve(id: string, providerName: string) {
    const row = await this.prisma.messageTemplate.findUnique({ where: { id } });
    if (!row)
      throw new NotFoundException({ code: 'TEMPLATE_NOT_FOUND', message: 'No such template.' });
    if (row.channel !== 'WHATSAPP')
      throw new BadRequestException({
        code: 'NOT_WHATSAPP',
        message: 'Only WhatsApp templates need approval.',
      });
    const updated = await this.prisma.messageTemplate.update({
      where: { id },
      data: { approved: true, providerName },
    });
    await this.audit.record({
      action: 'message_template.approve',
      entity: 'MessageTemplate',
      entityId: id,
      before: { approved: row.approved, providerName: row.providerName },
      after: { approved: true, providerName, placeholders: variablesIn(row.body) },
    });
    return updated;
  }
}

@ApiTags('admin')
@Controller({ path: 'admin/message-templates', version: '1' })
export class AdminTemplatesController {
  constructor(private readonly templates: TemplatesService) {}

  @Get()
  @AdminRead()
  list(@Query('airlineId') airlineId?: string) {
    return this.templates.list(airlineId && /^[0-9a-f-]{36}$/.test(airlineId) ? airlineId : null);
  }

  @Post()
  @SuperAdminOnly()
  @ApiZodBody(TemplateVersion)
  add(@Body(new ZodPipe(TemplateVersion)) body: z.infer<typeof TemplateVersion>) {
    return this.templates.addVersion(body);
  }

  @Post(':id/approve')
  @HttpCode(200)
  @SuperAdminOnly()
  @ApiZodBody(Approve)
  approve(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(Approve)) body: z.infer<typeof Approve>,
  ) {
    return this.templates.approve(id, body.providerName);
  }
}

// ---------- admin: messages on a booking, and sending one by hand ----------

const OpsSend = z.object({
  event: z.string().refine((e) => EVENT_BY_NAME.has(e) && e !== 'change.code', 'Unknown event'),
  legId: z.string().uuid().optional(),
  reason: z.string().trim().max(200).optional(),
});

@ApiTags('admin')
@Controller({ path: 'admin/bookings', version: '1' })
export class AdminBookingMessagesController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly messaging: MessagingService,
  ) {}

  /** Messages sent, with delivery status, and the traveller's replies (ADM-05, NTF-02). */
  @Get(':id/messages')
  @AdminRead()
  async messages(@Param('id', ParseUUIDPipe) id: string) {
    const [notifications, replies, calls] = await Promise.all([
      this.prisma.notification.findMany({
        where: { bookingId: id },
        orderBy: { time: 'asc' },
        select: {
          id: true,
          template: true,
          channel: true,
          kind: true,
          status: true,
          preview: true,
          error: true,
          fallbackForId: true,
          sentAt: true,
          deliveredAt: true,
          readAt: true,
          time: true,
          legId: true,
        },
      }),
      this.prisma.travellerReply.findMany({ where: { bookingId: id }, orderBy: { time: 'asc' } }),
      this.prisma.callLog.findMany({ where: { leg: { bookingId: id } }, orderBy: { time: 'asc' } }),
    ]);
    return { notifications, replies, calls };
  }

  /** Ops sends any timeline message by hand (Phase 0, and to resend). Same templates and fallback. */
  @Post(':id/messages')
  @HttpCode(200)
  @AdminWrite()
  @ApiZodBody(OpsSend)
  async send(
    @Req() req: AuthedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(OpsSend)) body: z.infer<typeof OpsSend>,
  ) {
    const admin = requireAdmin(req);
    const b = await this.prisma.transferBooking.findUnique({
      where: { id },
      include: { legs: true },
    });
    if (!b) throw new NotFoundException({ code: 'BOOKING_NOT_FOUND', message: 'No such booking.' });
    if (body.legId && !b.legs.some((l) => l.id === body.legId))
      throw new BadRequestException({
        code: 'LEG_INVALID',
        message: 'That leg is not on this booking.',
      });
    const key = await this.messaging.notify(body.event, {
      bookingId: id,
      legId: body.legId ?? null,
      extra: body.reason ? { reason: body.reason } : {},
      instance: `ops${Date.now()}`,
    });
    await this.prisma.bookingEvent.create({
      data: {
        bookingId: id,
        type: 'message.sent_by_ops',
        actorRole: 'OPS',
        actorId: admin.userId,
        data: { event: body.event, key },
      },
    });
    return { queued: true, key };
  }
}

// ---------- development only (ACC-12): the fake phone ----------

const DevInbound = z.object({
  channel: z.enum(['WHATSAPP', 'SMS']),
  from: z.string().regex(/^\+\d{8,15}$/),
  text: z.string().max(500).optional(),
  buttonPayload: z.string().max(300).optional(),
  contextId: z.string().max(200).optional(),
});

/**
 * Lets a developer (and the end-to-end flow) see what the fake providers "sent" and tap a reply,
 * which is posted through the real signed webhook handlers. Not found outside development and test.
 */
@ApiTags('dev')
@Controller({ path: 'dev/phone', version: '1' })
export class DevPhoneController {
  constructor(
    private readonly hooks: MessagingWebhookController,
    @Inject(WHATSAPP) private readonly whatsapp: WhatsAppAdapter,
  ) {}

  private guard() {
    if (!fakeProvidersAllowed() || this.whatsapp.mode !== 'fake') throw new NotFoundException();
  }

  @Get('outbox')
  @Public()
  @ApiExcludeEndpoint()
  outbox(@Query('to') to?: string) {
    this.guard();
    return { messages: fakeOutbox.list(to) };
  }

  @Post('inbound')
  @HttpCode(200)
  @Public()
  @ApiExcludeEndpoint()
  async inbound(@Body(new ZodPipe(DevInbound)) b: z.infer<typeof DevInbound>) {
    this.guard();
    const id = `dev_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    if (b.channel === 'WHATSAPP') {
      const message: Record<string, unknown> = {
        from: b.from.slice(1),
        id: `wamid.${id}`,
        timestamp: String(Math.floor(Date.now() / 1000)),
      };
      if (b.buttonPayload)
        Object.assign(message, {
          type: 'button',
          button: { payload: b.buttonPayload, text: b.text ?? '' },
        });
      else Object.assign(message, { type: 'text', text: { body: b.text ?? '' } });
      if (b.contextId) message.context = { id: b.contextId };
      const raw = Buffer.from(
        JSON.stringify({ entry: [{ changes: [{ value: { messages: [message] } }] }] }),
      );
      return this.hooks.whatsappHook(
        { rawBody: raw } as AuthedRequest,
        metaSignature(raw, FAKE_WHATSAPP_APP_SECRET),
      );
    }
    const raw = Buffer.from(
      JSON.stringify({ type: 'inbound', id, sender: b.from.slice(1), message: b.text ?? '' }),
    );
    return this.hooks.smsHook(
      { rawBody: raw } as AuthedRequest,
      termiiSignature(raw, FAKE_TERMII_KEY),
    );
  }
}

@Module({
  imports: [SupportModule, CallsModule],
  controllers: [
    MessagingWebhookController,
    AdminTemplatesController,
    AdminBookingMessagesController,
    DevPhoneController,
  ],
  providers: [
    MessageComposer,
    MessagingService,
    MessagingProcessor,
    RepliesService,
    TemplatesService,
    MessagingWebhookController,
  ],
  exports: [MessagingService, MessageComposer],
})
export class MessagingModule {}
