import {
  type CallHandler,
  Controller,
  Get,
  Query,
  type ExecutionContext,
  Global,
  Injectable,
  Module,
  type NestInterceptor,
} from '@nestjs/common';
import type { ActorRole, Prisma } from '@prisma/client';
import { AsyncLocalStorage } from 'node:async_hooks';
import { Observable, concatMap } from 'rxjs';
import { PrismaService } from '../../common/prisma.service';
import { AdminRead, type AuthedRequest, type Principal, clientIp } from '../../common/auth/roles';
import { ApiTags } from '@nestjs/swagger';

interface AuditContext {
  principal?: Principal;
  ip?: string;
  recorded: boolean;
}

const als = new AsyncLocalStorage<AuditContext>();

const actorOf = (p?: Principal): { actorId?: string; actorRole: ActorRole; actorLabel?: string } => {
  switch (p?.kind) {
    case 'admin':
      return { actorId: p.userId, actorRole: 'OPS', actorLabel: `${p.email} (${p.role})` };
    case 'driver':
      return { actorId: p.userId, actorRole: 'DRIVER', actorLabel: p.phone };
    case 'partner':
      return { actorId: p.airline.id, actorRole: 'SYSTEM', actorLabel: `airline ${p.airline.code}` };
    default:
      return { actorRole: 'SYSTEM', actorLabel: 'system' };
  }
};

const SECRET_FIELDS = /pass|pin|secret|totp|token|code|otp/i;

/** Removes secrets from anything written to the audit log. */
export function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, SECRET_FIELDS.test(k) ? '[redacted]' : redact(v)]),
    );
  }
  return value;
}

/** Append-only audit trail for every admin write (PRD 2.2, ADM-14): who, what, before, after, when. */
@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  /** Actor and IP default to the current request, so callers only describe the change. */
  record(input: {
    action: string;
    entity: string;
    entityId?: string;
    before?: unknown;
    after?: unknown;
    actorId?: string;
    actorRole?: ActorRole;
    actorLabel?: string;
    ip?: string;
  }) {
    const ctx = als.getStore();
    if (ctx) ctx.recorded = true;
    const actor = actorOf(ctx?.principal);
    return this.prisma.auditLog.create({
      data: {
        action: input.action,
        entity: input.entity,
        entityId: input.entityId,
        actorId: input.actorId ?? actor.actorId,
        actorRole: input.actorRole ?? actor.actorRole,
        actorLabel: input.actorLabel ?? actor.actorLabel,
        ip: input.ip ?? ctx?.ip,
        before: input.before === undefined ? undefined : (redact(input.before) as Prisma.InputJsonValue),
        after: input.after === undefined ? undefined : (redact(input.after) as Prisma.InputJsonValue),
      },
    });
  }

  async search(q: {
    entity?: string;
    entityId?: string;
    action?: string;
    actor?: string;
    from?: Date;
    to?: Date;
    cursor?: string;
    limit: number;
  }) {
    const where: Prisma.AuditLogWhereInput = {
      ...(q.entity ? { entity: q.entity } : {}),
      ...(q.entityId ? { entityId: q.entityId } : {}),
      ...(q.action ? { action: { contains: q.action, mode: 'insensitive' } } : {}),
      ...(q.actor ? { actorLabel: { contains: q.actor, mode: 'insensitive' } } : {}),
      ...(q.from || q.to ? { time: { ...(q.from ? { gte: q.from } : {}), ...(q.to ? { lte: q.to } : {}) } } : {}),
    };
    const rows = await this.prisma.auditLog.findMany({
      where,
      orderBy: [{ time: 'desc' }, { id: 'desc' }],
      take: q.limit + 1,
      ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
    });
    const more = rows.length > q.limit;
    const items = more ? rows.slice(0, q.limit) : rows;
    const entities = await this.prisma.auditLog.findMany({ distinct: ['entity'], select: { entity: true } });
    return { items, nextCursor: more ? items[items.length - 1]!.id : null, entities: entities.map((e) => e.entity).sort() };
  }
}

/**
 * Runs each request inside an audit context. If an admin write finishes without its service
 * recording an audit entry, this records a generic one, so no admin write goes unlogged.
 */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(private readonly audit: AuditService) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (ctx.getType() !== 'http') return next.handle();
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    const store: AuditContext = { principal: req.principal, ip: clientIp(req), recorded: false };
    const isAdminWrite = req.principal?.kind === 'admin' && !['GET', 'HEAD', 'OPTIONS'].includes(req.method);
    return new Observable((sub) =>
      als.run(store, () =>
        next
          .handle()
          .pipe(
            concatMap(async (value) => {
              if (isAdminWrite && !store.recorded) {
                await this.audit.record({
                  action: `${req.method} ${(req.route as { path?: string } | undefined)?.path ?? req.path}`,
                  entity: 'http',
                  entityId: typeof req.params?.id === 'string' ? req.params.id : undefined,
                  after: req.body,
                });
              }
              return value;
            }),
          )
          .subscribe(sub),
      ),
    );
  }
}

/** Searchable audit log viewer (ADM-14). */
@ApiTags('admin')
@Controller({ path: 'admin/audit', version: '1' })
export class AdminAuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  @AdminRead()
  search(@Query() q: Record<string, string | undefined>) {
    const date = (v?: string) => (v && !Number.isNaN(Date.parse(v)) ? new Date(v) : undefined);
    return this.audit.search({
      entity: q.entity || undefined,
      entityId: q.entityId || undefined,
      action: q.action || undefined,
      actor: q.actor || undefined,
      from: date(q.from),
      to: date(q.to),
      cursor: q.cursor && /^[0-9a-f-]{36}$/.test(q.cursor) ? q.cursor : undefined,
      limit: Math.min(Number(q.limit) || 50, 200),
    });
  }
}

@Global()
@Module({ controllers: [AdminAuditController], providers: [AuditService, AuditInterceptor], exports: [AuditService, AuditInterceptor] })
export class AuditModule {}
