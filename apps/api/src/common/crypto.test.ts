import { afterEach, describe, expect, it } from 'vitest';
import { decrypt, encrypt, isCurrent } from './crypto';

const A = 'a'.repeat(64);
const B = 'b'.repeat(64);
const saved = { ...process.env };
afterEach(() => {
  process.env = { ...saved };
});

describe('secret encryption', () => {
  it('round-trips with the key from the environment', () => {
    process.env.APP_ENCRYPTION_KEY = A;
    expect(decrypt(encrypt('s3cret'))).toBe('s3cret');
  });

  it('refuses to run without a key', () => {
    delete process.env.APP_ENCRYPTION_KEY;
    expect(() => encrypt('x')).toThrow(/APP_ENCRYPTION_KEY/);
  });

  it('rejects a malformed key', () => {
    process.env.APP_ENCRYPTION_KEY = 'short';
    expect(() => encrypt('x')).toThrow(/64 characters/);
  });

  it('during rotation, still decrypts values made with the previous key', () => {
    process.env.APP_ENCRYPTION_KEY = A;
    const old = encrypt('s3cret');
    process.env.APP_ENCRYPTION_KEY = B;
    process.env.APP_ENCRYPTION_KEY_PREVIOUS = A;
    expect(decrypt(old)).toBe('s3cret');
    expect(isCurrent(old)).toBe(false);
    expect(isCurrent(encrypt('s3cret'))).toBe(true);
  });

  it('fails once the previous key is removed', () => {
    process.env.APP_ENCRYPTION_KEY = A;
    const old = encrypt('s3cret');
    process.env.APP_ENCRYPTION_KEY = B;
    delete process.env.APP_ENCRYPTION_KEY_PREVIOUS;
    expect(() => decrypt(old)).toThrow();
  });
});
