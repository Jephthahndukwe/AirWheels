import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Injectable, Logger, Module } from '@nestjs/common';
import type { Job, Queue } from 'bullmq';
import { SMS, type SmsAdapter, WHATSAPP, type WhatsAppAdapter } from '../../adapters/interfaces';
import { PrismaService } from '../../common/prisma.service';
import { QUEUES } from '../../queues/queues';

export interface TravellerMessageJob {
  bookingId: string;
  event: string; // e.g. booking.confirmed (PRD 7.1)
  to: string;
  whatsapp: boolean;
  variables: Record<string, string>;
}

/** Queues traveller messages. WhatsApp first, SMS fallback (TRV-01, NTF-01). */
@Injectable()
export class MessagingService {
  constructor(@InjectQueue(QUEUES.messaging) private readonly queue: Queue) {}

  enqueueTraveller(job: TravellerMessageJob) {
    // BullMQ job ids may not contain ':'. One id per booking and event makes retries idempotent.
    return this.queue.add('traveller', job, { jobId: `${job.bookingId}-${job.event.replace(/[^a-z0-9]/gi, '-')}` });
  }
}

@Processor(QUEUES.messaging)
export class MessagingProcessor extends WorkerHost {
  private readonly log = new Logger(MessagingProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(WHATSAPP) private readonly whatsapp: WhatsAppAdapter,
    @Inject(SMS) private readonly sms: SmsAdapter,
  ) {
    super();
  }

  async process(job: Job<TravellerMessageJob>) {
    const m = job.data;
    const text = renderFallback(m.event, m.variables);

    if (m.whatsapp) {
      try {
        const r = await this.whatsapp.sendTemplate({
          to: m.to,
          template: m.event,
          language: 'en',
          variables: m.variables,
        });
        await this.record(m, 'WHATSAPP', 'SENT', r.providerMessageId);
        return;
      } catch (err) {
        this.log.warn({ bookingId: m.bookingId, err }, 'WhatsApp failed, falling back to SMS');
      }
    }
    const r = await this.sms.send(m.to, text);
    await this.record(m, 'SMS', 'SENT', r.providerMessageId);
  }

  private record(m: TravellerMessageJob, channel: 'WHATSAPP' | 'SMS', status: 'SENT', id: string) {
    return this.prisma.notification.create({
      data: {
        recipient: m.to,
        recipientRole: 'TRAVELLER',
        bookingId: m.bookingId,
        template: m.event,
        channel,
        status,
        providerMessageId: id,
      },
    });
  }
}

/** Plain-text body for SMS. Per-airline templates from MessageTemplate replace this in M3. */
function renderFallback(event: string, v: Record<string, string>): string {
  switch (event) {
    case 'booking.confirmed':
      return `${v.serviceName}: your airport transfer is confirmed. Pickup code ${v.pickupCodes}. Track: ${v.trackingUrl}`;
    default:
      return `${v.serviceName ?? 'Airwheels'}: update on your transfer. ${v.trackingUrl ?? ''}`;
  }
}

@Module({ providers: [MessagingService, MessagingProcessor], exports: [MessagingService] })
export class MessagingModule {}
