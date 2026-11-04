import * as Sentry from '@sentry/nextjs';

/** Browser Sentry. Inactive without NEXT_PUBLIC_SENTRY_DSN. */
const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
if (dsn) Sentry.init({ dsn, tracesSampleRate: 0.1 });

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
