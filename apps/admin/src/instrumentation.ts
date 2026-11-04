import * as Sentry from '@sentry/nextjs';

/** Sentry for server and edge runtimes. Inactive without SENTRY_DSN. */
export async function register() {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return;
  Sentry.init({ dsn, tracesSampleRate: 0.1, environment: process.env.NODE_ENV });
}

export const onRequestError = Sentry.captureRequestError;
