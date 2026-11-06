import { BadRequestException, Body, Controller, Get, Global, Module, NotFoundException, Param, Put, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { PrismaService } from '../../common/prisma.service';
import { AdminRead, type AuthedRequest, SuperAdminOnly, requireAdmin } from '../../common/auth/roles';
import { ApiZodBody, ZodPipe } from '../../common/zod';
import { AuditService } from '../audit/audit.service';
import { ConfigStore } from './config.service';

const SetValue = z.object({ value: z.unknown() });

const shapeOf = (v: unknown) => (Array.isArray(v) ? 'array' : v === null ? 'null' : typeof v);

/** Same JSON shape as before: numbers stay numbers, objects keep their keys. Stops typos breaking the app. */
export function configValueProblem(current: unknown, next: unknown): string | null {
  if (shapeOf(current) !== shapeOf(next)) return `Expected a ${shapeOf(current)}, got a ${shapeOf(next)}.`;
  if (shapeOf(current) === 'object') {
    const c = current as Record<string, unknown>;
    const n = next as Record<string, unknown>;
    const missing = Object.keys(c).filter((k) => !(k in n));
    const extra = Object.keys(n).filter((k) => !(k in c));
    if (missing.length || extra.length) {
      return `Keep the same fields.${missing.length ? ` Missing: ${missing.join(', ')}.` : ''}${extra.length ? ` Unknown: ${extra.join(', ')}.` : ''}`;
    }
    for (const k of Object.keys(c)) {
      const p = configValueProblem(c[k], n[k]);
      if (p) return `${k}: ${p}`;
    }
  }
  if (typeof next === 'number' && (!Number.isFinite(next) || next < 0)) return 'Use a number of 0 or more.';
  return null;
}

/** Config store in the admin: everyone on staff reads it, only super admins change it. */
@ApiTags('admin')
@Controller({ path: 'admin/config', version: '1' })
export class AdminConfigController {
  constructor(
    private readonly config: ConfigStore,
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  @AdminRead()
  list() {
    return this.config.list();
  }

  @Get(':key/history')
  @AdminRead()
  history(@Param('key') key: string) {
    return this.prisma.configEntry.findMany({ where: { key }, orderBy: { version: 'desc' }, take: 50 });
  }

  @Put(':key')
  @SuperAdminOnly()
  @ApiZodBody(SetValue)
  async set(@Req() req: AuthedRequest, @Param('key') key: string, @Body(new ZodPipe(SetValue)) body: z.infer<typeof SetValue>) {
    const current = await this.prisma.configEntry.findFirst({ where: { key }, orderBy: { version: 'desc' } });
    if (!current) throw new NotFoundException({ code: 'CONFIG_KEY_UNKNOWN', message: 'No such config key.' });
    const problem = configValueProblem(current.value, body.value);
    if (problem) throw new BadRequestException({ code: 'CONFIG_VALUE_INVALID', message: problem });
    const entry = await this.config.set(key, body.value, requireAdmin(req).userId);
    await this.audit.record({
      action: 'config.update',
      entity: 'ConfigEntry',
      entityId: key,
      before: { version: current.version, value: current.value },
      after: { version: entry.version, value: entry.value },
    });
    return entry;
  }
}

@Global()
@Module({ controllers: [AdminConfigController], providers: [ConfigStore], exports: [ConfigStore] })
export class ConfigStoreModule {}
