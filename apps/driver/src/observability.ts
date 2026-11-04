import * as Sentry from '@sentry/react-native';

/** Sentry only starts when EXPO_PUBLIC_SENTRY_DSN is set (crash-free target 99.5%, PRD 1.6). */
export function initObservability() {
  const dsn = process.env.EXPO_PUBLIC_SENTRY_DSN;
  if (!dsn) return;
  Sentry.init({ dsn, tracesSampleRate: 0.1 });
}

export const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:4000';
