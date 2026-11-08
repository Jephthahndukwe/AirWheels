'use server';

import { redirect } from 'next/navigation';
import { apiRaw, clearSession, setSession } from '@/lib/api';

export interface FormState {
  error?: string;
}

const messageOf = (data: unknown, fallback: string) => {
  const m = (data as { message?: string | string[] } | null)?.message;
  return Array.isArray(m) ? m.join(', ') : (m ?? fallback);
};

export async function signIn(_prev: FormState, form: FormData): Promise<FormState> {
  const r = await apiRaw('/v1/admin/auth/login', {
    method: 'POST',
    token: null,
    body: {
      email: String(form.get('email') ?? ''),
      password: String(form.get('password') ?? ''),
      totp: String(form.get('totp') ?? '').replace(/\s/g, ''),
    },
  });
  if (r.status !== 200) return { error: messageOf(r.data, 'Could not sign in.') };
  const d = r.data as { token: string; expiresAt: string };
  await setSession(d.token, d.expiresAt);
  redirect('/');
}

export async function acceptInvite(_prev: FormState, form: FormData): Promise<FormState> {
  const password = String(form.get('password') ?? '');
  if (password !== String(form.get('confirm') ?? ''))
    return { error: 'The two passwords do not match.' };
  const r = await apiRaw('/v1/admin/auth/invites/accept', {
    method: 'POST',
    token: null,
    body: {
      token: String(form.get('token') ?? ''),
      password,
      totp: String(form.get('totp') ?? '').replace(/\s/g, ''),
    },
  });
  if (r.status !== 200) return { error: messageOf(r.data, 'Could not finish setup.') };
  const d = r.data as { token: string; expiresAt: string };
  await setSession(d.token, d.expiresAt);
  redirect('/');
}

export async function signOut() {
  await apiRaw('/v1/admin/auth/logout', { method: 'POST' });
  await clearSession();
  redirect('/login');
}
