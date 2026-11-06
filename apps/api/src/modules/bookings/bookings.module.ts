import { Controller, Get, Module, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AdminRead } from '../../common/auth/roles';
import { FlightsModule } from '../flights/flights.module';
import { MessagingModule } from '../messaging/messaging.module';
import { PricingModule } from '../pricing/pricing.module';
import { TravellerAccessModule } from '../traveller-access/traveller-access.module';
import { BookingsService } from './bookings.service';

@ApiTags('admin')
@AdminRead()
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
