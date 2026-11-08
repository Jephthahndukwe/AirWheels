import { hash, verify } from '@node-rs/argon2';

/**
 * Passwords, PINs and one-time codes are hashed with argon2id (OWASP parameters: 19 MiB, t=2, p=1).
 * Short codes are also protected by attempt limits and expiry, never by the hash alone.
 */
const OPTIONS = { memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;

export const hashSecret = (plain: string): Promise<string> => hash(plain, OPTIONS);

export async function verifySecret(
  stored: string | null | undefined,
  plain: string,
): Promise<boolean> {
  if (!stored) {
    // Spend the same time when there is no account, so timing does not reveal which accounts exist.
    await hash(plain, OPTIONS);
    return false;
  }
  try {
    return await verify(stored, plain);
  } catch {
    return false;
  }
}

/** Admin password rule: at least 12 characters, more than one character class. */
export function passwordProblem(pw: string): string | null {
  if (pw.length < 12) return 'Use at least 12 characters.';
  if (pw.length > 200) return 'Use at most 200 characters.';
  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((r) => r.test(pw)).length;
  if (classes < 2) return 'Mix letters with numbers or symbols.';
  return null;
}

/** Driver PIN rule (ACC-06): six digits, not one repeated digit or a straight run. */
export function pinProblem(pin: string): string | null {
  if (!/^\d{6}$/.test(pin)) return 'The PIN must be exactly six digits.';
  if (/^(\d)\1{5}$/.test(pin)) return 'Do not repeat one digit.';
  if ('0123456789'.includes(pin) || '9876543210'.includes(pin))
    return 'Do not use a straight run of digits.';
  return null;
}
