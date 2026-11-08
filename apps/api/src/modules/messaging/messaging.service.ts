import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Notification, NotificationStatus, Prisma } from '@prisma/client';
import type { Job, Queue } from 'bullmq';
import {
  EMAIL,
  type EmailAdapter,
  SMS,
  type SmsAdapter,
  type StatusUpdate,
  WHATSAPP,
  type WhatsAppAdapter,
} from '../../adapters/interfaces';
import { PrismaService } from '../../common/prisma.service';
import { QUEUES } from '../../queues/queues';
import { RealtimeGateway } from '../../realtime/realtime.gateway';
import { ConfigStore } from '../config/config.service';
import { CONFIG } from '../config/keys';
import { AlertsService } from '../support/alerts.service';
import {
  type Button,
  buttonPayload,
  insideWindow,
  preview,
  render,
  smsReplyHint,
  variablesIn,
} from './catalog';
import { MessageComposer, eventDef } from './composer';

export interface NotifyOptions {
  bookingId: string;
  legId?: string | null;
  /** Extra variables (reason, cost, options, minutesAway, changeCode, text, trackingPath). */
  extra?: Record<string, string>;
  /**
   * Makes this message distinct from earlier sends of the same event, for example a new pickup
   * code version or a new pickup time. Same key, same message: retries never send twice.
   */
  instance?: string;
}

export interface SendJob extends NotifyOptions {
  event: string;
  key: string;
}

interface DeliverySettings {
  whatsappDeliveryTimeoutSeconds: number;
  whatsappWindowHours: number;
  smsAttempts: number;
}

const jobId = (key: string, stage: string) => `${stage}-${key}`.replace(/[^a-zA-Z0-9_-]/g, '-');
const RANK: Record<NotificationStatus, number> = {
  QUEUED: 0,
  SENT: 1,
  FAILED: 1,
  DELIVERED: 2,
  READ: 3,
};

/**
 * Traveller messaging (TRV-01, TRV-02, NTF-01 to NTF-03).
 *
 * WhatsApp first, through an approved template when we start the conversation, or free-form with
 * buttons inside the 24-hour window after the traveller last wrote to us. If WhatsApp fails, or the
 * message is not delivered within the configured time, the same message goes by SMS with
 * "Reply 1 for ..." hints. Receipts also go by email. Every attempt is a Notification row with its
 * delivery status, and every stage is idempotent, so a queue retry never sends twice.
 */
@Injectable()
export class MessagingService {
  private readonly log = new Logger(MessagingService.name);

  constructor(
    @InjectQueue(QUEUES.messaging) private readonly queue: Queue,
    private readonly prisma: PrismaService,
    private readonly composer: MessageComposer,
    private readonly config: ConfigStore,
    private readonly alerts: AlertsService,
    private readonly realtime: RealtimeGateway,
    @Inject(WHATSAPP) private readonly whatsapp: WhatsAppAdapter,
    @Inject(SMS) private readonly sms: SmsAdapter,
    @Inject(EMAIL) private readonly email: EmailAdapter,
  ) {}

  /** Queues one traveller message. Returns its key (the same key twice is one message). */
  async notify(event: string, o: NotifyOptions) {
    eventDef(event);
    const key = [o.bookingId, o.legId ?? '-', event, o.instance ?? ''].join(':');
    const settings = await this.settings();
    await this.queue.add('send', { ...o, event, key } satisfies SendJob, {
      jobId: jobId(key, 'send'),
      attempts: settings.smsAttempts,
      backoff: { type: 'exponential', delay: 2_000 },
      removeOnComplete: 1000,
      removeOnFail: 1000,
    });
    return key;
  }

  private settings() {
    return this.config.get<DeliverySettings>(CONFIG.messagingDelivery);
  }

  // ---------- sending ----------

  async send(job: SendJob, finalAttempt: boolean) {
    const def = eventDef(job.event);
    const ctx = await this.composer.context(job.bookingId, job.legId);
    if (!ctx?.traveller) return { skipped: 'no traveller' };
    const vars = await this.composer.variables(ctx, job.extra);
    const t = ctx.traveller;
    const airlineId = ctx.booking.airlineId;

    let needSms = !t.whatsapp || !!def.bothChannels;
    if (t.whatsapp) {
      const wa = await this.sendWhatsApp(job, def.buttons, vars, airlineId, t.phone);
      if (wa === 'failed' || wa === 'unavailable') needSms = true;
    }
    if (needSms) await this.sendSms(job, def.buttons, vars, airlineId, t.phone, finalAttempt);
    if (def.emailSubject && t.email)
      await this.sendEmail(job, def.emailSubject, vars, airlineId, t.email);
    return { sent: true };
  }

  private async sendWhatsApp(
    job: SendJob,
    buttons: Button[] | undefined,
    vars: Record<string, string>,
    airlineId: string | null,
    phone: string,
  ): Promise<'sent' | 'failed' | 'unavailable' | 'done'> {
    const existing = await this.prisma.notification.findUnique({
      where: { dedupeKey: `${job.key}:wa` },
    });
    if (existing && existing.status !== 'QUEUED')
      return existing.status === 'FAILED' ? 'failed' : 'done';

    const settings = await this.settings();
    const win = await this.prisma.conversationWindow.findUnique({ where: { phone } });
    const open = insideWindow(win?.lastInboundAt, new Date(), settings.whatsappWindowHours);
    const def = eventDef(job.event);
    // The 24-hour rule (PRD 7.3): outside the window only an approved template may be sent.
    const tpl = open
      ? await this.composer.template(airlineId, def, 'WHATSAPP')
      : await this.composer.approvedWhatsAppTemplate(airlineId, job.event);
    if (!tpl) return 'unavailable';

    const n =
      existing ??
      (await this.prisma.notification.create({
        data: {
          dedupeKey: `${job.key}:wa`,
          recipient: phone,
          recipientRole: 'TRAVELLER',
          bookingId: job.bookingId,
          legId: job.legId ?? null,
          template: job.event,
          templateVersion: tpl.version,
          channel: 'WHATSAPP',
          kind: open ? 'SESSION' : 'TEMPLATE',
          preview: preview(tpl.body, vars),
          buttons: (buttons ?? []) as unknown as Prisma.InputJsonValue,
        },
      }));
    const payloads = (buttons ?? []).map((b) => ({
      payload: buttonPayload(b.intent, n.id),
      title: b.title,
    }));
    const text = render(tpl.body, vars);
    try {
      const r = open
        ? payloads.length
          ? await this.whatsapp.sendInteractive({ to: phone, body: text, buttons: payloads })
          : await this.whatsapp.sendText(phone, text)
        : await this.whatsapp.sendTemplate({
            to: phone,
            template: tpl.providerName!,
            language: tpl.language,
            params: variablesIn(tpl.body).map((v) => vars[v] ?? ''),
            buttons: payloads,
            text,
          });
      await this.prisma.notification.update({
        where: { id: n.id },
        data: { status: 'SENT', providerMessageId: r.providerMessageId, sentAt: new Date() },
      });
      // Not delivered in time? Then SMS (NTF-01).
      await this.queue.add('fallback', job, {
        jobId: jobId(job.key, 'fallback'),
        delay: settings.whatsappDeliveryTimeoutSeconds * 1000,
        removeOnComplete: 1000,
        removeOnFail: 1000,
      });
      return 'sent';
    } catch (err) {
      this.log.warn(
        { bookingId: job.bookingId, event: job.event, err: (err as Error).message },
        'WhatsApp failed, falling back to SMS',
      );
      await this.prisma.notification.update({
        where: { id: n.id },
        data: { status: 'FAILED', error: (err as Error).message.slice(0, 300) },
      });
      return 'failed';
    }
  }

  private async sendSms(
    job: SendJob,
    buttons: Button[] | undefined,
    vars: Record<string, string>,
    airlineId: string | null,
    phone: string,
    finalAttempt: boolean,
  ) {
    const key = `${job.key}:sms`;
    const existing = await this.prisma.notification.findUnique({ where: { dedupeKey: key } });
    if (existing && existing.status !== 'QUEUED' && existing.status !== 'FAILED') return;
    const def = eventDef(job.event);
    const tpl = await this.composer.template(airlineId, def, 'SMS');
    const hint = smsReplyHint(buttons);
    const body = [tpl.body, hint].filter(Boolean).join(' ');
    const wa = await this.prisma.notification.findUnique({ where: { dedupeKey: `${job.key}:wa` } });
    const n =
      existing ??
      (await this.prisma.notification.create({
        data: {
          dedupeKey: key,
          recipient: phone,
          recipientRole: 'TRAVELLER',
          bookingId: job.bookingId,
          legId: job.legId ?? null,
          template: job.event,
          templateVersion: tpl.version,
          channel: 'SMS',
          preview: preview(body, vars),
          buttons: (buttons ?? []) as unknown as Prisma.InputJsonValue,
          fallbackForId: wa?.id ?? null,
        },
      }));
    try {
      const r = await this.sms.send(phone, render(body, vars));
      await this.prisma.notification.update({
        where: { id: n.id },
        data: {
          status: 'SENT',
          providerMessageId: r.providerMessageId,
          sentAt: new Date(),
          error: null,
        },
      });
    } catch (err) {
      await this.prisma.notification.update({
        where: { id: n.id },
        data: { status: 'FAILED', error: (err as Error).message.slice(0, 300) },
      });
      // PRD 8.5: retry, fall back to SMS, then alert ops.
      if (finalAttempt)
        await this.alerts.raise({
          type: 'MESSAGE_UNDELIVERED',
          message: `Could not reach the traveller for "${eventDef(job.event).label}" by WhatsApp or SMS.`,
          bookingId: job.bookingId,
          legId: job.legId ?? undefined,
          data: { event: job.event },
        });
      throw err;
    }
  }

  private async sendEmail(
    job: SendJob,
    subject: string,
    vars: Record<string, string>,
    airlineId: string | null,
    to: string,
  ) {
    const key = `${job.key}:email`;
    const existing = await this.prisma.notification.findUnique({ where: { dedupeKey: key } });
    if (existing && existing.status !== 'QUEUED') return;
    const tpl = await this.composer.template(airlineId, eventDef(job.event), 'EMAIL');
    const text = render(tpl.body, vars);
    const n =
      existing ??
      (await this.prisma.notification.create({
        data: {
          dedupeKey: key,
          recipient: to,
          recipientRole: 'TRAVELLER',
          bookingId: job.bookingId,
          legId: job.legId ?? null,
          template: job.event,
          channel: 'EMAIL',
          preview: preview(tpl.body, vars),
        },
      }));
    try {
      const esc = (s: string) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
      const r = await this.email.send({
        to,
        subject: `${vars.serviceName}: ${subject}`,
        text,
        html: `<p>${esc(text)}</p>`,
      });
      await this.prisma.notification.update({
        where: { id: n.id },
        data: { status: 'SENT', providerMessageId: r.providerMessageId, sentAt: new Date() },
      });
    } catch (err) {
      // A missing receipt email never blocks WhatsApp or SMS; ops sees it on the booking.
      await this.prisma.notification.update({
        where: { id: n.id },
        data: { status: 'FAILED', error: (err as Error).message.slice(0, 300) },
      });
    }
  }

  /** Runs after the delivery timeout, or at once when WhatsApp reports a failure. */
  async fallback(job: SendJob, finalAttempt: boolean) {
    const wa = await this.prisma.notification.findUnique({ where: { dedupeKey: `${job.key}:wa` } });
    if (wa && (wa.status === 'DELIVERED' || wa.status === 'READ')) return { fallback: false };
    const ctx = await this.composer.context(job.bookingId, job.legId);
    if (!ctx?.traveller) return { fallback: false };
    const vars = await this.composer.variables(ctx, job.extra);
    await this.sendSms(
      job,
      eventDef(job.event).buttons,
      vars,
      ctx.booking.airlineId,
      ctx.traveller.phone,
      finalAttempt,
    );
    return { fallback: true };
  }

  // ---------- delivery status (webhooks) ----------

  /** Applies a provider delivery report. Status only moves forward; a WhatsApp failure triggers SMS now. */
  async applyStatus(u: StatusUpdate): Promise<Notification | null> {
    const n = await this.prisma.notification.findUnique({
      where: { providerMessageId: u.providerMessageId },
    });
    if (!n) return null;
    if (
      RANK[u.status] < RANK[n.status] ||
      (u.status === 'FAILED' && RANK[n.status] >= RANK.DELIVERED)
    )
      return n;
    if (u.status === n.status) return n;
    const now = new Date();
    const updated = await this.prisma.notification.update({
      where: { id: n.id },
      data: {
        status: u.status,
        error: u.error?.slice(0, 300) ?? n.error,
        deliveredAt:
          u.status === 'DELIVERED' || u.status === 'READ' ? (n.deliveredAt ?? now) : n.deliveredAt,
        readAt: u.status === 'READ' ? now : n.readAt,
      },
    });
    if (n.bookingId)
      this.realtime.emit('ops', 'notification.updated', {
        id: n.id,
        bookingId: n.bookingId,
        status: u.status,
      });
    if (u.status === 'FAILED' && n.channel === 'WHATSAPP' && n.dedupeKey) {
      const key = n.dedupeKey.replace(/:wa$/, '');
      const [bookingId, legId, event, instance] = key.split(':');
      const job: SendJob = {
        key,
        event: event!,
        bookingId: bookingId!,
        legId: legId === '-' ? null : legId,
        instance,
      };
      await this.queue.add('fallback', job, {
        jobId: jobId(key, 'fallback-now'),
        removeOnComplete: 1000,
      });
    }
    return updated;
  }
}

@Processor(QUEUES.messaging)
export class MessagingProcessor extends WorkerHost {
  constructor(private readonly messaging: MessagingService) {
    super();
  }

  async process(job: Job<SendJob>) {
    const final = job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
    if (job.name === 'fallback') return this.messaging.fallback(job.data, final);
    return this.messaging.send(job.data, final);
  }
}
