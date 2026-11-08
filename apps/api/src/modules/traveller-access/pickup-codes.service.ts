import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma.service';
import { AuditService } from '../audit/audit.service';
import { ConfigStore } from '../config/config.service';
import { CONFIG } from '../config/keys';
import { MessagingService } from '../messaging/messaging.module';
import { AlertsService } from '../support/alerts.service';
import { type PickupCodeCheck, pickupCodeFor, pickupCodeHash } from './codes';

export const PICKUP_CODE_LOCKED_ALERT = 'PICKUP_CODE_LOCKED';

/**
 * Pickup code checks with a per-leg attempt limit (ACC-11) and ops reissue (ACC-10).
 *
 * At the limit only code entry locks for that leg: the leg's status is never touched here, so the
 * trip carries on. Ops get one alert, verify the traveller by phone and reissue the code, which
 * issues a new code version, clears the lock and sends the new code to the traveller.
 */
@Injectable()
export class PickupCodesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigStore,
    private readonly audit: AuditService,
    private readonly alerts: AlertsService,
    private readonly messaging: MessagingService,
  ) {}

  /** Driver enters a code. `driverId` must be the leg's assigned driver (drivers see only their jobs). */
  async verify(legId: string, guess: string, driverId?: string): Promise<PickupCodeCheck> {
    const leg = await this.prisma.rideLeg.findUnique({ where: { id: legId } });
    if (!leg) throw new NotFoundException({ code: 'LEG_NOT_FOUND', message: 'No such leg.' });
    if (driverId !== undefined && leg.driverId !== driverId) {
      throw new ForbiddenException({
        code: 'NOT_YOUR_JOB',
        message: 'This job is not assigned to you.',
      });
    }
    const max = await this.config.get<number>(CONFIG.pickupCodeMaxAttempts);
    if (leg.pickupCodeLockedAt || leg.pickupCodeFailedAttempts >= max) return { result: 'LOCKED' };
    if (pickupCodeHash(legId, leg.pickupCodeVersion, guess) === leg.pickupCodeHash)
      return { result: 'OK' };

    // Count the miss atomically, then decide from the stored count, so parallel guesses
    // cannot slip past the limit or skip the lock.
    const after = await this.prisma.rideLeg.update({
      where: { id: legId },
      data: { pickupCodeFailedAttempts: { increment: 1 } },
      select: { pickupCodeFailedAttempts: true, pickupCodeVersion: true },
    });
    if (after.pickupCodeFailedAttempts < max)
      return { result: 'WRONG', attemptsLeft: max - after.pickupCodeFailedAttempts };

    // Only the request that sets the lock raises the alert.
    const locked = await this.prisma.rideLeg.updateMany({
      where: { id: legId, pickupCodeLockedAt: null, pickupCodeVersion: after.pickupCodeVersion },
      data: { pickupCodeLockedAt: new Date() },
    });
    if (locked.count === 1) {
      await this.alerts.raise({
        type: PICKUP_CODE_LOCKED_ALERT,
        message: `Pickup code entry locked after ${max} wrong attempts. Call the traveller to verify them, then reissue the code. The trip continues.`,
        bookingId: leg.bookingId,
        legId,
        driverId: leg.driverId ?? undefined,
        data: { attempts: after.pickupCodeFailedAttempts, codeVersion: after.pickupCodeVersion },
      });
      await this.prisma.bookingEvent.create({
        data: {
          bookingId: leg.bookingId,
          type: 'pickup_code.locked',
          actorRole: 'DRIVER',
          actorId: leg.driverId ?? undefined,
          reason: 'Wrong pickup code attempt limit reached',
          data: { legId, attempts: after.pickupCodeFailedAttempts },
        },
      });
    }
    return { result: 'LOCKED' };
  }

  /** New code version: the old code stops at once, the lock and attempts clear, the traveller gets the new code. */
  async reissue(legId: string, actorUserId?: string) {
    const leg = await this.prisma.rideLeg.findUnique({
      where: { id: legId },
      include: { booking: { include: { traveller: true, airline: true } } },
    });
    if (!leg) throw new NotFoundException({ code: 'LEG_NOT_FOUND', message: 'No such leg.' });
    const version = leg.pickupCodeVersion + 1;
    const code = pickupCodeFor(legId, version);
    await this.prisma.rideLeg.update({
      where: { id: legId },
      data: {
        pickupCodeVersion: version,
        pickupCodeHash: pickupCodeHash(legId, version, code),
        pickupCodeFailedAttempts: 0,
        pickupCodeLockedAt: null,
      },
    });
    await this.alerts.resolveFor(legId, PICKUP_CODE_LOCKED_ALERT, actorUserId);
    await this.audit.record({
      action: 'pickup_code.reissue',
      entity: 'RideLeg',
      entityId: legId,
      before: {
        version: leg.pickupCodeVersion,
        failedAttempts: leg.pickupCodeFailedAttempts,
        locked: !!leg.pickupCodeLockedAt,
      },
      after: { version, failedAttempts: 0, locked: false },
    });
    const t = leg.booking.traveller;
    if (t) {
      await this.messaging.notify('pickup_code.reissued', {
        bookingId: leg.bookingId,
        legId,
        instance: `v${version}`,
      });
    }
    return { legId, version, travellerNotified: !!t };
  }
}
