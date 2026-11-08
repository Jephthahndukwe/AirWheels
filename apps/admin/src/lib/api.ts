import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { cache } from 'react';
import { API_URL } from './utils';

/**
 * Server-side calls from the admin to the API. The session token lives in an httpOnly cookie that
 * browser code cannot read; the API makes every access decision (PRD 2.2: hiding a screen is
 * never the protection).
 */
export const SESSION_COOKIE = 'aw_admin_session';

export type AdminRole = 'OPS_AGENT' | 'SUPER_ADMIN' | 'FINANCE';
export interface Me {
  name: string;
  email: string;
  role: AdminRole;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

async function forwarded() {
  const h = await headers();
  const ip = h.get('x-forwarded-for')?.split(',')[0]?.trim() ?? h.get('x-real-ip') ?? undefined;
  return {
    ...(ip ? { 'x-forwarded-for': ip } : {}),
    'user-agent': h.get('user-agent') ?? 'airwheels-admin',
  };
}

/** Raw call. Returns status and parsed body; never throws on HTTP errors. */
export async function apiRaw(
  path: string,
  init: { method?: string; body?: unknown; token?: string | null } = {},
) {
  const jar = await cookies();
  const token = init.token === undefined ? jar.get(SESSION_COOKIE)?.value : init.token;
  const res = await fetch(`${API_URL}${path}`, {
    method: init.method ?? 'GET',
    cache: 'no-store',
    headers: {
      ...(await forwarded()),
      ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { status: res.status, data };
}

/** Authenticated call for pages and actions. A 401 sends the user to sign in again. */
export async function api<T>(
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<T> {
  const r = await apiRaw(path, init);
  if (r.status === 401) redirect('/login?expired=1');
  if (r.status >= 400) {
    const d = (r.data ?? {}) as { code?: string; message?: string | string[] };
    const message = Array.isArray(d.message)
      ? d.message.join(', ')
      : (d.message ?? `Request failed (${r.status})`);
    throw new ApiError(r.status, d.code ?? 'ERROR', message);
  }
  return r.data as T;
}

/** The signed-in admin, or null. Cached per request. */
export const getMe = cache(async (): Promise<Me | null> => {
  const jar = await cookies();
  if (!jar.get(SESSION_COOKIE)) return null;
  const r = await apiRaw('/v1/admin/auth/me');
  return r.status === 200 ? (r.data as Me) : null;
});

export async function requireMe(): Promise<Me> {
  const me = await getMe();
  if (!me) redirect('/login');
  return me;
}

export async function setSession(token: string, expiresAt: string) {
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'strict',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    expires: new Date(expiresAt),
  });
}

export async function clearSession() {
  (await cookies()).delete(SESSION_COOKIE);
}

export const can = {
  write: (me: Me) => me.role === 'OPS_AGENT' || me.role === 'SUPER_ADMIN',
  superAdmin: (me: Me) => me.role === 'SUPER_ADMIN',
};

/** Turns an action failure into a message on the same page. */
export function errorMessage(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  if (
    e &&
    typeof e === 'object' &&
    'digest' in e &&
    String((e as { digest: string }).digest).startsWith('NEXT_REDIRECT')
  )
    throw e;
  return 'Something went wrong. Try again.';
}
