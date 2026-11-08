'use client';

import { useEffect } from 'react';

/**
 * PostHog starts only when NEXT_PUBLIC_POSTHOG_KEY is set, and is loaded on demand so pages without
 * it (and the tracking page budget, TRV-09) never pay for the library.
 */
export function Analytics() {
  useEffect(() => {
    const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
    if (!key) return;
    void import('posthog-js').then(({ default: posthog }) =>
      posthog.init(key, { api_host: process.env.NEXT_PUBLIC_POSTHOG_HOST, capture_pageview: true }),
    );
  }, []);
  return null;
}
