import { z } from 'zod';

/** Money is always integer kobo (1 naira = 100 kobo). Never floats. */
export const Kobo = z.number().int().nonnegative();
export type Kobo = z.infer<typeof Kobo>;

export const nairaToKobo = (naira: number): Kobo => Math.round(naira * 100);

export const formatNaira = (kobo: Kobo): string =>
  new Intl.NumberFormat('en-NG', {
    style: 'currency',
    currency: 'NGN',
    maximumFractionDigits: 0,
  }).format(kobo / 100);
