import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Module,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { OwnQuoteRequest } from '@airwheels/types';
import type { PricingRuleType } from '@prisma/client';
import { z } from 'zod';
import { MAPS, type MapsAdapter } from '../../adapters/interfaces';
import { PrismaService } from '../../common/prisma.service';
import { AdminRead, AdminWrite, Public, RateLimit, SuperAdminOnly } from '../../common/auth/roles';
import { ApiZodBody, ZodPipe } from '../../common/zod';
import { AuditService } from '../audit/audit.service';
import { DispatchModule } from '../dispatch/dispatch.module';
import { PricingService } from './pricing.service';
import { RULE_SCHEMAS, ruleProblem } from './rules';

/** Our own booking page asks for quotes here. Airlines use POST /v1/partner/quotes. */
@ApiTags('quotes')
@Controller({ path: 'quotes', version: '1' })
export class QuotesController {
  constructor(private readonly pricing: PricingService) {}

  @Post()
  @Public()
  @RateLimit('publicQuotes')
  @ApiZodBody(OwnQuoteRequest)
  async create(@Body(new ZodPipe(OwnQuoteRequest)) body: OwnQuoteRequest) {
    return (await this.pricing.quoteOwn(body)).response;
  }
}

/** Address search and pin drop for the booking page (CHN-07). Google Places behind the adapter. */
@ApiTags('quotes')
@Controller({ path: 'places', version: '1' })
export class PlacesController {
  constructor(@Inject(MAPS) private readonly maps: MapsAdapter) {}

  @Get('search')
  @Public()
  @RateLimit('places')
  search(@Query('q') q?: string) {
    return this.maps.searchPlaces((q ?? '').slice(0, 80));
  }

  @Get('reverse')
  @Public()
  @RateLimit('places')
  async reverse(@Query('lat') lat?: string, @Query('lng') lng?: string) {
    const point = { lat: Number(lat), lng: Number(lng) };
    if (!Number.isFinite(point.lat) || !Number.isFinite(point.lng) || Math.abs(point.lat) > 90 || Math.abs(point.lng) > 180) {
      throw new BadRequestException({ code: 'POINT_INVALID', message: 'Drop the pin on the map.' });
    }
    return (await this.maps.reverseGeocode(point)) ?? { placeId: 'pin', name: 'Dropped pin', description: 'Dropped pin', location: point };
  }
}

const RULE_TYPES = Object.keys(RULE_SCHEMAS) as [PricingRuleType, ...PricingRuleType[]];
const NewRule = z.object({
  type: z.enum(RULE_TYPES),
  key: z.string().min(1).max(60),
  values: z.unknown(),
  effectiveFrom: z.coerce.date().optional(),
  effectiveTo: z.coerce.date().optional(),
});
const EndRule = z.object({ effectiveTo: z.coerce.date().optional() });
const Simulate = OwnQuoteRequest;

/**
 * Pricing rules in the admin (PRC-06, ADM-11). Every change is a new version with its own
 * effective dates; nothing is edited in place, so every quote can be traced to the rules it used.
 * Staff can read; only super admins change pricing (PRD 2.2).
 */
@ApiTags('admin')
@Controller({ path: 'admin/pricing', version: '1' })
export class AdminPricingController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pricing: PricingService,
    private readonly audit: AuditService,
  ) {}

  @Get('rules')
  @AdminRead()
  async rules(@Query('type') type?: string) {
    const rows = await this.prisma.pricingRule.findMany({
      where: RULE_TYPES.includes(type as PricingRuleType) ? { type: type as PricingRuleType } : {},
      orderBy: [{ type: 'asc' }, { key: 'asc' }, { version: 'desc' }],
    });
    const now = new Date();
    const inForce = new Set((await this.pricing.rulesAt(now).catch(() => ({ rows: [] }))).rows.map((r) => r.id));
    return {
      rules: rows.map((r) => ({ ...r, inForce: inForce.has(r.id), scheduled: r.effectiveFrom > now })),
      types: RULE_TYPES.map((t) => ({ type: t, help: RULE_SCHEMAS[t].help })),
    };
  }

  /** New version of a (type, key). Effective now unless a later start is given. */
  @Post('rules')
  @SuperAdminOnly()
  @ApiZodBody(NewRule)
  async create(@Body(new ZodPipe(NewRule)) body: z.infer<typeof NewRule>) {
    const problem = ruleProblem(body.type, body.key, body.values);
    if (problem) throw new BadRequestException({ code: 'RULE_INVALID', message: problem });
    const effectiveFrom = body.effectiveFrom ?? new Date();
    if (effectiveFrom.getTime() < Date.now() - 60_000) {
      throw new BadRequestException({ code: 'RULE_BACKDATED', message: 'A new version cannot start in the past: quotes already given must keep their rules.' });
    }
    if (body.effectiveTo && body.effectiveTo <= effectiveFrom) throw new BadRequestException({ code: 'RULE_DATES', message: 'The end must be after the start.' });
    const previous = await this.prisma.pricingRule.findFirst({ where: { type: body.type, key: body.key }, orderBy: { version: 'desc' } });
    const rule = await this.prisma.pricingRule.create({
      data: {
        type: body.type,
        key: body.key,
        values: body.values as object,
        version: (previous?.version ?? 0) + 1,
        effectiveFrom,
        effectiveTo: body.effectiveTo,
      },
    });
    this.pricing.invalidate();
    await this.audit.record({
      action: 'pricing.rule_version',
      entity: 'PricingRule',
      entityId: rule.id,
      before: previous ? { version: previous.version, values: previous.values, effectiveFrom: previous.effectiveFrom, effectiveTo: previous.effectiveTo } : undefined,
      after: { type: rule.type, key: rule.key, version: rule.version, values: rule.values, effectiveFrom: rule.effectiveFrom, effectiveTo: rule.effectiveTo },
    });
    return rule;
  }

  /** Ends a version (from now, or a later time). The row itself is never edited otherwise. */
  @Post('rules/:id/end')
  @HttpCode(200)
  @SuperAdminOnly()
  @ApiZodBody(EndRule)
  async end(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(EndRule)) body: z.infer<typeof EndRule>) {
    const before = await this.prisma.pricingRule.findUnique({ where: { id } });
    if (!before) throw new NotFoundException({ code: 'RULE_NOT_FOUND', message: 'No such rule.' });
    const effectiveTo = body.effectiveTo ?? new Date();
    if (effectiveTo.getTime() < Date.now() - 60_000) throw new BadRequestException({ code: 'RULE_BACKDATED', message: 'A rule cannot be ended in the past.' });
    const rule = await this.prisma.pricingRule.update({ where: { id }, data: { effectiveTo } });
    this.pricing.invalidate();
    await this.audit.record({ action: 'pricing.rule_end', entity: 'PricingRule', entityId: id, before: { effectiveTo: before.effectiveTo }, after: { effectiveTo } });
    return rule;
  }

  /** What would this trip cost now? Prices with the live rules and stores nothing a traveller can use. */
  @Post('simulate')
  @HttpCode(200)
  @AdminWrite()
  @ApiZodBody(Simulate)
  async simulate(@Body(new ZodPipe(Simulate)) body: z.infer<typeof Simulate>) {
    const { quote, response } = await this.pricing.quoteOwn(body, 'OPS');
    const b = quote.breakdown as { marginKobo: number; estimatedCostKobo: number; flagReasons: string[]; legs: { cost: unknown; marginKobo: number }[] };
    return { ...response, marginKobo: b.marginKobo, estimatedCostKobo: b.estimatedCostKobo, flagReasons: b.flagReasons, costs: b.legs.map((l) => l.cost) };
  }
}

@Module({
  imports: [DispatchModule],
  controllers: [QuotesController, PlacesController, AdminPricingController],
  providers: [PricingService],
  exports: [PricingService],
})
export class PricingModule {}
