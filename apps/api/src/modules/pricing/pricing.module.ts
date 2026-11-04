import { Body, Controller, Module, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PartnerQuoteRequest } from '@airwheels/types';
import { ApiZodBody, ZodPipe } from '../../common/zod';
import { PricingService } from './pricing.service';

/** Our own booking page asks for quotes here. Airlines use POST /v1/partner/quotes. */
@ApiTags('quotes')
@Controller({ path: 'quotes', version: '1' })
export class QuotesController {
  constructor(private readonly pricing: PricingService) {}

  @Post()
  @ApiZodBody(PartnerQuoteRequest)
  create(@Body(new ZodPipe(PartnerQuoteRequest)) body: PartnerQuoteRequest) {
    return this.pricing.quote(body, null);
  }
}

@Module({ controllers: [QuotesController], providers: [PricingService], exports: [PricingService] })
export class PricingModule {}
