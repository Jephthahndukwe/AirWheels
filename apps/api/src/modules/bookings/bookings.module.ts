import { Controller, Get, Module, Query, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { DevOnlyGuard } from '../admin/dev-only.guard';
import { FlightsModule } from '../flights/flights.module';
import { MessagingModule } from '../messaging/messaging.module';
import { PricingModule } from '../pricing/pricing.module';
import { TravellerAccessModule } from '../traveller-access/traveller-access.module';
import { BookingsService } from './bookings.service';

@ApiTags('admin')
@UseGuards(DevOnlyGuard)
@Controller({ path: 'admin/bookings', version: '1' })
export class AdminBookingsController {
  constructor(private readonly bookings: BookingsService) {}

  @Get()
  list(@Query('limit') limit?: string) {
    return this.bookings.list(Math.min(Number(limit) || 50, 200));
  }
}

@Module({
  imports: [FlightsModule, MessagingModule, PricingModule, TravellerAccessModule],
  controllers: [AdminBookingsController],
  providers: [BookingsService],
  exports: [BookingsService],
})
export class BookingsModule {}
