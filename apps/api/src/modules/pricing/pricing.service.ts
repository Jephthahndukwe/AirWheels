import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { Airline, BookingChannel, PricingRule, Quote } from '@prisma/client';
import type { LegRequest, OwnQuoteRequest, PartnerQuoteRequest, Plan, QuoteResponse, RideType, VehicleClass } from '@airwheels/types';
import { FLIGHT_STATUS, type FlightStatusAdapter } from '../../adapters/interfaces';
import { haversineKm } from '../../adapters/fakes';
import { PrismaService } from '../../common/prisma.service';
import { ConfigStore } from '../config/config.service';
import { CONFIG } from '../config/keys';
import { PickupTimesService, lagosParts } from '../dispatch/dispatch.module';
import { type CollectedBy, type QuoteResult, QuoteError, computeQuote, suggestVehicleClass } from './engine';
import { MissingRuleError, buildPricingRules, rulesInForce } from './rules';

/** What a quote was computed from. Stored on the quote so booking creation uses exactly the same trip. */
export interface StoredQuoteRequest {
  legs: LegRequest[];
  passengers: number;
  bags: number;
  rideType: RideType;
  plan: Plan;
  vehicleClass: VehicleClass;
  extras: { childSeats: number; extraStops: number };
  promoCode?: string;
  airlineCode?: string;
}

export interface StoredBreakdown extends QuoteResult {
  pickupTimes: string[];
  rulesUsed: { id: string; type: string; key: string; version: number }[];
  collectedBy: CollectedBy;
  revenueShareBps: number;
}

const RULE_CACHE_MS = 30_000;

/** Quote engine wrapper (PRD 12): loads rules in force, prices, and stores an immutable snapshot. */
@Injectable()
export class PricingService {
  private cache: { at: number; rows: PricingRule[] } | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigStore,
    private readonly pickupTimes: PickupTimesService,
    @Inject(FLIGHT_STATUS) private readonly flights: FlightStatusAdapter,
  ) {}

  private async allRules(): Promise<PricingRule[]> {
    if (this.cache && Date.now() - this.cache.at < RULE_CACHE_MS) return this.cache.rows;
    const rows = await this.prisma.pricingRule.findMany();
    this.cache = { at: Date.now(), rows };
    return rows;
  }

  /** Called after an admin edit, so the next quote uses the new version at once. */
  invalidate() {
    this.cache = null;
  }

  async rulesAt(at = new Date()) {
    const rows = rulesInForce(await this.allRules(), at);
    const shared = await this.config.get<{ maxPassengers: number; bagsPerPassenger: { large: number; small: number }; vehicleClass: string }>('shared.limits');
    try {
      return { rows, rules: buildPricingRules(rows, shared) };
    } catch (e) {
      if (e instanceof MissingRuleError) throw new BadRequestException({ code: 'PRICING_NOT_CONFIGURED', message: e.message });
      throw e;
    }
  }

  async airport() {
    const ap = await this.prisma.airport.findFirst({ where: { active: true }, orderBy: { createdAt: 'asc' } });
    if (!ap) throw new BadRequestException({ code: 'NO_AIRPORT', message: 'No active airport is configured.' });
    return ap;
  }

  /** Nearest zone centre to a point. Ops-drawn polygons replace this in M6. */
  async zoneFor(point: { lat: number; lng: number }) {
    const zones = await this.prisma.zone.findMany({ include: { corridorAreas: { include: { corridor: true } } } });
    let best: { code: string; km: number; corridor: string | null } | null = null;
    for (const z of zones) {
      const km = haversineKm(point, { lat: z.centerLat, lng: z.centerLng });
      if (!best || km < best.km) {
        const c = z.corridorAreas.map((a) => a.corridor).find((x) => x.sharedOn);
        best = { code: z.code, km, corridor: c?.name ?? null };
      }
    }
    if (!best || best.km > 8) {
      throw new BadRequestException({ code: 'OUTSIDE_SERVICE_AREA', message: 'This address is outside the areas we serve.' });
    }
    return best;
  }

  async suggestVehicleClass(passengers: number, bags: number): Promise<VehicleClass> {
    const { rules } = await this.rulesAt();
    return suggestVehicleClass(passengers, bags, rules.vehicleClasses);
  }

  private async revenueShareBps(airline: Airline | null, channel: BookingChannel): Promise<number> {
    if (!airline) return 0;
    if (channel === 'LINK' && (airline.settlementTerms as { shareOnLinkBookings?: boolean } | null)?.shareOnLinkBookings !== true) return 0;
    if (channel === 'OWN_PAGE' || channel === 'OPS') return 0;
    const { rows } = await this.rulesAt();
    const rule = rows.find((r) => r.type === 'REVENUE_SHARE' && r.key === airline.code);
    return (rule?.values as { bps?: number } | undefined)?.bps ?? airline.revenueShareBps;
  }

  /** Price a trip and store the quote. The quote row never changes after this (DB trigger). */
  async price(args: {
    request: StoredQuoteRequest;
    airline: Airline | null;
    channel: BookingChannel;
    collectedBy: CollectedBy;
    corporateCode?: string;
  }): Promise<{ quote: Quote; response: QuoteResponse }> {
    const { request, airline, channel, collectedBy } = args;
    const { rows, rules } = await this.rulesAt();
    const roadFactorBps = (rules as { roadFactorBps?: number }).roadFactorBps ?? 13_000;
    const airport = await this.airport();
    const pickupTimes = await Promise.all(request.legs.map((l) => this.pickupTimes.forLeg(l)));
    const legs = await Promise.all(
      request.legs.map(async (l, i) => {
        // The non-airport end decides the zone.
        const point = l.type === 'DEPARTURE' ? l.pickup.location : l.dropoff.location;
        const zone = await this.zoneFor(point);
        const km = (haversineKm(point, { lat: airport.lat, lng: airport.lng }) * roadFactorBps) / 10_000;
        const local = lagosParts(pickupTimes[i]!);
        return { type: l.type, zoneCode: zone.code, corridor: zone.corridor, distanceKm: Math.round(km * 10) / 10, localDate: local.date, localHour: local.hour };
      }),
    );
    const revenueShareBps = await this.revenueShareBps(airline, channel);

    let result: QuoteResult;
    try {
      result = computeQuote(
        {
          legs,
          passengers: request.passengers,
          bags: request.bags,
          vehicleClass: request.vehicleClass,
          plan: request.plan,
          rideType: request.rideType,
          extras: request.extras,
          promoCode: request.promoCode,
          corporateCode: args.corporateCode,
          revenueShareBps,
          collectedBy,
          today: lagosParts(new Date()).date,
        },
        rules,
      );
    } catch (e) {
      if (e instanceof QuoteError) throw new BadRequestException({ code: e.code, message: e.message });
      throw e;
    }

    const expiryMinutes = airline && channel !== 'LINK' ? airline.quoteExpiryMinutes : await this.config.get<number>(CONFIG.ownChannelQuoteExpiryMinutes);
    const expiresAt = new Date(Date.now() + expiryMinutes * 60_000);
    const breakdown: StoredBreakdown = {
      ...result,
      pickupTimes: pickupTimes.map((d) => d.toISOString()),
      rulesUsed: rows.map((r) => ({ id: r.id, type: r.type, key: r.key, version: r.version })),
      collectedBy,
      revenueShareBps,
    };
    const quote = await this.prisma.quote.create({
      data: {
        airlineId: airline?.id,
        channel,
        request: { ...request, vehicleClass: result.vehicleClass } as object,
        breakdown: breakdown as object,
        totalKobo: result.totalKobo,
        marginKobo: result.marginKobo,
        flagged: result.flagged,
        pricingRuleVersion: Math.max(0, ...rows.map((r) => r.version)),
        expiresAt,
      },
    });
    return { quote, response: toResponse(quote, request, breakdown) };
  }

  /** Airline widget and booking engine (CHN-02). */
  async quotePartner(req: PartnerQuoteRequest, airline: Airline | null) {
    const vehicleClass = req.vehicleClass ?? (await this.suggestVehicleClass(req.passengers, req.bags));
    const { response } = await this.price({
      request: { legs: req.legs, passengers: req.passengers, bags: req.bags, rideType: req.rideType, plan: req.plan, vehicleClass, extras: { childSeats: 0, extraStops: 0 } },
      airline,
      channel: airline ? 'WIDGET' : 'OWN_PAGE',
      collectedBy: airline ? 'AIRLINE' : 'AIRWHEELS',
    });
    return response;
  }

  /** Turns our page's legs (flight number + one address) into full legs, validating each flight (6.2). */
  async buildOwnRequest(req: OwnQuoteRequest): Promise<{ request: StoredQuoteRequest; airline: Airline | null }> {
    const airline = req.airlineCode ? await this.prisma.airline.findUnique({ where: { code: req.airlineCode.toUpperCase() } }) : null;
    if (req.airlineCode && (!airline || airline.status !== 'ACTIVE')) throw new NotFoundException({ code: 'AIRLINE_UNKNOWN', message: 'We do not know that airline.' });
    const ap = await this.airport();
    const airportAddress = { text: `${ap.name}, ${ap.terminal} terminal`, location: { lat: ap.lat, lng: ap.lng } };
    const today = lagosParts(new Date()).date;
    const legs: LegRequest[] = [];
    for (const l of req.legs) {
      if (l.date < today) throw new BadRequestException({ code: 'FLIGHT_IN_PAST', message: `${l.flightNumber} on ${l.date} has already gone. Check the date.` });
      const f = await this.flights.lookup(l.flightNumber, l.date, { leg: l.type, airport: ap.iata });
      if (!f?.scheduledDeparture || !f.scheduledArrival) {
        throw new BadRequestException({ code: 'FLIGHT_NOT_FOUND', message: `We could not find flight ${l.flightNumber} on ${l.date}. Check the number and date.` });
      }
      const touchesUs = l.type === 'DEPARTURE' ? f.origin === ap.iata : f.destination === ap.iata;
      if (f.origin && f.destination && !touchesUs) {
        throw new BadRequestException({ code: 'FLIGHT_WRONG_AIRPORT', message: `${l.flightNumber} does not ${l.type === 'DEPARTURE' ? 'leave from' : 'land at'} ${ap.iata}.` });
      }
      legs.push({
        type: l.type,
        pickup: l.type === 'DEPARTURE' ? l.address : airportAddress,
        dropoff: l.type === 'DEPARTURE' ? airportAddress : l.address,
        flight: {
          flightNumber: l.flightNumber,
          date: l.date,
          origin: f.origin ?? (l.type === 'DEPARTURE' ? ap.iata : 'XXX'),
          destination: f.destination ?? (l.type === 'ARRIVAL' ? ap.iata : 'XXX'),
          scheduledDeparture: f.scheduledDeparture.toISOString(),
          scheduledArrival: f.scheduledArrival.toISOString(),
          terminal: ap.terminal,
        },
      });
    }
    legs.sort((a, b) => (a.type === b.type ? 0 : a.type === 'DEPARTURE' ? -1 : 1));
    const vehicleClass = req.rideType === 'SHARED' ? 'SUV' : (req.vehicleClass ?? (await this.suggestVehicleClass(req.passengers, req.bags)));
    return {
      airline,
      request: { legs, passengers: req.passengers, bags: req.bags, rideType: req.rideType, plan: req.plan, vehicleClass, extras: req.extras, promoCode: req.promoCode, airlineCode: airline?.code },
    };
  }

  /** Our booking page and the post-booking link (CHN-04, CHN-05). We collect by Paystack. */
  async quoteOwn(req: OwnQuoteRequest, channel: BookingChannel = 'OWN_PAGE') {
    const { request, airline } = await this.buildOwnRequest(req);
    return this.price({ request, airline, channel: airline && channel === 'OWN_PAGE' ? 'LINK' : channel, collectedBy: 'AIRWHEELS' });
  }
}

export function toResponse(quote: Quote, request: StoredQuoteRequest, b: StoredBreakdown): QuoteResponse {
  return {
    quoteId: quote.id,
    currency: 'NGN',
    totalKobo: quote.totalKobo,
    expiresAt: quote.expiresAt.toISOString(),
    vehicleClass: b.vehicleClass,
    rideType: request.rideType,
    plan: request.plan,
    legs: b.legs.map((l, i) => ({
      type: l.type,
      amountKobo: l.amountKobo,
      pickupAt: b.pickupTimes[i]!,
      lines: l.lines,
      flight: {
        number: request.legs[i]!.flight.flightNumber,
        date: request.legs[i]!.flight.date,
        departure: request.legs[i]!.flight.scheduledDeparture,
        arrival: request.legs[i]!.flight.scheduledArrival,
      },
    })),
  };
}
