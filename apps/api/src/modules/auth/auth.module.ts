import { Body, Controller, Get, Global, HttpCode, Module, Param, ParseUUIDPipe, Patch, Post, Query, Req } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import {
  AdminRead,
  type AuthedRequest,
  Public,
  RateLimit,
  Roles,
  SelfService,
  SuperAdminOnly,
  clientIp,
  requireAdmin,
  requireDriver,
} from '../../common/auth/roles';
import { ApiZodBody, ZodPipe } from '../../common/zod';
import { AuditInterceptor } from '../audit/audit.service';
import { AdminAuthService } from './admin-auth.service';
import { DriverAuthService } from './driver-auth.service';
import { AuthGuard, RateLimitGuard } from './guards';
import { PrincipalResolver } from './principal.resolver';
import { RateLimitService } from './rate-limit.service';
import { SessionsService } from './sessions.service';

const meta = (req: AuthedRequest) => ({ ip: clientIp(req), userAgent: req.header('user-agent') ?? undefined });

const AdminLogin = z.object({
  email: z.string().min(3).max(200),
  password: z.string().min(1).max(200),
  totp: z.string().regex(/^\d{6}$/),
});
const AcceptInvite = z.object({
  token: z.string().min(20).max(200),
  password: z.string().min(1).max(200),
  totp: z.string().regex(/^\d{6}$/),
});
const RoleEnum = z.enum(['OPS_AGENT', 'SUPER_ADMIN', 'FINANCE']);
const CreateInvite = z.object({ email: z.string().email().max(200), name: z.string().min(1).max(120), role: RoleEnum });
const UpdateStaff = z
  .object({ role: RoleEnum.optional(), disabled: z.boolean().optional(), unlock: z.boolean().optional() })
  .refine((v) => Object.keys(v).length > 0, 'Nothing to change');

const Phone = z.string().min(7).max(20);
const DeviceId = z.string().min(8).max(100);
const ActivateStart = z.object({ phone: Phone });
const ActivateVerify = z.object({ challengeId: z.string().uuid(), otp: z.string().regex(/^\d{4,8}$/), inviteCode: z.string().regex(/^\d{6}$/) });
const ActivateComplete = z.object({ setupToken: z.string().min(20), pin: z.string(), acceptTerms: z.boolean(), deviceId: DeviceId });
const DriverLogin = z.object({ phone: Phone, pin: z.string().max(12), deviceId: DeviceId });
const DriverLoginVerify = z.object({ challengeId: z.string().uuid(), otp: z.string().regex(/^\d{4,8}$/) });

/** Admin sign-in, sign-out, invite acceptance and login history (ACC-07, 5.4). */
@ApiTags('admin-auth')
@Controller({ path: 'admin/auth', version: '1' })
export class AdminAuthController {
  constructor(private readonly auth: AdminAuthService) {}

  @Post('login')
  @HttpCode(200)
  @Public()
  @RateLimit('adminLogin')
  @ApiZodBody(AdminLogin)
  login(@Req() req: AuthedRequest, @Body(new ZodPipe(AdminLogin)) body: z.infer<typeof AdminLogin>) {
    return this.auth.login(body, meta(req));
  }

  @Get('invites/:token')
  @Public()
  @RateLimit('adminInvite')
  invite(@Param('token') token: string) {
    return this.auth.inviteDetails(token);
  }

  @Post('invites/accept')
  @HttpCode(200)
  @Public()
  @RateLimit('adminInvite')
  @ApiZodBody(AcceptInvite)
  accept(@Req() req: AuthedRequest, @Body(new ZodPipe(AcceptInvite)) body: z.infer<typeof AcceptInvite>) {
    return this.auth.acceptInvite(body, meta(req));
  }

  @Get('me')
  @AdminRead()
  me(@Req() req: AuthedRequest) {
    const a = requireAdmin(req);
    return { name: a.name, email: a.email, role: a.role };
  }

  @Get('logins')
  @AdminRead()
  myLogins(@Req() req: AuthedRequest) {
    return this.auth.loginHistory(requireAdmin(req).userId);
  }

  @Post('logout')
  @HttpCode(200)
  @AdminRead()
  @SelfService()
  logout(@Req() req: AuthedRequest) {
    return this.auth.logout(requireAdmin(req).sessionId);
  }
}

/** Staff and roles (PRD 17.1). Super admins only. */
@ApiTags('admin')
@SuperAdminOnly()
@Controller({ path: 'admin/staff', version: '1' })
export class AdminStaffController {
  constructor(private readonly auth: AdminAuthService) {}

  @Get()
  list() {
    return this.auth.listStaff();
  }

  @Get('logins')
  logins(@Query('userId') userId?: string) {
    return this.auth.loginHistory(userId, 200);
  }

  @Post('invites')
  @ApiZodBody(CreateInvite)
  invite(@Req() req: AuthedRequest, @Body(new ZodPipe(CreateInvite)) body: z.infer<typeof CreateInvite>) {
    return this.auth.createInvite({ ...body, invitedById: requireAdmin(req).userId });
  }

  @Post('invites/:id/revoke')
  @HttpCode(200)
  revokeInvite(@Param('id', ParseUUIDPipe) id: string) {
    return this.auth.revokeInvite(id);
  }

  @Patch(':id')
  @ApiZodBody(UpdateStaff)
  update(@Req() req: AuthedRequest, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(UpdateStaff)) body: z.infer<typeof UpdateStaff>) {
    return this.auth.updateStaff(requireAdmin(req).userId, id, body);
  }
}

/** Driver door (ACC-04 to ACC-06): activation and sign-in only. There is no sign-up route. */
@ApiTags('driver-auth')
@Controller({ path: 'driver', version: '1' })
export class DriverAuthController {
  constructor(private readonly auth: DriverAuthService) {}

  @Post('activate/start')
  @HttpCode(200)
  @Public()
  @RateLimit('driverActivate')
  @ApiZodBody(ActivateStart)
  start(@Body(new ZodPipe(ActivateStart)) body: z.infer<typeof ActivateStart>) {
    return this.auth.activationStart(body.phone);
  }

  @Post('activate/verify')
  @HttpCode(200)
  @Public()
  @RateLimit('otpVerify')
  @ApiZodBody(ActivateVerify)
  verify(@Body(new ZodPipe(ActivateVerify)) body: z.infer<typeof ActivateVerify>) {
    return this.auth.activationVerify(body);
  }

  @Post('activate/complete')
  @HttpCode(200)
  @Public()
  @RateLimit('driverActivate')
  @ApiZodBody(ActivateComplete)
  complete(@Req() req: AuthedRequest, @Body(new ZodPipe(ActivateComplete)) body: z.infer<typeof ActivateComplete>) {
    return this.auth.activationComplete(body, meta(req));
  }

  @Post('login')
  @HttpCode(200)
  @Public()
  @RateLimit('driverLogin')
  @ApiZodBody(DriverLogin)
  login(@Req() req: AuthedRequest, @Body(new ZodPipe(DriverLogin)) body: z.infer<typeof DriverLogin>) {
    return this.auth.login(body, meta(req));
  }

  @Post('login/verify')
  @HttpCode(200)
  @Public()
  @RateLimit('otpVerify')
  @ApiZodBody(DriverLoginVerify)
  loginVerify(@Req() req: AuthedRequest, @Body(new ZodPipe(DriverLoginVerify)) body: z.infer<typeof DriverLoginVerify>) {
    return this.auth.loginVerify(body, meta(req));
  }

  @Post('logout')
  @HttpCode(200)
  @Roles('DRIVER')
  logout(@Req() req: AuthedRequest) {
    return this.auth.logout(requireDriver(req).sessionId);
  }
}

/** Internal endpoints for background jobs, called with SYSTEM_API_TOKEN. */
@ApiTags('system')
@Roles('SYSTEM')
@Controller({ path: 'system', version: '1' })
export class SystemController {
  constructor(private readonly sessions: SessionsService) {}

  @Post('sessions/purge')
  @HttpCode(200)
  purge() {
    return this.sessions.purgeOld();
  }
}

@Global()
@Module({
  controllers: [AdminAuthController, AdminStaffController, DriverAuthController, SystemController],
  providers: [
    SessionsService,
    PrincipalResolver,
    RateLimitService,
    AdminAuthService,
    DriverAuthService,
    // Order matters: authenticate, then rate limit, then audit.
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: RateLimitGuard },
    { provide: APP_INTERCEPTOR, useExisting: AuditInterceptor },
  ],
  exports: [SessionsService, PrincipalResolver, RateLimitService, AdminAuthService],
})
export class AuthModule {}
