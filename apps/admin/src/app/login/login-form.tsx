'use client';

import { useActionState } from 'react';
import { Field, Submit } from '@/components/form';
import { signIn } from '../auth-actions';

export function LoginForm() {
  const [state, action] = useActionState(signIn, {});
  return (
    <form action={action} className="space-y-4">
      <Field label="Email" name="email" type="email" autoComplete="username" required />
      <Field
        label="Password"
        name="password"
        type="password"
        autoComplete="current-password"
        required
      />
      <Field
        label="Authenticator code"
        name="totp"
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="[0-9 ]{6,7}"
        maxLength={7}
        required
        hint="Six digits from your authenticator app"
      />
      {state.error && <p className="text-sm text-coral">{state.error}</p>}
      <Submit>Sign in</Submit>
    </form>
  );
}
