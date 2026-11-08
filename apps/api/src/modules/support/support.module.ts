import {
  Controller,
  Get,
  Global,
  HttpCode,
  Module,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AdminRead, AdminWrite, type AuthedRequest, requireAdmin } from '../../common/auth/roles';
import { AlertsService } from './alerts.service';

/**
 * Support module: ops alerts now; support notes, traveller history by phone and emergencies in M3.
 */
@ApiTags('admin')
@Controller({ path: 'admin/alerts', version: '1' })
export class AdminAlertsController {
  constructor(private readonly alerts: AlertsService) {}

  @Get()
  @AdminRead()
  list(@Query('status') status?: string, @Query('limit') limit?: string) {
    const s = status === 'OPEN' || status === 'RESOLVED' ? status : undefined;
    return this.alerts.list(s, Math.min(Number(limit) || 50, 200));
  }

  @Post(':id/resolve')
  @HttpCode(200)
  @AdminWrite()
  resolve(@Req() req: AuthedRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.alerts.resolve(id, requireAdmin(req).userId);
  }
}

@Global()
@Module({
  controllers: [AdminAlertsController],
  providers: [AlertsService],
  exports: [AlertsService],
})
export class SupportModule {}
