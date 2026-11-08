/**
 * Browser Sentry. Inactive without NEXT_PUBLIC_SENTRY_DSN, and loaded on demand when it is set, so
 * traveller pages never ship the SDK in their first load (TRV-09: tracking page under 200 KB).
 */
type SentryModule = typeof import('@sentry/nextjs');
let sentry: SentryModule | null = null;

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
if (dsn)
  void import('@sentry/nextjs').then((S) => {
    S.init({ dsn, tracesSampleRate: 0.1 });
    sentry = S;
  });

export function onRouterTransitionStart(
  ...args: Parameters<SentryModule['captureRouterTransitionStart']>
) {
  sentry?.captureRouterTransitionStart(...args);
}
