import { Injectable, Logger } from '@nestjs/common';
import type { NotificationChannel, Prisma } from '@prisma/client';
import type { InboundMessage } from '../../adapters/interfaces';
import { PrismaService } from '../../common/prisma.service';
import { RealtimeGateway } from '../../realtime/realtime.gateway';
import { CallsService } from '../calls/calls.module';
import { AlertsService } from '../support/alerts.service';
import {
  type Button,
  type ReplyIntent,
  matchTypedIntent,
  parseButtonPayload,
  smsNumberReply,
} from './catalog';
import { MessagingService } from './messaging.service';

const SIGNALS: ReplyIntent[] = [
  'COMING_OUT',
  'FIVE_MINUTES',
  'GETTING_BAGS',
  'AT_MEETING_POINT',
  'LANDED',
];
const SIGNAL_TEXT: Record<string, string> = {
  COMING_OUT: "I'm coming out",
  FIVE_MINUTES: 'Give me 5 minutes',
  GETTING_BAGS: 'Getting my bags',
  AT_MEETING_POINT: "I'm at the meeting point",
  LANDED: "I've landed",
};

export interface ReplyOutcome {
  duplicate: boolean;
  bookingId: string | null;
  intent: ReplyIntent | null;
  action: string;
}

/**
 * Inbound traveller replies (TRV-13 to TRV-15). WhatsApp button taps, SMS number replies ("1") and
 * typed text are mapped to a booking and an intent, stored once (keyed by the provider's message
 * id, so repeated deliveries and repeated taps are harmless) and turned into booking events.
 * Signals are extra information: a trip never waits on them (PRD 7.3). Anything unclear goes to ops.
 */
@Injectable()
export class RepliesService {
  private readonly log = new Logger(RepliesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly messaging: MessagingService,
    private readonly calls: CallsService,
    private readonly alerts: AlertsService,
    private readonly realtime: RealtimeGateway,
  ) {}

  async handle(
    channel: Extract<NotificationChannel, 'WHATSAPP' | 'SMS'>,
    m: InboundMessage,
  ): Promise<ReplyOutcome> {
    if (
      await this.prisma.travellerReply.findUnique({
        where: { providerMessageId: m.providerMessageId },
      })
    )
      return { duplicate: true, bookingId: null, intent: null, action: 'duplicate' };

    // Any inbound WhatsApp message opens the 24-hour window for free-form replies (PRD 7.3).
    if (channel === 'WHATSAPP')
      await this.prisma.conversationWindow.upsert({
        where: { phone: m.from },
        create: { phone: m.from, lastInboundAt: m.at },
        update: { lastInboundAt: m.at },
      });

    const { intent, notification } = await this.resolve(channel, m);
    const bookingId = notification?.bookingId ?? (await this.latestBookingFor(m.from));
    if (!bookingId) {
      await this.alerts.raise({
        type: 'TRAVELLER_MESSAGE',
        message: `Message from a number with no booking (${channel.toLowerCase()}): "${(m.text ?? '').slice(0, 200)}"`,
      });
      return { duplicate: false, bookingId: null, intent, action: 'routed_to_ops' };
    }
    const legId = notification?.legId ?? (await this.activeLeg(bookingId));

    try {
      await this.prisma.travellerReply.create({
        data: {
          bookingId,
          legId,
          channel,
          buttonOrText: (m.buttonPayload
            ? (m.text ?? m.buttonPayload.split('|')[0] ?? '')
            : (m.text ?? '')
          ).slice(0, 500),
          mappedIntent: intent ?? 'UNMATCHED',
          providerMessageId: m.providerMessageId,
          time: m.at,
        },
      });
    } catch (e) {
      if ((e as { code?: string }).code === 'P2002')
        return { duplicate: true, bookingId, intent, action: 'duplicate' };
      throw e;
    }
    const action = await this.act(intent, bookingId, legId, m);
    this.realtime.emit(`booking:${bookingId}`, 'booking.updated', { bookingId, reply: intent });
    return { duplicate: false, bookingId, intent, action };
  }

  private async resolve(channel: NotificationChannel, m: InboundMessage) {
    // 1. A WhatsApp button carries the intent and the message it came from.
    if (m.buttonPayload) {
      const p = parseButtonPayload(m.buttonPayload);
      if (p) {
        const notification = p.notificationId
          ? await this.prisma.notification.findUnique({ where: { id: p.notificationId } })
          : m.contextId
            ? await this.prisma.notification.findUnique({
                where: { providerMessageId: m.contextId },
              })
            : null;
        // A payload naming someone else's message is ignored, not trusted.
        if (
          !notification ||
          notification.recipient.replace(/\D/g, '') === m.from.replace(/\D/g, '')
        )
          return { intent: p.intent, notification };
      }
    }
    // 2. A typed reply to a WhatsApp message keeps its context.
    const context = m.contextId
      ? await this.prisma.notification.findUnique({ where: { providerMessageId: m.contextId } })
      : null;
    // 3. SMS "1", "2", "3": the buttons of the last SMS that offered them.
    if (channel === 'SMS') {
      const n = smsNumberReply(m.text ?? '');
      if (n) {
        const last = await this.prisma.notification.findFirst({
          where: {
            recipient: m.from,
            channel: 'SMS',
            status: { not: 'FAILED' },
            time: { gte: new Date(Date.now() - 48 * 3_600_000) },
            NOT: { buttons: { equals: [] } },
          },
          orderBy: { time: 'desc' },
        });
        const buttons = (last?.buttons as Button[] | null) ?? [];
        if (last && buttons[n - 1]) return { intent: buttons[n - 1]!.intent, notification: last };
      }
    }
    // 4. Simple words; else unclear (ops).
    const recent =
      context ??
      (await this.prisma.notification.findFirst({
        where: {
          recipient: m.from,
          bookingId: { not: null },
          time: { gte: new Date(Date.now() - 7 * 86_400_000) },
        },
        orderBy: { time: 'desc' },
      }));
    return { intent: m.text ? matchTypedIntent(m.text) : null, notification: recent };
  }

  private async latestBookingFor(phone: string) {
    const b = await this.prisma.transferBooking.findFirst({
      where: {
        traveller: { phone },
        status: { in: ['CONFIRMED', 'IN_PROGRESS', 'PENDING_PAYMENT', 'COMPLETED'] },
      },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });
    return b?.id ?? null;
  }

  private async activeLeg(bookingId: string) {
    const legs = await this.prisma.rideLeg.findMany({
      where: { bookingId },
      orderBy: { scheduledAt: 'asc' },
    });
    const open = legs.find((l) => !['COMPLETED', 'CANCELLED', 'NO_SHOW'].includes(l.status));
    return (open ?? legs[legs.length - 1])?.id ?? null;
  }

  private event(bookingId: string, type: string, data: object) {
    return this.prisma.bookingEvent.create({
      data: { bookingId, type, actorRole: 'TRAVELLER', data: data as Prisma.InputJsonValue },
    });
  }

  private async act(
    intent: ReplyIntent | null,
    bookingId: string,
    legId: string | null,
    m: InboundMessage,
  ) {
    const leg = legId ? await this.prisma.rideLeg.findUnique({ where: { id: legId } }) : null;
    const closed = !!leg && ['COMPLETED', 'CANCELLED', 'NO_SHOW'].includes(leg.status);
    const replyKey = m.providerMessageId.replace(/[^a-zA-Z0-9_.-]/g, '').slice(-60);
    const reply = (text: string, trackingPath = '') =>
      this.messaging.notify('reply.link', {
        bookingId,
        legId,
        extra: { text, trackingPath },
        instance: replyKey,
      });

    switch (intent) {
      case null:
        await this.alerts.raise({
          type: 'TRAVELLER_MESSAGE',
          message: `Traveller wrote: "${(m.text ?? '').slice(0, 300)}"`,
          bookingId,
          legId: legId ?? undefined,
        });
        await reply('Thanks, our support team has your message and will reply shortly.');
        return 'routed_to_ops';
      case 'CONFIRM':
        await this.event(bookingId, 'traveller.confirmed', { legId });
        return 'confirmed';
      case 'CHANGE_TIME':
      case 'CANCEL':
        await reply(
          intent === 'CANCEL'
            ? 'To cancel, open this link. We will text you a six-digit code first and show any cost before you confirm.'
            : 'To change your pickup time, open this link. We will text you a six-digit code first.',
          intent === 'CANCEL' ? '/cancel' : '/change',
        );
        await this.event(bookingId, 'traveller.change_requested', { legId, intent });
        return 'sent_change_link';
      case 'CALL_DRIVER':
        if (!legId || closed) return 'ignored_closed_leg';
        try {
          await this.calls.start(legId, 'TRAVELLER');
          return 'call_started';
        } catch (e) {
          await reply(
            (e as { response?: { message?: string } }).response?.message ?? 'Please call support.',
          );
          return 'call_not_possible';
        }
      case 'RATE_5':
        if (!legId) return 'ignored';
        await this.prisma.rating.upsert({
          where: { legId },
          create: { legId, score: 5 },
          update: {},
        });
        await this.event(bookingId, 'traveller.rated', { legId, score: 5 });
        return 'rated';
      case 'REPORT_PROBLEM':
        await this.alerts.raise({
          type: 'SUPPORT_REQUEST',
          message: 'The traveller reported a problem after the trip. Please call them.',
          bookingId,
          legId: legId ?? undefined,
        });
        await reply('Sorry to hear that. Our support team will contact you shortly.');
        return 'support_case_opened';
      default: {
        // Signals: shown to the driver and ops in real time (TRV-14). Taps on an old ride are only recorded.
        if (!SIGNALS.includes(intent)) return 'ignored';
        if (closed) return 'ignored_closed_leg';
        await this.event(bookingId, 'traveller.signal', { legId, signal: intent });
        const payload = {
          bookingId,
          legId,
          signal: intent,
          text: SIGNAL_TEXT[intent],
          at: m.at.toISOString(),
        };
        this.realtime.emit(`booking:${bookingId}`, 'leg.signal', payload);
        this.realtime.emit('ops', 'traveller.signal', payload);
        if (leg?.driverId)
          this.realtime.emit(`driver:${leg.driverId}`, 'traveller.signal', payload);
        // "I've landed" is a backup landing signal: send the arrival driver message early if ready.
        if (intent === 'LANDED' && leg?.type === 'ARRIVAL' && leg.driverId)
          await this.messaging.notify('arrival.driver_assigned', {
            bookingId,
            legId: leg.id,
            instance: leg.driverId,
          });
        return 'signal';
      }
    }
  }
}
