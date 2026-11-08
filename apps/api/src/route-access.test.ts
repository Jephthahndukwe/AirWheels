import 'reflect-metadata';
import {
  type CallHandler,
  type INestApplication,
  type NestInterceptor,
  RequestMethod,
} from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA, VERSION_METADATA } from '@nestjs/common/constants';
import { DiscoveryService, MetadataScanner } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { of } from 'rxjs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ROLES, type AuthedRequest, type Principal, type Role } from './common/auth/roles';

/**
 * Every role against every endpoint (PRD 2.1, 2.2). Boots the real app with its real guards,
 * finds every route, and calls each one as each role. A stub stands in only for "who is calling"
 * and short-circuits allowed requests before the handler, so no database is needed.
 *
 * The expected access for each endpoint group is written out below from the PRD. A new route
 * that matches no group fails this test until someone decides who may call it.
 */
process.env.REDIS_URL = 'redis://127.0.0.1:1'; // no Redis needed; queues are never used here
process.env.JWT_SECRET ??= 'x'.repeat(64);
process.env.LOG_LEVEL = 'silent';
process.env.JOBS_ENABLED = 'false';

type Who = Role | 'ANONYMOUS';
const EVERYONE: Who[] = [...ROLES, 'ANONYMOUS'];
const STAFF: Role[] = ['OPS_AGENT', 'SUPER_ADMIN', 'FINANCE'];
const STAFF_WRITE: Role[] = ['OPS_AGENT', 'SUPER_ADMIN'];
const SUPER: Role[] = ['SUPER_ADMIN'];

interface Group {
  name: string;
  match: RegExp; // against "METHOD /v1/path"
  allowed: Who[] | 'PUBLIC';
}

/** First match wins. */
const POLICY: Group[] = [
  { name: 'health', match: /^GET \/v1\/health$/, allowed: 'PUBLIC' },
  { name: 'widget config', match: /^GET \/v1\/widget\//, allowed: 'PUBLIC' },
  { name: 'public quotes (our booking page)', match: /^POST \/v1\/quotes$/, allowed: 'PUBLIC' },
  { name: 'tracking page (token-scoped)', match: /^GET \/v1\/t\/:token$/, allowed: 'PUBLIC' },
  {
    name: 'tracking page actions (token, then six-digit code for change and cancel)',
    match: /^POST \/v1\/t\/:token\/(code|code\/verify|changes|cancel|rating|emergency|call)$/,
    allowed: 'PUBLIC',
  },
  {
    name: 'messaging and voice webhooks (signature or secret checked)',
    match: /^(GET|POST) \/v1\/webhooks\/(messaging|sms|voice)$/,
    allowed: 'PUBLIC',
  },
  {
    name: 'fake phone (development and tests only)',
    match: /^(GET|POST) \/v1\/dev\/phone\/(outbox|inbound)$/,
    allowed: 'PUBLIC',
  },
  { name: 'dev storage (signed URLs)', match: /^(GET|PUT) \/v1\/fake-storage$/, allowed: 'PUBLIC' },
  {
    name: 'address search (booking page)',
    match: /^GET \/v1\/places\/(search|reverse)$/,
    allowed: 'PUBLIC',
  },
  {
    name: 'our booking page: book, pay, status (pay token)',
    match: /^(POST \/v1\/bookings|POST \/v1\/bookings\/:id\/pay|GET \/v1\/bookings\/:id)$/,
    allowed: 'PUBLIC',
  },
  {
    name: 'Paystack webhook (signature checked)',
    match: /^POST \/v1\/webhooks\/payments$/,
    allowed: 'PUBLIC',
  },
  {
    name: 'fake checkout (development and tests only)',
    match: /^POST \/v1\/dev\/fake-paystack\/:reference\/complete$/,
    allowed: 'PUBLIC',
  },
  {
    name: 'admin sign-in doors',
    match:
      /^(POST \/v1\/admin\/auth\/login|GET \/v1\/admin\/auth\/invites\/:token|POST \/v1\/admin\/auth\/invites\/accept)$/,
    allowed: 'PUBLIC',
  },
  {
    name: 'admin own session',
    match: /^(GET|POST) \/v1\/admin\/auth\/(me|logins|logout)$/,
    allowed: STAFF,
  },
  {
    name: 'driver sign-in doors',
    match: /^POST \/v1\/driver\/(activate\/(start|verify|complete)|login|login\/verify)$/,
    allowed: 'PUBLIC',
  },
  { name: 'driver app', match: /^\w+ \/v1\/driver\//, allowed: ['DRIVER'] },
  { name: 'partner API', match: /^\w+ \/v1\/partner\//, allowed: ['PARTNER'] },
  { name: 'system jobs', match: /^\w+ \/v1\/system\//, allowed: ['SYSTEM'] },
  { name: 'staff and roles', match: /^\w+ \/v1\/admin\/staff/, allowed: SUPER },
  {
    name: 'airline keys (write)',
    match: /^(POST|PUT|PATCH|DELETE) \/v1\/admin\/airlines/,
    allowed: SUPER,
  },
  {
    name: 'config store (write)',
    match: /^(POST|PUT|PATCH|DELETE) \/v1\/admin\/config/,
    allowed: SUPER,
  },
  {
    name: 'message templates (write)',
    match: /^POST \/v1\/admin\/message-templates/,
    allowed: SUPER,
  },
  { name: 'pricing rules (write)', match: /^POST \/v1\/admin\/pricing\/rules/, allowed: SUPER },
  {
    name: 'driver reactivation',
    match: /^POST \/v1\/admin\/drivers\/:id\/reactivate$/,
    allowed: SUPER,
  },
  { name: 'admin reads', match: /^GET \/v1\/admin\//, allowed: STAFF },
  {
    name: 'admin operations (write)',
    match:
      /^(POST|PUT|PATCH|DELETE) \/v1\/admin\/(drivers|documents|vehicles|legs|alerts|bookings|payments|pricing\/simulate)/,
    allowed: STAFF_WRITE,
  },
];

const principalFor = (who: Who): Principal | null => {
  switch (who) {
    case 'ANONYMOUS':
      return null;
    case 'DRIVER':
      return {
        kind: 'driver',
        role: 'DRIVER',
        userId: 'u',
        driverId: 'd',
        sessionId: 's',
        phone: '+2348000000000',
      };
    case 'PARTNER':
      return {
        kind: 'partner',
        role: 'PARTNER',
        airline: { id: 'a', code: 'MOCK' } as never,
        keyId: 'k',
      };
    case 'SYSTEM':
      return { kind: 'system', role: 'SYSTEM' };
    default:
      return {
        kind: 'admin',
        role: who,
        userId: 'u',
        adminId: 'a',
        sessionId: 's',
        email: 'x@y.z',
        name: 'X',
      };
  }
};

/** Answers before the handler runs. Guards (auth, roles) have already run by now. */
class ShortCircuit implements NestInterceptor {
  intercept(_ctx: unknown, _next: CallHandler) {
    return of({ reached: true });
  }
}

interface Route {
  method: string;
  path: string;
}

let app: INestApplication;
let base = '';
let routes: Route[] = [];
const audited: string[] = [];

beforeAll(async () => {
  const { AppModule } = await import('./app.module');
  const { configureApp } = await import('./bootstrap');
  const { PrincipalResolver } = await import('./modules/auth/principal.resolver');
  const { RateLimitService } = await import('./modules/auth/rate-limit.service');
  const { MessagingProcessor } = await import('./modules/messaging/messaging.module');
  const { BookingsProcessor } = await import('./modules/bookings/bookings.module');
  const { PaymentsProcessor } = await import('./modules/payments/payments.module');
  const { AuditService } = await import('./modules/audit/audit.service');

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(PrincipalResolver)
    .useValue({
      resolve: async (req: AuthedRequest) =>
        principalFor((req.header('x-test-who') ?? 'ANONYMOUS') as Who),
    })
    .overrideProvider(RateLimitService)
    .useValue({
      hit: async () => ({ allowed: true, retryAfterSeconds: 0, limit: 1, remaining: 1 }),
    })
    // The audit safety net records every allowed admin write; capture instead of writing to a database.
    .overrideProvider(AuditService)
    .useValue({ record: async (e: { action: string }) => audited.push(e.action) })
    .overrideProvider(MessagingProcessor)
    .useValue({})
    .overrideProvider(BookingsProcessor)
    .useValue({})
    .overrideProvider(PaymentsProcessor)
    .useValue({})
    .compile();

  app = moduleRef.createNestApplication({ logger: false });
  configureApp(app);
  app.useGlobalInterceptors(new ShortCircuit());
  await app.listen(0);
  const addr = app.getHttpServer().address() as { port: number };
  base = `http://127.0.0.1:${addr.port}`;

  // Every route from every controller, as Nest maps it.
  const discovery = app.get(DiscoveryService);
  const scanner = app.get(MetadataScanner);
  for (const c of discovery.getControllers()) {
    const cls = c.metatype as (new (...a: unknown[]) => unknown) | undefined;
    if (!cls) continue;
    const ctrlPaths = ([] as string[]).concat(Reflect.getMetadata(PATH_METADATA, cls) ?? '');
    const version = Reflect.getMetadata(VERSION_METADATA, cls) ?? '1';
    for (const name of scanner.getAllMethodNames(cls.prototype)) {
      const fn = (cls.prototype as Record<string, unknown>)[name] as object;
      const method = Reflect.getMetadata(METHOD_METADATA, fn) as RequestMethod | undefined;
      if (method === undefined) continue;
      const sub = ([] as string[]).concat(Reflect.getMetadata(PATH_METADATA, fn) ?? '');
      for (const cp of ctrlPaths)
        for (const sp of sub) {
          const path = `/v${version}/${[cp, sp].filter((p) => p && p !== '/').join('/')}`
            .replace(/\/+/g, '/')
            .replace(/\/$/, '');
          routes.push({ method: RequestMethod[method], path });
        }
    }
  }
  routes = routes.sort((a, b) => `${a.path}${a.method}`.localeCompare(`${b.path}${b.method}`));
}, 180_000);

afterAll(async () => {
  await app?.close();
});

const concrete = (path: string) =>
  path.replace(/:[a-zA-Z]+/g, '3f2b6c1e-8d4a-4c2b-9e1f-0a1b2c3d4e5f');

describe('route access by role', () => {
  it('finds the routes', () => {
    expect(routes.length).toBeGreaterThan(40);
  });

  it('every route belongs to a policy group', () => {
    const unmatched = routes.filter(
      (r) => !POLICY.some((g) => g.match.test(`${r.method} ${r.path}`)),
    );
    expect(unmatched).toEqual([]);
  });

  it('every role gets exactly the access its group allows, on every route', async () => {
    const mismatches: string[] = [];
    let calls = 0;
    // All roles for one route in parallel; routes in turn.
    for (const r of routes) {
      const group = POLICY.find((g) => g.match.test(`${r.method} ${r.path}`))!;
      await Promise.all(
        EVERYONE.map(async (who) => {
          const res = await fetch(`${base}${concrete(r.path)}`, {
            method: r.method,
            headers: { 'x-test-who': who, 'content-type': 'application/json' },
            body: r.method === 'GET' || r.method === 'HEAD' ? undefined : '{}',
            signal: AbortSignal.timeout(15_000),
          });
          await res.arrayBuffer();
          calls++;
          const reached = res.status >= 200 && res.status < 300;
          const shouldReach = group.allowed === 'PUBLIC' || group.allowed.includes(who);
          if (reached !== shouldReach)
            mismatches.push(
              `${who} ${r.method} ${r.path} -> ${res.status} (group "${group.name}")`,
            );
          if (!reached && !shouldReach) {
            const expected = who === 'ANONYMOUS' ? 401 : 403;
            if (res.status !== expected)
              mismatches.push(
                `${who} ${r.method} ${r.path} -> ${res.status}, expected ${expected}`,
              );
          }
        }),
      );
    }
    expect(mismatches).toEqual([]);
    expect(calls).toBe(routes.length * EVERYONE.length);
    // Every allowed admin write went through the audit safety net (no service ran, so it recorded the call itself).
    const adminWrites = routes.filter(
      (r) =>
        r.method !== 'GET' &&
        r.path.startsWith('/v1/admin/') &&
        !/\/auth\/(login|invites)/.test(r.path),
    );
    expect(audited.length).toBeGreaterThanOrEqual(adminWrites.length);
  }, 300_000);

  it('finance can never write, even where a route lists it', async () => {
    const writes = routes.filter((r) => r.method !== 'GET');
    const reached: string[] = [];
    for (const r of writes) {
      const res = await fetch(`${base}${concrete(r.path)}`, {
        method: r.method,
        headers: { 'x-test-who': 'FINANCE', 'content-type': 'application/json' },
        body: '{}',
      });
      const isPublic =
        POLICY.find((g) => g.match.test(`${r.method} ${r.path}`))!.allowed === 'PUBLIC';
      if (res.status >= 200 && res.status < 300 && !isPublic && r.path !== '/v1/admin/auth/logout')
        reached.push(`${r.method} ${r.path}`);
    }
    expect(reached).toEqual([]);
  });
});
