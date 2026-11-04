'use client';

import posthog from 'posthog-js';
import { useEffect } from 'react';

/** PostHog starts only when NEXT_PUBLIC_POSTHOG_KEY is set. */
export function Analytics() {
  useEffect(() => {
    const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
    if (!key) return;
    posthog.init(key, { api_host: process.env.NEXT_PUBLIC_POSTHOG_HOST, capture_pageview: true });
  }, []);
  return null;
}
