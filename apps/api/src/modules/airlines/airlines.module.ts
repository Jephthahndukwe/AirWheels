import { Controller, Get, Module, NotFoundException, Param } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { resolveTheme } from '@airwheels/ui';
import { PrismaService } from '../../common/prisma.service';
import { PartnerGuard } from './partner.guard';

/** Partner config, credentials and branding (PRD 4.3). */
@ApiTags('widget')
@Controller({ path: 'widget', version: '1' })
export class WidgetConfigController {
  constructor(private readonly prisma: PrismaService) {}

  /** GET /v1/widget/config/:airline — public theme and wording for the widget (CHN-01, CHN-12). */
  @Get('config/:airline')
  async config(@Param('airline') code: string) {
    const airline = await this.prisma.airline.findUnique({
      where: { code: code.toUpperCase() },
      include: { themes: { where: { active: true }, take: 1 } },
    });
    if (!airline || airline.status !== 'ACTIVE') throw new NotFoundException();
    const theme = airline.themes[0];
    const colours = (theme?.colours ?? {}) as Record<string, string>;
    return {
      airline: airline.code,
      serviceName: airline.serviceBrandName,
      theme: resolveTheme({
        ...colours,
        serviceName: airline.serviceBrandName,
        logoUrl: theme?.logoUrl ?? undefined,
        fontFamily: theme?.font ?? undefined,
      }),
      wording: theme?.wording ?? {},
      poweredBy: true,
    };
  }
}

@Module({
  controllers: [WidgetConfigController],
  providers: [PartnerGuard],
  exports: [PartnerGuard],
})
export class AirlinesModule {}
