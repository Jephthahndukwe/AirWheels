import { Injectable } from '@nestjs/common';
import type { SessionKind } from '@prisma/client';
import { PrismaService } from '../../common/prisma.service';
import type { Principal } from '../../common/auth/roles';
import { signToken, verifyToken } from '../../common/auth/tokens';
import { ConfigStore } from '../config/config.service';
import { CONFIG } from '../config/keys';
import { RealtimeGateway } from '../../realtime/realtime.gateway';

const TOUCH_EVERY_MS = 60_000;

/**
 * Server-side sessions for admins and drivers. The bearer token only names a session; the row
 * decides. Revoking a row signs the user out on their next request (and over the WebSocket).
 */
@Injectable()
export class SessionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigStore,
    private readonly realtime: RealtimeGateway,
  ) {}

  async create(input: {
    userId: string;
    kind: SessionKind;
    ip?: string;
    userAgent?: string;
    deviceId?: string;
  }): Promise<{ token: string; expiresAt: Date; sessionId: string }> {
    const ttlMs =
      input.kind === 'ADMIN'
        ? (await this.config.get<number>(CONFIG.adminSessionMaxHours)) * 3_600_000
        : (await this.config.get<number>(CONFIG.driverSessionDays)) * 86_400_000;
    const expiresAt = new Date(Date.now() + ttlMs);
    const s = await this.prisma.session.create({
      data: {
        userId: input.userId,
        kind: input.kind,
        ip: input.ip,
        userAgent: input.userAgent?.slice(0, 300),
        deviceId: input.deviceId,
        expiresAt,
      },
    });
    const token = signToken({
      sid: s.id,
      sub: input.userId,
      typ: input.kind === 'ADMIN' ? 'admin' : 'driver',
      exp: Math.floor(expiresAt.getTime() / 1000),
    });
    return { token, expiresAt, sessionId: s.id };
  }

  /** Resolves a bearer token to a principal, or null. Enforces expiry, idle timeout and account status. */
  async resolve(token: string): Promise<Principal | null> {
    const claims = verifyToken(token);
    if (!claims?.sid || (claims.typ !== 'admin' && claims.typ !== 'driver')) return null;
    const s = await this.prisma.session.findUnique({
      where: { id: claims.sid },
      include: { user: { include: { adminProfile: true, driverProfile: true } } },
    });
    if (!s || s.revokedAt || s.expiresAt <= new Date() || s.userId !== claims.sub) return null;
    if (s.user.status !== 'ACTIVE') return null;
    const kindMatches = (claims.typ === 'admin') === (s.kind === 'ADMIN');
    if (!kindMatches) return null;

    if (s.kind === 'ADMIN') {
      const idleMs = (await this.config.get<number>(CONFIG.adminIdleTimeoutMinutes)) * 60_000;
      if (Date.now() - s.lastSeenAt.getTime() > idleMs) {
        await this.revokeOne(s.id, 'idle_timeout');
        return null;
      }
    }
    await this.touch(s.id, s.lastSeenAt);

    if (s.kind === 'ADMIN') {
      const a = s.user.adminProfile;
      if (!a || !s.user.email) return null;
      return { kind: 'admin', role: a.role, userId: s.userId, adminId: a.id, sessionId: s.id, email: s.user.email, name: a.name };
    }
    const d = s.user.driverProfile;
    if (!d || d.status !== 'ACTIVE' || !s.user.phone) return null;
    return { kind: 'driver', role: 'DRIVER', userId: s.userId, driverId: d.id, sessionId: s.id, phone: s.user.phone };
  }

  private async touch(id: string, lastSeenAt: Date) {
    if (Date.now() - lastSeenAt.getTime() < TOUCH_EVERY_MS) return;
    await this.prisma.session.update({ where: { id }, data: { lastSeenAt: new Date() } });
  }

  async revokeOne(id: string, reason: string) {
    await this.prisma.session.updateMany({ where: { id, revokedAt: null }, data: { revokedAt: new Date(), revokeReason: reason } });
  }

  /**
   * Ends every live session of a user (suspension, disable, new device). Drivers also get a
   * `session.revoked` push on their WebSocket room so the app signs out at once.
   */
  async revokeAllForUser(userId: string, reason: string, opts: { exceptSessionId?: string; driverId?: string } = {}) {
    const r = await this.prisma.session.updateMany({
      where: { userId, revokedAt: null, ...(opts.exceptSessionId ? { id: { not: opts.exceptSessionId } } : {}) },
      data: { revokedAt: new Date(), revokeReason: reason },
    });
    if (opts.driverId) this.realtime.emit(`driver:${opts.driverId}`, 'session.revoked', { reason });
    return r.count;
  }

  /** Housekeeping for the system role: drop sessions that ended more than 30 days ago. */
  async purgeOld() {
    const cutoff = new Date(Date.now() - 30 * 86_400_000);
    const r = await this.prisma.session.deleteMany({
      where: { OR: [{ expiresAt: { lt: cutoff } }, { revokedAt: { lt: cutoff } }] },
    });
    return { deleted: r.count };
  }
}
