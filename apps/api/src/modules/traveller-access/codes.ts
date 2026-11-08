import { createHmac } from 'node:crypto';
import { sha256 } from '../../common/crypto';

/**
 * The 4-digit pickup code (ACC-03) is derived from the leg id and the leg's code version with a
 * server key, so the tracking page can show it again while only a hash is stored on the leg.
 * Ops reissue a code by bumping the version: the old code stops working at once.
 */
export function pickupCodeFor(legId: string, version: number): string {
  // Its own key, so rotating APP_ENCRYPTION_KEY never changes codes travellers already have.
  const key = process.env.PICKUP_CODE_KEY;
  if (!key)
    throw new Error(
      'PICKUP_CODE_KEY is not set. Run `pnpm setup:env` locally, or set it in the secrets manager.',
    );
  const n =
    createHmac('sha256', key).update(`pickup:${legId}:v${version}`).digest().readUInt32BE(0) %
    10_000;
  return String(n).padStart(4, '0');
}

export const pickupCodeHash = (legId: string, version: number, code: string) =>
  sha256(`${legId}:v${version}:${code}`);

export type PickupCodeCheck =
  { result: 'OK' } | { result: 'WRONG'; attemptsLeft: number } | { result: 'LOCKED' };

/**
 * Pure attempt check. `failedAttempts` is the count before this guess. After `maxAttempts`
 * wrong guesses the leg locks and the driver must call support (DRV-07), who can reissue.
 */
export function checkPickupCode(input: {
  legId: string;
  version: number;
  storedHash: string;
  guess: string;
  failedAttempts: number;
  maxAttempts: number;
}): PickupCodeCheck {
  if (input.failedAttempts >= input.maxAttempts) return { result: 'LOCKED' };
  if (pickupCodeHash(input.legId, input.version, input.guess) === input.storedHash)
    return { result: 'OK' };
  const left = input.maxAttempts - input.failedAttempts - 1;
  return left <= 0 ? { result: 'LOCKED' } : { result: 'WRONG', attemptsLeft: left };
}
