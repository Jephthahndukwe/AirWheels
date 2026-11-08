import * as Sentry from '@sentry/node';
import { PostHog } from 'posthog-node';

/** Sentry only starts when SENTRY_DSN is set. */
export function initSentry(): void {
  if (!process.env.SENTRY_DSN) return;
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV ?? 'development',
    tracesSampleRate: 0.1,
  });
}

let posthog: PostHog | null | undefined;

/** Product analytics (PRD 22). No-op when POSTHOG_KEY is empty. */
export function track(
  event: string,
  distinctId: string,
  properties: Record<string, unknown> = {},
): void {
  if (posthog === undefined) {
    posthog = process.env.POSTHOG_KEY
      ? new PostHog(process.env.POSTHOG_KEY, { host: process.env.NEXT_PUBLIC_POSTHOG_HOST })
      : null;
  }
  posthog?.capture({ event, distinctId, properties });
}
