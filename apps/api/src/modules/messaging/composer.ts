import { Injectable } from '@nestjs/common';
import type { MessageTemplate, NotificationChannel, Plan } from '@prisma/client';
import { decrypt } from '../../common/crypto';
import { PrismaService } from '../../common/prisma.service';
import { ConfigStore } from '../config/config.service';
import { CONFIG } from '../config/keys';
import { pickupCodeFor } from '../traveller-access/codes';
import { EVENT_BY_NAME, type EventDef, areaOf, firstNameOf } from './catalog';

export const lagosTime = (d: Date | null | undefined) =>
  d
    ? new Intl.DateTimeFormat('en-NG', {
        timeZone: 'Africa/Lagos',
        weekday: 'short',
        day: 'numeric',
        month: 'short',
        hour: 'numeric',
        minute: '2-digit',
      }).format(d)
    : 'to be confirmed';

export const webBase = () => process.env.WEB_PUBLIC_URL ?? 'http://localhost:3000';

/** A template ready to send: from the airline's own row, our default row, or the built-in default. */
export interface ResolvedTemplate {
  body: string;
  version: number | null;
  approved: boolean;
  providerName: string | null;
  language: string;
}

/**
 * Builds the variables for one traveller message from the booking (PRD 7.1 "Includes"), and picks
 * the template: the airline's latest version, else our default, else the built-in catalogue.
 * Only first names and areas go in; the pickup code is the recipient's own.
 */
@Injectable()
export class MessageComposer {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigStore,
  ) {}

  async context(bookingId: string, legId?: string | null) {
    const b = await this.prisma.transferBooking.findUnique({
      where: { id: bookingId },
      include: {
        airline: true,
        traveller: true,
        trackingToken: true,
        legs: {
          orderBy: { type: 'asc' },
          include: {
            flight: true,
            driver: true,
            vehicle: true,
            group: {
              include: {
                stops: {
                  include: { leg: { include: { booking: { include: { traveller: true } } } } },
                },
              },
            },
          },
        },
      },
    });
    if (!b) return null;
    const leg = (legId && b.legs.find((l) => l.id === legId)) || b.legs[0] || null;
    return { booking: b, leg, traveller: b.traveller, legSpecific: !!legId };
  }

  trackingUrl(token: string | null, path = '') {
    return token ? `${webBase()}/t/${token}${path}` : webBase();
  }

  async variables(
    ctx: NonNullable<Awaited<ReturnType<MessageComposer['context']>>>,
    extra: Record<string, string> = {},
  ): Promise<Record<string, string>> {
    const { booking: b, leg, traveller } = ctx;
    const token = b.trackingToken?.tokenEncrypted ? decrypt(b.trackingToken.tokenEncrypted) : null;
    const timings = await this.config.get<{ freeWaitMinutes: Record<Plan, number> }>(
      CONFIG.messagingTimings,
    );
    const meeting = leg?.pickupPointId
      ? await this.prisma.pickupPoint.findUnique({ where: { id: leg.pickupPointId } })
      : null;
    const stops = leg?.group?.stops ?? [];
    const legLabel = (l: (typeof b.legs)[number]) =>
      l.type === 'DEPARTURE'
        ? `To the airport ${lagosTime(l.scheduledAt)} from ${areaOf(l.pickupText)}`
        : `From the airport ${l.flight ? `(flight ${l.flight.flightNumber})` : ''} to ${areaOf(l.dropoffText)}`;
    const codes =
      leg && ctx.legSpecific
        ? pickupCodeFor(leg.id, leg.pickupCodeVersion)
        : b.legs.map((l) => pickupCodeFor(l.id, l.pickupCodeVersion)).join(' / ');
    const vars: Record<string, string> = {
      serviceName: b.airline?.serviceBrandName ?? 'Airwheels',
      firstName: firstNameOf(traveller?.name ?? ''),
      trackingUrl: this.trackingUrl(token, extra.trackingPath ?? ''),
      legsSummary: b.legs.map(legLabel).join('; '),
      pickupTime: lagosTime(leg?.scheduledAt),
      pickupArea: leg ? areaOf(leg.pickupText) : '',
      dropoffArea: leg ? areaOf(leg.dropoffText) : '',
      pickupCode: codes,
      driverFirstName: leg?.driver?.firstName ?? 'your driver',
      car: leg?.vehicle ? `${leg.vehicle.brand} ${leg.vehicle.model}` : 'car',
      carColour: leg?.vehicle?.colour.toLowerCase() ?? '',
      plate: leg?.vehicle?.plate ?? '',
      meetingPoint: meeting
        ? `${meeting.name}${meeting.directions ? ` (${meeting.directions})` : ''}`
        : leg?.type === 'ARRIVAL'
          ? 'the arrivals exit'
          : 'your pickup point',
      freeWaitMinutes: String(timings.freeWaitMinutes[b.plan] ?? 30),
      flightNumber: leg?.flight?.flightNumber ?? '',
      stopNumber: leg?.stopNumber ? String(leg.stopNumber) : '',
      stopCount: stops.length ? String(stops.length) : '',
      coTravellers: stops
        .filter((s) => s.legId !== leg?.id)
        .map((s) => firstNameOf(s.leg.booking.traveller?.name ?? ''))
        .filter(Boolean)
        .join(' and '),
    };
    for (const [k, v] of Object.entries(extra)) if (k !== 'trackingPath') vars[k] = v;
    return vars;
  }

  async template(
    airlineId: string | null,
    def: EventDef,
    channel: NotificationChannel,
  ): Promise<ResolvedTemplate> {
    const find = (aid: string | null): Promise<MessageTemplate | null> =>
      this.prisma.messageTemplate.findFirst({
        where: { airlineId: aid, event: def.event, channel, language: 'en' },
        orderBy: { version: 'desc' },
      });
    const row = (airlineId ? await find(airlineId) : null) ?? (await find(null));
    if (row)
      return {
        body: row.body,
        version: row.version,
        approved: row.approved,
        providerName: row.providerName,
        language: row.language,
      };
    return {
      body: channel === 'SMS' ? (def.sms ?? def.body) : def.body,
      version: null,
      approved: false,
      providerName: null,
      language: 'en',
    };
  }

  /** The latest version that Meta has approved, for messages outside the 24-hour window. */
  async approvedWhatsAppTemplate(
    airlineId: string | null,
    event: string,
  ): Promise<ResolvedTemplate | null> {
    const find = (aid: string | null) =>
      this.prisma.messageTemplate.findFirst({
        where: {
          airlineId: aid,
          event,
          channel: 'WHATSAPP',
          language: 'en',
          approved: true,
          providerName: { not: null },
        },
        orderBy: { version: 'desc' },
      });
    const row = (airlineId ? await find(airlineId) : null) ?? (await find(null));
    return row
      ? {
          body: row.body,
          version: row.version,
          approved: true,
          providerName: row.providerName,
          language: row.language,
        }
      : null;
  }
}

export const eventDef = (event: string): EventDef => {
  const d = EVENT_BY_NAME.get(event);
  if (!d) throw new Error(`Unknown message event ${event}`);
  return d;
};
