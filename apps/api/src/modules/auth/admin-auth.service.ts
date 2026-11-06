import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import type { AdminRole } from '@prisma/client';
import { EMAIL, type EmailAdapter } from '../../adapters/interfaces';
import { decrypt, encrypt, randomToken, sha256 } from '../../common/crypto';
import { PrismaService } from '../../common/prisma.service';
import { hashSecret, passwordProblem, verifySecret } from '../../common/auth/passwords';
import { generateTotpSecret, otpauthUri, verifyTotp } from '../../common/auth/totp';
import { AuditService } from '../audit/audit.service';
import { ConfigStore } from '../config/config.service';
import { CONFIG } from '../config/keys';
import { SessionsService } from './sessions.service';

const GENERIC_FAIL = { code: 'INVALID_CREDENTIALS', message: 'Email, password or code is wrong.' };

export const isDevelopment = () => process.env.NODE_ENV === 'development';
const adminUrl = () => process.env.ADMIN_PUBLIC_URL ?? 'http://localhost:3001';
const normaliseEmail = (e: string) => e.trim().toLowerCase();

interface RequestMeta {
  ip?: string;
  userAgent?: string;
}

/** Admin sign-in with email, password and TOTP, lockout, login history and staff invites (5.4, ACC-07). */
@Injectable()
export class AdminAuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: SessionsService,
    private readonly config: ConfigStore,
    private readonly audit: AuditService,
    @Inject(EMAIL) private readonly email: EmailAdapter,
  ) {}

  async login(input: { email: string; password: string; totp: string }, meta: RequestMeta) {
    const email = normaliseEmail(input.email);
    const user = await this.prisma.user.findUnique({ where: { email }, include: { adminProfile: true } });
    const admin = user?.adminProfile;
    const fail = async (reason: string, countFailure: boolean) => {
      await this.prisma.loginEvent.create({
        data: { userId: user?.id, kind: 'ADMIN', identifier: email, success: false, reason, ip: meta.ip, userAgent: meta.userAgent },
      });
      if (countFailure && admin) {
        const lock = await this.config.get<{ maxFailures: number; lockMinutes: number }>(CONFIG.adminLockout);
        const failures = admin.failedLoginCount + 1;
        await this.prisma.adminProfile.update({
          where: { id: admin.id },
          data:
            failures >= lock.maxFailures
              ? { failedLoginCount: 0, lockedUntil: new Date(Date.now() + lock.lockMinutes * 60_000) }
              : { failedLoginCount: failures },
        });
      }
    };

    if (admin?.lockedUntil && admin.lockedUntil > new Date()) {
      await fail('locked', false);
      throw new HttpException(
        { code: 'ACCOUNT_LOCKED', message: 'Too many failed sign-ins. This account is locked for a few minutes.' },
        HttpStatus.LOCKED,
      );
    }
    const passwordOk = await verifySecret(user?.passwordHash, input.password);
    if (!user || !admin || !passwordOk) {
      await fail(user ? 'bad_password' : 'unknown_email', true);
      throw new UnauthorizedException(GENERIC_FAIL);
    }
    if (user.status !== 'ACTIVE') {
      await fail('disabled', false);
      throw new UnauthorizedException(GENERIC_FAIL);
    }
    const step = admin.totpSecret ? verifyTotp(decrypt(admin.totpSecret), input.totp) : null;
    if (step === null || (admin.lastTotpStep !== null && step <= admin.lastTotpStep)) {
      await fail(step === null ? 'bad_totp' : 'totp_replay', true);
      throw new UnauthorizedException(GENERIC_FAIL);
    }

    await this.prisma.adminProfile.update({
      where: { id: admin.id },
      data: { failedLoginCount: 0, lockedUntil: null, lastTotpStep: step, lastLoginAt: new Date(), lastLoginIp: meta.ip },
    });
    await this.prisma.loginEvent.create({
      data: { userId: user.id, kind: 'ADMIN', identifier: email, success: true, ip: meta.ip, userAgent: meta.userAgent },
    });
    const session = await this.sessions.create({ userId: user.id, kind: 'ADMIN', ip: meta.ip, userAgent: meta.userAgent });
    await this.audit.record({
      action: 'auth.admin_sign_in',
      entity: 'Session',
      entityId: session.sessionId,
      actorId: user.id,
      actorRole: 'OPS',
      actorLabel: `${email} (${admin.role})`,
      ip: meta.ip,
    });
    return { token: session.token, expiresAt: session.expiresAt, admin: { name: admin.name, email, role: admin.role } };
  }

  async logout(sessionId: string) {
    await this.sessions.revokeOne(sessionId, 'sign_out');
    await this.audit.record({ action: 'auth.admin_sign_out', entity: 'Session', entityId: sessionId });
    return { ok: true };
  }

  loginHistory(userId?: string, limit = 50) {
    return this.prisma.loginEvent.findMany({
      where: { kind: 'ADMIN', ...(userId ? { userId } : {}) },
      orderBy: { time: 'desc' },
      take: limit,
    });
  }

  // ---------- invites ----------

  /** Creates an invite and emails the link. Used by super admins and by the one-time CLI. */
  async createInvite(input: { email: string; name: string; role: AdminRole; invitedById?: string }) {
    const email = normaliseEmail(input.email);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new BadRequestException({ code: 'EMAIL_INVALID', message: 'Enter a valid email.' });
    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) throw new ConflictException({ code: 'STAFF_EXISTS', message: 'Someone with this email is already staff.' });
    await this.prisma.adminInvite.updateMany({
      where: { email, acceptedAt: null, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    const token = randomToken(32);
    const hours = await this.config.get<number>(CONFIG.adminInviteExpiryHours);
    const invite = await this.prisma.adminInvite.create({
      data: {
        email,
        name: input.name.trim(),
        role: input.role,
        tokenHash: sha256(token),
        invitedById: input.invitedById,
        expiresAt: new Date(Date.now() + hours * 3_600_000),
      },
    });
    const link = `${adminUrl()}/accept-invite?token=${token}`;
    await this.email.send({
      to: email,
      subject: 'You are invited to Airwheels admin',
      html: `<p>Hello ${input.name},</p><p>You have been invited as ${input.role.replace('_', ' ').toLowerCase()}. <a href="${link}">Set up your account</a>. The link expires in ${hours} hours.</p>`,
      text: `You have been invited to Airwheels admin. Set up your account: ${link}`,
    });
    await this.audit.record({
      action: 'staff.invite',
      entity: 'AdminInvite',
      entityId: invite.id,
      after: { email, name: invite.name, role: invite.role, expiresAt: invite.expiresAt },
    });
    return {
      id: invite.id,
      email,
      role: invite.role,
      expiresAt: invite.expiresAt,
      // Only in local development, where email is faked: lets you open the link without an inbox.
      ...(isDevelopment() ? { devLink: link } : {}),
    };
  }

  private async openInvite(token: string) {
    const invite = await this.prisma.adminInvite.findUnique({ where: { tokenHash: sha256(token) } });
    if (!invite || invite.acceptedAt || invite.revokedAt || invite.expiresAt <= new Date()) {
      throw new NotFoundException({ code: 'INVITE_INVALID', message: 'This invite link is not valid any more. Ask for a new one.' });
    }
    return invite;
  }

  /** First step of accepting: returns the TOTP secret to add to an authenticator app. */
  async inviteDetails(token: string) {
    const invite = await this.openInvite(token);
    let secret = invite.pendingTotpSecret ? decrypt(invite.pendingTotpSecret) : null;
    if (!secret) {
      secret = generateTotpSecret();
      await this.prisma.adminInvite.update({ where: { id: invite.id }, data: { pendingTotpSecret: encrypt(secret) } });
    }
    return {
      email: invite.email,
      name: invite.name,
      role: invite.role,
      totpSecret: secret,
      totpUri: otpauthUri(secret, invite.email),
    };
  }

  /** Sets the password, proves the authenticator works, creates the account and signs in. */
  async acceptInvite(input: { token: string; password: string; totp: string }, meta: RequestMeta) {
    const invite = await this.openInvite(input.token);
    if (!invite.pendingTotpSecret) throw new BadRequestException({ code: 'INVITE_NOT_OPENED', message: 'Open the invite link first.' });
    const problem = passwordProblem(input.password);
    if (problem) throw new BadRequestException({ code: 'PASSWORD_WEAK', message: problem });
    const secret = decrypt(invite.pendingTotpSecret);
    const step = verifyTotp(secret, input.totp);
    if (step === null) throw new BadRequestException({ code: 'TOTP_INVALID', message: 'That code is wrong. Check the time on your phone and try the newest code.' });

    const passwordHash = await hashSecret(input.password);
    const user = await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.adminInvite.updateMany({
        where: { id: invite.id, acceptedAt: null, revokedAt: null },
        data: { acceptedAt: new Date(), pendingTotpSecret: null },
      });
      if (claimed.count !== 1) throw new ConflictException({ code: 'INVITE_USED', message: 'This invite was already used.' });
      if (await tx.user.findUnique({ where: { email: invite.email } })) {
        throw new ConflictException({ code: 'STAFF_EXISTS', message: 'Someone with this email is already staff.' });
      }
      return tx.user.create({
        data: {
          email: invite.email,
          passwordHash,
          adminProfile: {
            create: {
              name: invite.name,
              role: invite.role,
              totpSecret: encrypt(secret),
              lastTotpStep: step,
              invitedById: invite.invitedById,
              lastLoginAt: new Date(),
              lastLoginIp: meta.ip,
            },
          },
        },
        include: { adminProfile: true },
      });
    });
    await this.prisma.loginEvent.create({
      data: { userId: user.id, kind: 'ADMIN', identifier: invite.email, success: true, reason: 'invite_accepted', ip: meta.ip, userAgent: meta.userAgent },
    });
    const session = await this.sessions.create({ userId: user.id, kind: 'ADMIN', ip: meta.ip, userAgent: meta.userAgent });
    await this.audit.record({
      action: 'staff.invite_accepted',
      entity: 'AdminProfile',
      entityId: user.adminProfile!.id,
      actorId: user.id,
      actorRole: 'OPS',
      actorLabel: `${invite.email} (${invite.role})`,
      ip: meta.ip,
      after: { email: invite.email, name: invite.name, role: invite.role },
    });
    return {
      token: session.token,
      expiresAt: session.expiresAt,
      admin: { name: invite.name, email: invite.email, role: invite.role },
    };
  }

  // ---------- staff management (super admin) ----------

  async listStaff() {
    const [staff, invites] = await Promise.all([
      this.prisma.adminProfile.findMany({
        include: { user: { select: { email: true, status: true } } },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.adminInvite.findMany({
        where: { acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } },
        orderBy: { createdAt: 'desc' },
        select: { id: true, email: true, name: true, role: true, expiresAt: true, createdAt: true },
      }),
    ]);
    return {
      staff: staff.map((a) => ({
        id: a.id,
        userId: a.userId,
        name: a.name,
        email: a.user.email,
        role: a.role,
        status: a.user.status,
        twoFactor: !!a.totpSecret,
        lockedUntil: a.lockedUntil,
        lastLoginAt: a.lastLoginAt,
        lastLoginIp: a.lastLoginIp,
      })),
      invites,
    };
  }

  async revokeInvite(id: string) {
    const before = await this.prisma.adminInvite.findUnique({ where: { id } });
    if (!before) throw new NotFoundException({ code: 'INVITE_NOT_FOUND', message: 'No such invite.' });
    await this.prisma.adminInvite.update({ where: { id }, data: { revokedAt: new Date() } });
    await this.audit.record({ action: 'staff.invite_revoke', entity: 'AdminInvite', entityId: id, before: { email: before.email, role: before.role } });
    return { ok: true };
  }

  async updateStaff(actorUserId: string, adminId: string, input: { role?: AdminRole; disabled?: boolean; unlock?: boolean }) {
    const before = await this.prisma.adminProfile.findUnique({ where: { id: adminId }, include: { user: true } });
    if (!before) throw new NotFoundException({ code: 'STAFF_NOT_FOUND', message: 'No such staff member.' });
    if (before.userId === actorUserId && (input.disabled || (input.role && input.role !== 'SUPER_ADMIN'))) {
      throw new BadRequestException({ code: 'SELF_CHANGE', message: 'You cannot disable yourself or remove your own super admin role.' });
    }
    if (input.role && input.role !== 'SUPER_ADMIN' && before.role === 'SUPER_ADMIN') await this.assertAnotherSuperAdmin(adminId);
    if (input.disabled && before.role === 'SUPER_ADMIN') await this.assertAnotherSuperAdmin(adminId);

    await this.prisma.$transaction([
      this.prisma.adminProfile.update({
        where: { id: adminId },
        data: { ...(input.role ? { role: input.role } : {}), ...(input.unlock ? { lockedUntil: null, failedLoginCount: 0 } : {}) },
      }),
      ...(input.disabled !== undefined
        ? [this.prisma.user.update({ where: { id: before.userId }, data: { status: input.disabled ? 'DISABLED' : 'ACTIVE' } })]
        : []),
    ]);
    // A role change or disable takes effect at once: end their sessions.
    if (input.disabled || (input.role && input.role !== before.role)) {
      await this.sessions.revokeAllForUser(before.userId, input.disabled ? 'disabled' : 'role_changed');
    }
    await this.audit.record({
      action: 'staff.update',
      entity: 'AdminProfile',
      entityId: adminId,
      before: { role: before.role, status: before.user.status, lockedUntil: before.lockedUntil },
      after: {
        role: input.role ?? before.role,
        status: input.disabled === undefined ? before.user.status : input.disabled ? 'DISABLED' : 'ACTIVE',
        lockedUntil: input.unlock ? null : before.lockedUntil,
      },
    });
    return { ok: true };
  }

  private async assertAnotherSuperAdmin(exceptAdminId: string) {
    const others = await this.prisma.adminProfile.count({
      where: { role: 'SUPER_ADMIN', id: { not: exceptAdminId }, user: { status: 'ACTIVE' } },
    });
    if (others === 0) throw new BadRequestException({ code: 'LAST_SUPER_ADMIN', message: 'Keep at least one active super admin.' });
  }
}
