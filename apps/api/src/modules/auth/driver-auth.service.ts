import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { ChallengePurpose } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { SMS, type SmsAdapter } from '../../adapters/interfaces';
import { numericCode } from '../../common/crypto';
import { PrismaService } from '../../common/prisma.service';
import { hashSecret, pinProblem, verifySecret } from '../../common/auth/passwords';
import { signToken, verifyToken } from '../../common/auth/tokens';
import { AuditService } from '../audit/audit.service';
import { AlertsService } from '../support/alerts.service';
import { ConfigStore } from '../config/config.service';
import { CONFIG } from '../config/keys';
import { isDevelopment } from './admin-auth.service';
import { SessionsService } from './sessions.service';

interface OtpRule {
  digits: number;
  ttlMinutes: number;
  maxAttempts: number;
}

/** Nigerian numbers as +234XXXXXXXXXX; other international numbers kept as +<digits>. */
export function normalisePhone(raw: string): string | null {
  const digits = raw.replace(/[\s()-]/g, '');
  if (/^0[789][01]\d{8}$/.test(digits)) return `+234${digits.slice(1)}`;
  if (/^234[789][01]\d{8}$/.test(digits)) return `+${digits}`;
  if (/^\+234[789][01]\d{8}$/.test(digits)) return digits;
  if (/^\+[1-9]\d{7,14}$/.test(digits)) return digits;
  return null;
}

const BAD_CODE = { code: 'CODE_INVALID', message: 'That code is wrong or has expired.' };
const BAD_LOGIN = { code: 'INVALID_CREDENTIALS', message: 'Phone number or PIN is wrong.' };

interface Meta {
  ip?: string;
  userAgent?: string;
}

/**
 * Driver door (ACC-04 to ACC-06): activation with an admin-sent invite, then phone + PIN.
 * There is no sign-up: every path requires a Driver profile created by ops.
 */
@Injectable()
export class DriverAuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: SessionsService,
    private readonly config: ConfigStore,
    private readonly audit: AuditService,
    private readonly alerts: AlertsService,
    @Inject(SMS) private readonly sms: SmsAdapter,
  ) {}

  private phoneOrThrow(raw: string) {
    const phone = normalisePhone(raw);
    if (!phone)
      throw new BadRequestException({
        code: 'PHONE_INVALID',
        message: 'Enter a valid mobile number.',
      });
    return phone;
  }

  private async sendOtp(
    purpose: ChallengePurpose,
    phone: string,
    userId: string | null,
    data?: object,
  ) {
    const rule = await this.config.get<OtpRule>(CONFIG.otp);
    const code = numericCode(rule.digits);
    // Older open challenges for the same phone and purpose stop working.
    await this.prisma.authChallenge.updateMany({
      where: { phone, purpose, usedAt: null },
      data: { usedAt: new Date() },
    });
    const ch = await this.prisma.authChallenge.create({
      data: {
        purpose,
        phone,
        userId,
        codeHash: await hashSecret(code),
        data,
        expiresAt: new Date(Date.now() + rule.ttlMinutes * 60_000),
      },
    });
    await this.sms.send(
      phone,
      `Airwheels: your code is ${code}. It expires in ${rule.ttlMinutes} minutes. Never share it.`,
    );
    return { challengeId: ch.id, ...(isDevelopment() ? { devCode: code } : {}) };
  }

  /** Checks a one-time code. Counts attempts atomically and burns the challenge at the limit. */
  private async checkOtp(challengeId: string, purpose: ChallengePurpose, code: string) {
    const rule = await this.config.get<OtpRule>(CONFIG.otp);
    const ch = await this.prisma.authChallenge.findUnique({ where: { id: challengeId } });
    if (
      !ch ||
      ch.purpose !== purpose ||
      ch.usedAt ||
      ch.expiresAt <= new Date() ||
      ch.attempts >= rule.maxAttempts
    ) {
      throw new UnauthorizedException(BAD_CODE);
    }
    if (!(await verifySecret(ch.codeHash, code))) {
      await this.prisma.authChallenge.update({
        where: { id: ch.id },
        data: { attempts: { increment: 1 } },
      });
      throw new UnauthorizedException(BAD_CODE);
    }
    const claimed = await this.prisma.authChallenge.updateMany({
      where: { id: ch.id, usedAt: null },
      data: { usedAt: new Date() },
    });
    if (claimed.count !== 1) throw new UnauthorizedException(BAD_CODE);
    return ch;
  }

  // ---------- activation ----------

  /** Step 1: phone number. Sends an OTP only if this phone has a live invite, but always answers the same. */
  async activationStart(rawPhone: string) {
    const phone = this.phoneOrThrow(rawPhone);
    const user = await this.prisma.user.findUnique({
      where: { phone },
      include: { driverProfile: true },
    });
    const driver = user?.driverProfile;
    const invite =
      driver &&
      (driver.status === 'INVITED' || driver.status === 'ACTIVATED') &&
      (await this.prisma.driverInvite.findFirst({
        where: {
          driverId: driver.id,
          usedAt: null,
          revokedAt: null,
          expiresAt: { gt: new Date() },
        },
      }));
    if (!user || !invite) {
      // Same shape as success, so the endpoint does not reveal who is invited.
      return { challengeId: randomUUID() };
    }
    return this.sendOtp('DRIVER_ACTIVATION', phone, user.id);
  }

  /** Step 2: OTP and invite code. Marks the driver Activated and returns a short-lived setup token. */
  async activationVerify(input: { challengeId: string; otp: string; inviteCode: string }) {
    const ch = await this.checkOtp(input.challengeId, 'DRIVER_ACTIVATION', input.otp);
    const user = await this.prisma.user.findUnique({
      where: { id: ch.userId ?? '' },
      include: { driverProfile: true },
    });
    const driver = user?.driverProfile;
    if (!user || !driver) throw new UnauthorizedException(BAD_CODE);
    const invite = await this.prisma.driverInvite.findFirst({
      where: {
        driverId: driver.id,
        phone: ch.phone,
        usedAt: null,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: 'desc' },
    });
    const rule = await this.config.get<OtpRule>(CONFIG.otp);
    if (!invite || invite.attempts >= rule.maxAttempts) throw new UnauthorizedException(BAD_CODE);
    if (!(await verifySecret(invite.codeHash, input.inviteCode))) {
      const attempts = invite.attempts + 1;
      await this.prisma.driverInvite.update({
        where: { id: invite.id },
        data: { attempts, ...(attempts >= rule.maxAttempts ? { revokedAt: new Date() } : {}) },
      });
      throw new UnauthorizedException({
        code: 'INVITE_CODE_INVALID',
        message: 'The invite code is wrong. Check the SMS from Airwheels.',
      });
    }
    await this.prisma.$transaction([
      this.prisma.driverInvite.update({ where: { id: invite.id }, data: { usedAt: new Date() } }),
      this.prisma.user.update({ where: { id: user.id }, data: { phoneVerified: true } }),
      this.prisma.driverProfile.update({ where: { id: driver.id }, data: { status: 'ACTIVATED' } }),
    ]);
    await this.audit.record({
      action: 'driver.activated',
      entity: 'DriverProfile',
      entityId: driver.id,
      actorId: user.id,
      actorRole: 'DRIVER',
      actorLabel: ch.phone,
      before: { status: driver.status },
      after: { status: 'ACTIVATED' },
    });
    const setupToken = signToken({
      sub: driver.id,
      typ: 'driver_setup',
      exp: Math.floor(Date.now() / 1000) + 30 * 60,
    });
    return { setupToken, firstName: driver.firstName };
  }

  /** Step 3: six-digit PIN and terms. Binds this device, makes the account Active and signs in. */
  async activationComplete(
    input: { setupToken: string; pin: string; acceptTerms: boolean; deviceId: string },
    meta: Meta,
  ) {
    const claims = verifyToken(input.setupToken);
    if (!claims || claims.typ !== 'driver_setup') {
      throw new UnauthorizedException({
        code: 'SETUP_EXPIRED',
        message: 'Activation timed out. Start again.',
      });
    }
    if (!input.acceptTerms)
      throw new BadRequestException({
        code: 'TERMS_REQUIRED',
        message: 'Accept the driver terms to continue.',
      });
    const problem = pinProblem(input.pin);
    if (problem) throw new BadRequestException({ code: 'PIN_WEAK', message: problem });
    const driver = await this.prisma.driverProfile.findUnique({
      where: { id: claims.sub },
      include: { user: true },
    });
    if (!driver || driver.status !== 'ACTIVATED') {
      throw new UnauthorizedException({
        code: 'SETUP_EXPIRED',
        message: 'Activation timed out. Start again.',
      });
    }
    await this.prisma.driverProfile.update({
      where: { id: driver.id },
      data: {
        pinHash: await hashSecret(input.pin),
        pinFailedCount: 0,
        pinLockedUntil: null,
        termsAcceptedAt: new Date(),
        deviceId: input.deviceId,
        status: 'ACTIVE',
        activatedAt: new Date(),
      },
    });
    const session = await this.sessions.create({
      userId: driver.userId,
      kind: 'DRIVER',
      deviceId: input.deviceId,
      ip: meta.ip,
      userAgent: meta.userAgent,
    });
    await this.audit.record({
      action: 'driver.account_active',
      entity: 'DriverProfile',
      entityId: driver.id,
      actorId: driver.userId,
      actorRole: 'DRIVER',
      actorLabel: driver.user.phone ?? undefined,
      before: { status: 'ACTIVATED' },
      after: { status: 'ACTIVE', deviceId: input.deviceId },
    });
    return { token: session.token, expiresAt: session.expiresAt };
  }

  // ---------- sign in ----------

  async login(input: { phone: string; pin: string; deviceId: string }, meta: Meta) {
    const phone = this.phoneOrThrow(input.phone);
    const user = await this.prisma.user.findUnique({
      where: { phone },
      include: { driverProfile: true },
    });
    const driver = user?.driverProfile;
    const log = (success: boolean, reason?: string) =>
      this.prisma.loginEvent.create({
        data: {
          userId: user?.id,
          kind: 'DRIVER',
          identifier: phone,
          success,
          reason,
          ip: meta.ip,
          userAgent: meta.userAgent,
          deviceId: input.deviceId,
        },
      });

    // No Driver profile made by an admin means no way in (ACC-04).
    if (!user || !driver) {
      await verifySecret(null, input.pin);
      await log(false, 'not_a_driver');
      throw new UnauthorizedException(BAD_LOGIN);
    }
    if (driver.status === 'SUSPENDED') {
      await log(false, 'suspended');
      throw new ForbiddenException({
        code: 'ACCOUNT_SUSPENDED',
        message: 'Your account is suspended. Call Airwheels ops.',
      });
    }
    if (driver.status !== 'ACTIVE') {
      await log(false, `status_${driver.status.toLowerCase()}`);
      throw new UnauthorizedException({
        code: 'NOT_ACTIVATED',
        message: 'Activate your account with the invite code first.',
      });
    }
    if (driver.pinLockedUntil && driver.pinLockedUntil > new Date()) {
      await log(false, 'pin_locked');
      throw new HttpException(
        { code: 'PIN_LOCKED', message: 'Too many wrong PINs. Try again later or call ops.' },
        HttpStatus.LOCKED,
      );
    }
    if (!(await verifySecret(driver.pinHash, input.pin))) {
      const lock = await this.config.get<{ maxFailures: number; lockMinutes: number }>(
        CONFIG.driverPinLockout,
      );
      const failures = driver.pinFailedCount + 1;
      await this.prisma.driverProfile.update({
        where: { id: driver.id },
        data:
          failures >= lock.maxFailures
            ? {
                pinFailedCount: 0,
                pinLockedUntil: new Date(Date.now() + lock.lockMinutes * 60_000),
              }
            : { pinFailedCount: failures },
      });
      await log(false, 'bad_pin');
      throw new UnauthorizedException(BAD_LOGIN);
    }
    await this.prisma.driverProfile.update({
      where: { id: driver.id },
      data: { pinFailedCount: 0, pinLockedUntil: null },
    });

    if (driver.deviceId !== input.deviceId) {
      // New device: prove the phone with an OTP first (ACC-06).
      await log(false, 'new_device_otp_sent');
      return {
        otpRequired: true as const,
        ...(await this.sendOtp('DRIVER_NEW_DEVICE', phone, user.id, { deviceId: input.deviceId })),
      };
    }
    await log(true);
    return this.startSession(driver.id, user.id, input.deviceId, meta);
  }

  /** New-device step: the OTP rebinds the account to this device and signs every other device out. */
  async loginVerify(input: { challengeId: string; otp: string }, meta: Meta) {
    const ch = await this.checkOtp(input.challengeId, 'DRIVER_NEW_DEVICE', input.otp);
    const deviceId = (ch.data as { deviceId?: string } | null)?.deviceId;
    const driver = await this.prisma.driverProfile.findFirst({
      where: { userId: ch.userId ?? '' },
    });
    if (!deviceId || !driver || driver.status !== 'ACTIVE')
      throw new UnauthorizedException(BAD_CODE);
    const previous = driver.deviceId;
    await this.prisma.driverProfile.update({ where: { id: driver.id }, data: { deviceId } });
    await this.prisma.loginEvent.create({
      data: {
        userId: driver.userId,
        kind: 'DRIVER',
        identifier: ch.phone,
        success: true,
        reason: 'new_device',
        ip: meta.ip,
        userAgent: meta.userAgent,
        deviceId,
      },
    });
    await this.audit.record({
      action: 'driver.new_device',
      entity: 'DriverProfile',
      entityId: driver.id,
      actorId: driver.userId,
      actorRole: 'DRIVER',
      actorLabel: ch.phone,
      before: { deviceId: previous },
      after: { deviceId },
    });
    await this.alerts.raise({
      type: 'DRIVER_NEW_DEVICE',
      message: `${driver.firstName} ${driver.lastName} signed in on a new device. Other devices were signed out.`,
      driverId: driver.id,
    });
    return this.startSession(driver.id, driver.userId, deviceId, meta);
  }

  /** One active device per driver: every other session ends when a new one starts. */
  private async startSession(driverId: string, userId: string, deviceId: string, meta: Meta) {
    const session = await this.sessions.create({
      userId,
      kind: 'DRIVER',
      deviceId,
      ip: meta.ip,
      userAgent: meta.userAgent,
    });
    await this.sessions.revokeAllForUser(userId, 'signed_in_elsewhere', {
      exceptSessionId: session.sessionId,
    });
    return {
      otpRequired: false as const,
      token: session.token,
      expiresAt: session.expiresAt,
      driverId,
    };
  }

  async logout(sessionId: string) {
    await this.sessions.revokeOne(sessionId, 'sign_out');
    return { ok: true };
  }
}
