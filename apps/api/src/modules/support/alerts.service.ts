import { Injectable, NotFoundException } from '@nestjs/common';
import type { AlertStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma.service';
import { RealtimeGateway } from '../../realtime/realtime.gateway';
import { AuditService } from '../audit/audit.service';

/** Ops alerts (NTF-04): stored for the dashboard and pushed live to the `ops` room. */
@Injectable()
export class AlertsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeGateway,
    private readonly audit: AuditService,
  ) {}

  async raise(input: {
    type: string;
    message: string;
    bookingId?: string;
    legId?: string;
    driverId?: string;
    data?: object;
  }) {
    const alert = await this.prisma.opsAlert.create({
      data: { ...input, data: input.data as Prisma.InputJsonValue | undefined },
    });
    this.realtime.emit('ops', 'alert.created', alert);
    return alert;
  }

  list(status: AlertStatus | undefined, limit: number) {
    return this.prisma.opsAlert.findMany({
      where: status ? { status } : {},
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }

  /** Resolves open alerts of one type for a leg (e.g. when ops reissues a locked pickup code). */
  async resolveFor(legId: string, type: string, resolvedById?: string) {
    await this.prisma.opsAlert.updateMany({
      where: { legId, type, status: 'OPEN' },
      data: { status: 'RESOLVED', resolvedAt: new Date(), resolvedById },
    });
  }

  async resolve(id: string, resolvedById: string) {
    const before = await this.prisma.opsAlert.findUnique({ where: { id } });
    if (!before)
      throw new NotFoundException({ code: 'ALERT_NOT_FOUND', message: 'No such alert.' });
    const after = await this.prisma.opsAlert.update({
      where: { id },
      data: { status: 'RESOLVED', resolvedAt: new Date(), resolvedById },
    });
    await this.audit.record({
      action: 'alert.resolve',
      entity: 'OpsAlert',
      entityId: id,
      before: { status: before.status },
      after: { status: after.status },
    });
    return after;
  }
}
