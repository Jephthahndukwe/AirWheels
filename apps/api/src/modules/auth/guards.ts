import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Response } from 'express';
import {
  type AuthedRequest,
  PUBLIC_KEY,
  RATE_LIMIT_KEY,
  ROLES_KEY,
  type RateLimitBy,
  type Role,
  SELF_SERVICE_KEY,
  clientIp,
} from '../../common/auth/roles';
import { PrincipalResolver } from './principal.resolver';
import { RateLimitService } from './rate-limit.service';

const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** Pure decision, unit-tested on its own. */
export function decideAccess(input: {
  isPublic: boolean;
  roles: Role[] | undefined;
  method: string;
  selfService: boolean;
  principalRole: Role | null;
}): 'allow' | 'unauthenticated' | 'forbidden' | 'undeclared' {
  if (input.isPublic) return 'allow';
  if (!input.roles || input.roles.length === 0) return 'undeclared';
  if (!input.principalRole) return 'unauthenticated';
  // Finance is read-only (PRD 2.2), whatever a route declares, except its own sign-out.
  if (
    input.principalRole === 'FINANCE' &&
    !READ_METHODS.has(input.method.toUpperCase()) &&
    !input.selfService
  ) {
    return 'forbidden';
  }
  return input.roles.includes(input.principalRole) ? 'allow' : 'forbidden';
}

/**
 * Global guard: role-based access on the server for every route (PRD 2.2).
 * A route with no @Roles and no @Public is blocked, so a forgotten decorator fails closed.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly resolver: PrincipalResolver,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    if (ctx.getType() !== 'http') return true; // WebSocket joins authenticate in the gateway
    const targets = [ctx.getHandler(), ctx.getClass()];
    const isPublic = this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, targets) ?? false;
    const roles = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, targets);
    const selfService =
      this.reflector.getAllAndOverride<boolean>(SELF_SERVICE_KEY, targets) ?? false;
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();

    if (isPublic) return true;
    if (!roles?.length) {
      throw new ForbiddenException({
        code: 'ROUTE_NOT_DECLARED',
        message: 'This route has no access rule, so it is blocked.',
      });
    }
    const principal = await this.resolver.resolve(req);
    const decision = decideAccess({
      isPublic,
      roles,
      method: req.method,
      selfService,
      principalRole: principal?.role ?? null,
    });
    if (decision === 'unauthenticated') {
      throw new UnauthorizedException({ code: 'AUTH_REQUIRED', message: 'Sign in again.' });
    }
    if (decision !== 'allow') {
      throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Your role cannot do this.' });
    }
    req.principal = principal!;
    return true;
  }
}

/** Global guard that applies @RateLimit buckets (ACC-09). Runs after AuthGuard. */
@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly limits: RateLimitService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    if (ctx.getType() !== 'http') return true;
    const meta = this.reflector.getAllAndOverride<{ bucket: string; by: RateLimitBy }>(
      RATE_LIMIT_KEY,
      [ctx.getHandler(), ctx.getClass()],
    );
    if (!meta) return true;
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    const p = req.principal;
    const id =
      meta.by === 'partner' && p?.kind === 'partner'
        ? `key:${p.keyId}`
        : meta.by === 'principal' && p && 'sessionId' in p
          ? `user:${p.userId}`
          : `ip:${clientIp(req) ?? 'unknown'}`;
    const r = await this.limits.hit(meta.bucket, id);
    const res = ctx.switchToHttp().getResponse<Response>();
    res.setHeader('RateLimit-Limit', String(r.limit));
    res.setHeader('RateLimit-Remaining', String(r.remaining));
    if (!r.allowed) {
      res.setHeader('Retry-After', String(r.retryAfterSeconds));
      throw new HttpException(
        {
          code: 'RATE_LIMITED',
          message: `Too many attempts. Try again in ${r.retryAfterSeconds} seconds.`,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    return true;
  }
}
