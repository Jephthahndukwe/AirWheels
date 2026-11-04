import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma.service';
import { AuditService } from '../audit/audit.service';
import { ConfigStore } from '../config/config.service';
import { CONFIG } from '../config/keys';
import { type PickupCodeCheck, checkPickupCode, pickupCodeFor, pickupCodeHash } from './codes';

/** Verifies pickup codes with an attempt limit, and lets ops reissue a code (DSP-08, DRV-07). */
@Injectable()
export class PickupCodesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigStore,
    private readonly audit: AuditService,
  ) {}

  async verify(legId: string, guess: string): Promise<PickupCodeCheck> {
    const leg = await this.prisma.rideLeg.findUnique({ where: { id: legId } });
    if (!leg) throw new NotFoundException({ code: 'LEG_NOT_FOUND', message: 'No such leg.' });
    const check = checkPickupCode({
      legId,
      version: leg.pickupCodeVersion,
      storedHash: leg.pickupCodeHash,
      guess,
      failedAttempts: leg.pickupCodeFailedAttempts,
      maxAttempts: await this.config.get<number>(CONFIG.pickupCodeMaxAttempts),
    });
    if (check.result !== 'OK') {
      // Atomic increment, so parallel guesses cannot slip past the limit.
      await this.prisma.rideLeg.update({
        where: { id: legId },
        data: {
          pickupCodeFailedAttempts: { increment: 1 },
          pickupCodeLockedAt: check.result === 'LOCKED' ? (leg.pickupCodeLockedAt ?? new Date()) : undefined,
        },
      });
    }
    return check;
  }

  /** New code version: the old code stops working, attempts reset. Audited. */
  async reissue(legId: string, actorId?: string) {
    const leg = await this.prisma.rideLeg.findUnique({ where: { id: legId } });
    if (!leg) throw new NotFoundException({ code: 'LEG_NOT_FOUND', message: 'No such leg.' });
    const version = leg.pickupCodeVersion + 1;
    await this.prisma.rideLeg.update({
      where: { id: legId },
      data: {
        pickupCodeVersion: version,
        pickupCodeHash: pickupCodeHash(legId, version, pickupCodeFor(legId, version)),
        pickupCodeFailedAttempts: 0,
        pickupCodeLockedAt: null,
      },
    });
    await this.audit.record({
      actorId,
      actorRole: 'OPS',
      action: 'pickup_code.reissue',
      entity: 'RideLeg',
      entityId: legId,
      before: { version: leg.pickupCodeVersion },
      after: { version },
    });
    // Sending the new code to the traveller is wired with messaging templates in M3.
    return { legId, version };
  }
}
