import createClient from 'openapi-fetch';
import type { paths } from './generated/schema';

export type { paths, components } from './generated/schema';

/**
 * Typed API client generated from apps/api's OpenAPI spec.
 * Regenerate with `pnpm openapi` after changing API routes or DTOs.
 */
export const createApiClient = (baseUrl: string, headers?: Record<string, string>) =>
  createClient<paths>({ baseUrl, headers });

export type ApiClient = ReturnType<typeof createApiClient>;
