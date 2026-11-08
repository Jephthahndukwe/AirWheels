'use client';

import { useActionState } from 'react';
import { Field, Submit } from '@/components/form';
import { acceptInvite } from '../auth-actions';

export function AcceptForm({ token }: { token: string }) {
  const [state, action] = useActionState(acceptInvite, {});
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="token" value={token} />
      <Field
        label="Choose a password"
        name="password"
        type="password"
        autoComplete="new-password"
        minLength={12}
        required
        hint="At least 12 characters, with letters and numbers or symbols"
      />
      <Field
        label="Type it again"
        name="confirm"
        type="password"
        autoComplete="new-password"
        required
      />
      <Field
        label="Code from your authenticator app"
        name="totp"
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={7}
        required
      />
      {state.error && <p className="text-sm text-coral">{state.error}</p>}
      <Submit>Finish setup</Submit>
    </form>
  );
}
