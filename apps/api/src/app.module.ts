import { Controller, Get, Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { ApiTags } from '@nestjs/swagger';
import { LoggerModule } from 'nestjs-pino';
import { AdaptersModule } from './adapters/adapters.module';
import { loggerParams } from './common/logging';
import { Public } from './common/auth/roles';
import { PrismaModule } from './common/prisma.service';
import { AdminModule } from './modules/admin/admin.module';
import { AirlinesModule } from './modules/airlines/airlines.module';
import { AuditModule } from './modules/audit/audit.service';
import { AuthModule } from './modules/auth/auth.module';
import { BookingsModule } from './modules/bookings/bookings.module';
import { CallsModule } from './modules/calls/calls.module';
import { ConfigStoreModule } from './modules/config/config.module';
import { DispatchModule } from './modules/dispatch/dispatch.module';
import { DriversModule } from './modules/drivers/drivers.module';
import { FlightsModule } from './modules/flights/flights.module';
import { IntakeModule } from './modules/intake/intake.module';
import { MatchingModule } from './modules/matching/matching.module';
import { MediaModule } from './modules/media/media.module';
import { MessagingModule } from './modules/messaging/messaging.module';
import { LedgerModule, PaymentsModule } from './modules/payments/payments.module';
import { PolicyModule } from './modules/policy/policy.module';
import { PricingModule } from './modules/pricing/pricing.module';
import { SettlementModule } from './modules/settlement/settlement.module';
import { SupportModule } from './modules/support/support.module';
import { TravellerAccessModule } from './modules/traveller-access/traveller-access.module';
import { QueuesModule } from './queues/queues';
import { RealtimeModule } from './realtime/realtime.gateway';

@ApiTags('health')
@Controller({ path: 'health', version: '1' })
class HealthController {
  @Get()
  @Public()
  health() {
    return { ok: true, service: 'airwheels-api', time: new Date().toISOString() };
  }
}

@Module({
  imports: [
    LoggerModule.forRoot(loggerParams),
    ScheduleModule.forRoot(),
    // infrastructure
    PrismaModule,
    QueuesModule,
    RealtimeModule,
    AdaptersModule,
    ConfigStoreModule,
    AuditModule,
    LedgerModule,
    // domain modules (PRD 4.3)
    AuthModule,
    DriversModule,
    AdminModule,
    AirlinesModule,
    IntakeModule,
    BookingsModule,
    TravellerAccessModule,
    FlightsModule,
    DispatchModule,
    MatchingModule,
    PricingModule,
    PolicyModule,
    PaymentsModule,
    SettlementModule,
    MessagingModule,
    CallsModule,
    SupportModule,
    MediaModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
