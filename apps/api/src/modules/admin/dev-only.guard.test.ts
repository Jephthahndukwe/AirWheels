import { ForbiddenException } from '@nestjs/common';
import { afterEach, describe, expect, it } from 'vitest';
import { DevOnlyGuard } from './dev-only.guard';

const original = process.env.NODE_ENV;
afterEach(() => {
  if (original === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = original;
});

const run = (value: string | undefined) => {
  if (value === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = value;
  return () => new DevOnlyGuard().canActivate();
};

describe('DevOnlyGuard', () => {
  it('allows admin endpoints only in development', () => {
    expect(run('development')()).toBe(true);
  });

  it.each(['staging', 'production', 'test', 'Development', ''])('blocks NODE_ENV=%j', (value) => {
    expect(run(value)).toThrow(ForbiddenException);
  });

  it('blocks when NODE_ENV is unset', () => {
    expect(run(undefined)).toThrow(ForbiddenException);
  });
});
