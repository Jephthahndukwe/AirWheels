import { Global, Injectable, Module } from '@nestjs/common';
import type { ActorRole } from '@prisma/client';
import { PrismaService } from '../../common/prisma.service';

/** Append-only audit trail for every admin write (PRD 2.2, ADM-14). */
@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  record(input: {
    actorId?: string;
    actorRole: ActorRole;
    action: string;
    entity: string;
    entityId?: string;
    before?: unknown;
    after?: unknown;
    ip?: string;
  }) {
    return this.prisma.auditLog.create({
      data: {
        ...input,
        before: input.before as object | undefined,
        after: input.after as object | undefined,
      },
    });
  }
}

@Global()
@Module({ providers: [AuditService], exports: [AuditService] })
export class AuditModule {}
