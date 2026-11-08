import { NotFoundException } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { bindings, chooseAdapter } from '../adapters/adapters.module';
import { PAYMENTS, SMS } from '../adapters/interfaces';
import { FakeStorageController } from '../modules/media/media.module';
import { fakeProvidersAllowedEnv, isDevelopment, isDevelopmentEnv } from './env';

/**
 * ACC-12: development shortcuts work only when the environment is explicitly development, and
 * are blocked everywhere else: staging, production, an unset NODE_ENV, or any spelling mistake.
 */
const BLOCKED = [
  'staging',
  'production',
  undefined,
  '',
  'Development',
  'dev',
  'prod',
  'DEVELOPMENT ',
];

const original = process.env.NODE_ENV;
afterEach(() => {
  if (original === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = original;
  vi.restoreAllMocks();
});
const setEnv = (v: string | undefined) => {
  if (v === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = v;
};

describe('ACC-12: development shortcuts', { timeout: 120_000 }, () => {
  it('codes on screen (invite links, invite codes, SMS codes) only in development', () => {
    expect(isDevelopmentEnv('development')).toBe(true);
    for (const env of [...BLOCKED, 'test']) expect(isDevelopmentEnv(env)).toBe(false);
  });

  it.each(BLOCKED)('the API returns no codes when NODE_ENV=%j', async (env) => {
    setEnv(env);
    // The three places that can put a code in a response read the same switch.
    const { isDevelopment: viaAdminAuth } = await import('../modules/auth/admin-auth.service');
    expect(viaAdminAuth()).toBe(false);
    expect(isDevelopment()).toBe(false);
  });

  it('fake providers are allowed in development and in the test runner only', () => {
    expect(fakeProvidersAllowedEnv('development')).toBe(true);
    expect(fakeProvidersAllowedEnv('test')).toBe(true);
    for (const env of BLOCKED) expect(fakeProvidersAllowedEnv(env)).toBe(false);
  });

  it.each(BLOCKED)('the API refuses to start with a fake provider when NODE_ENV=%j', (env) => {
    for (const b of bindings) {
      expect(() => chooseAdapter(b, { NODE_ENV: env })).toThrow(/Fake providers are only allowed/);
    }
  });

  it('a live adapter with its keys is used in any environment; without keys outside development it fails', () => {
    const payments = bindings.find((b) => b.token === PAYMENTS)!;
    class Live {}
    const live = new Map([[PAYMENTS, Live as new () => object]]);
    expect(
      chooseAdapter(
        payments,
        { NODE_ENV: 'production', ADAPTERS_MODE: 'live', PAYSTACK_SECRET_KEY: 'sk_test_x' },
        live,
      ).kind,
    ).toBe('live');
    expect(() =>
      chooseAdapter(payments, { NODE_ENV: 'production', ADAPTERS_MODE: 'live' }, live),
    ).toThrow();
    // A provider with no live adapter built yet cannot run outside development.
    const sms = bindings.find((b) => b.token === SMS)!;
    expect(() =>
      chooseAdapter(sms, { NODE_ENV: 'staging', ADAPTERS_MODE: 'live', TERMII_API_KEY: 'x' }, live),
    ).toThrow();
    expect(chooseAdapter(sms, { NODE_ENV: 'development' }, live).kind).toBe('fake');
  });

  it.each(BLOCKED)(
    'local file storage and the fake checkout are switched off when NODE_ENV=%j',
    async (env) => {
      setEnv(env);
      const storage = new FakeStorageController();
      expect(() => storage.get({ op: 'get', key: 'x', exp: '0', sig: 'x' })).toThrow(
        NotFoundException,
      );
      const { FakePaystackController } = await import('../modules/payments/payments.module');
      const { FakePayments } = await import('../adapters/fakes');
      const ctrl = new FakePaystackController({} as never, new FakePayments());
      await expect(ctrl.complete('AW-X', { outcome: 'success' })).rejects.toBeInstanceOf(
        NotFoundException,
      );
    },
  );
});
