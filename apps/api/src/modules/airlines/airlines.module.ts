import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Injectable,
  Module,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Req,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { resolveTheme } from '@airwheels/ui';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { encrypt } from '../../common/crypto';
import { PrismaService } from '../../common/prisma.service';
import {
  AdminRead,
  type AuthedRequest,
  Public,
  SuperAdminOnly,
  requireAdmin,
} from '../../common/auth/roles';
import { ApiZodBody, ZodPipe } from '../../common/zod';
import { AuditService } from '../audit/audit.service';
import { validIpEntry } from '../auth/principal.resolver';
import { ConfigStore } from '../config/config.service';
import { CONFIG } from '../config/keys';

/** Partner config, credentials and branding (PRD 4.3). */
@ApiTags('widget')
@Controller({ path: 'widget', version: '1' })
export class WidgetConfigController {
  constructor(private readonly prisma: PrismaService) {}

  /** GET /v1/widget/config/:airline — public theme and wording for the widget (CHN-01, CHN-12). */
  @Get('config/:airline')
  @Public()
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

const IpList = z.array(z.string().max(60)).max(50);
const CreateCredential = z.object({ allowedIps: IpList.default([]) });
const UpdateIps = z.object({ allowedIps: IpList });

const credentialView = (c: {
  id: string;
  keyId: string;
  status: string;
  allowedIps: string[];
  createdAt: Date;
  rotatedAt: Date | null;
  expiresAt: Date | null;
  revokedAt: Date | null;
}) => ({
  id: c.id,
  keyId: c.keyId,
  status: c.status,
  allowedIps: c.allowedIps,
  createdAt: c.createdAt,
  rotatedAt: c.rotatedAt,
  expiresAt: c.expiresAt,
  revokedAt: c.revokedAt,
});

/** Airline API key pairs (ACC-08, PRD 5.5). The secret is shown once and stored encrypted. */
@Injectable()
export class AirlineCredentialsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly config: ConfigStore,
  ) {}

  list() {
    return this.prisma.airline.findMany({
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        code: true,
        serviceBrandName: true,
        status: true,
        _count: { select: { credentials: { where: { status: 'ACTIVE' } } } },
      },
    });
  }

  async detail(airlineId: string) {
    const a = await this.prisma.airline.findUnique({
      where: { id: airlineId },
      include: { credentials: { orderBy: { createdAt: 'desc' } } },
    });
    if (!a) throw new NotFoundException({ code: 'AIRLINE_NOT_FOUND', message: 'No such airline.' });
    return {
      id: a.id,
      name: a.name,
      code: a.code,
      serviceBrandName: a.serviceBrandName,
      status: a.status,
      webhookUrl: a.webhookUrl,
      credentials: a.credentials.map(credentialView),
    };
  }

  private checkIps(ips: string[]) {
    const bad = ips.filter((ip) => !validIpEntry(ip));
    if (bad.length)
      throw new BadRequestException({
        code: 'IP_INVALID',
        message: `Not an IP address or CIDR range: ${bad.join(', ')}`,
      });
  }

  private async issue(airlineId: string, allowedIps: string[], createdById: string) {
    const keyId = `ak_${randomBytes(9).toString('base64url')}`;
    const secret = randomBytes(32).toString('hex');
    const c = await this.prisma.airlineCredential.create({
      data: { airlineId, keyId, secretEncrypted: encrypt(secret), allowedIps, createdById },
    });
    return { credential: c, secret };
  }

  async create(airlineId: string, allowedIps: string[], createdById: string) {
    await this.detail(airlineId);
    this.checkIps(allowedIps);
    const { credential, secret } = await this.issue(airlineId, allowedIps, createdById);
    await this.audit.record({
      action: 'airline.credential_create',
      entity: 'AirlineCredential',
      entityId: credential.id,
      after: credentialView(credential),
    });
    return {
      ...credentialView(credential),
      secret,
      note: 'Copy the secret now. It is not shown again.',
    };
  }

  /** New key pair; the old one keeps working for the configured grace period so the airline can switch. */
  async rotate(credentialId: string, createdById: string) {
    const old = await this.prisma.airlineCredential.findUnique({ where: { id: credentialId } });
    if (!old || old.status !== 'ACTIVE')
      throw new NotFoundException({ code: 'CREDENTIAL_NOT_FOUND', message: 'No such active key.' });
    const graceHours = await this.config.get<number>(CONFIG.credentialRotationGraceHours);
    const { credential, secret } = await this.issue(old.airlineId, old.allowedIps, createdById);
    const oldExpiresAt = new Date(Date.now() + graceHours * 3_600_000);
    const oldAfter = await this.prisma.airlineCredential.update({
      where: { id: old.id },
      data: {
        rotatedAt: new Date(),
        expiresAt: old.expiresAt && old.expiresAt < oldExpiresAt ? old.expiresAt : oldExpiresAt,
      },
    });
    await this.audit.record({
      action: 'airline.credential_rotate',
      entity: 'AirlineCredential',
      entityId: old.id,
      before: credentialView(old),
      after: { old: credentialView(oldAfter), new: credentialView(credential) },
    });
    return {
      ...credentialView(credential),
      secret,
      oldKeyExpiresAt: oldAfter.expiresAt,
      note: 'Copy the secret now. It is not shown again.',
    };
  }

  async revoke(credentialId: string) {
    const before = await this.prisma.airlineCredential.findUnique({ where: { id: credentialId } });
    if (!before)
      throw new NotFoundException({ code: 'CREDENTIAL_NOT_FOUND', message: 'No such key.' });
    const after = await this.prisma.airlineCredential.update({
      where: { id: credentialId },
      data: { status: 'REVOKED', revokedAt: new Date() },
    });
    await this.audit.record({
      action: 'airline.credential_revoke',
      entity: 'AirlineCredential',
      entityId: credentialId,
      before: credentialView(before),
      after: credentialView(after),
    });
    return credentialView(after);
  }

  async setIps(credentialId: string, allowedIps: string[]) {
    this.checkIps(allowedIps);
    const before = await this.prisma.airlineCredential.findUnique({ where: { id: credentialId } });
    if (!before)
      throw new NotFoundException({ code: 'CREDENTIAL_NOT_FOUND', message: 'No such key.' });
    const after = await this.prisma.airlineCredential.update({
      where: { id: credentialId },
      data: { allowedIps },
    });
    await this.audit.record({
      action: 'airline.credential_ips',
      entity: 'AirlineCredential',
      entityId: credentialId,
      before: { allowedIps: before.allowedIps },
      after: { allowedIps },
    });
    return credentialView(after);
  }
}

/** Airline settings in the admin (ADM-09). Reading is open to staff; keys are super admin only. */
@ApiTags('admin')
@Controller({ path: 'admin/airlines', version: '1' })
export class AdminAirlinesController {
  constructor(private readonly creds: AirlineCredentialsService) {}

  @Get()
  @AdminRead()
  list() {
    return this.creds.list();
  }

  @Get(':id')
  @AdminRead()
  detail(@Param('id', ParseUUIDPipe) id: string) {
    return this.creds.detail(id);
  }

  @Post(':id/credentials')
  @SuperAdminOnly()
  @ApiZodBody(CreateCredential)
  create(
    @Req() req: AuthedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(CreateCredential)) body: z.infer<typeof CreateCredential>,
  ) {
    return this.creds.create(id, body.allowedIps, requireAdmin(req).userId);
  }

  @Post('credentials/:credId/rotate')
  @HttpCode(200)
  @SuperAdminOnly()
  rotate(@Req() req: AuthedRequest, @Param('credId', ParseUUIDPipe) credId: string) {
    return this.creds.rotate(credId, requireAdmin(req).userId);
  }

  @Post('credentials/:credId/revoke')
  @HttpCode(200)
  @SuperAdminOnly()
  revoke(@Param('credId', ParseUUIDPipe) credId: string) {
    return this.creds.revoke(credId);
  }

  @Put('credentials/:credId/ips')
  @SuperAdminOnly()
  @ApiZodBody(UpdateIps)
  ips(
    @Param('credId', ParseUUIDPipe) credId: string,
    @Body(new ZodPipe(UpdateIps)) body: z.infer<typeof UpdateIps>,
  ) {
    return this.creds.setIps(credId, body.allowedIps);
  }
}

@Module({
  controllers: [WidgetConfigController, AdminAirlinesController],
  providers: [AirlineCredentialsService],
})
export class AirlinesModule {}
