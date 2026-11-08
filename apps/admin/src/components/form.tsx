'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';

/** Shared form building blocks: server actions with inline errors and a pending state. */
export type ActionState = { error?: string; ok?: string };
type Action = (prev: ActionState, form: FormData) => Promise<ActionState>;

export function ActionForm({
  action,
  children,
  className,
  confirm,
}: {
  action: Action;
  children: React.ReactNode;
  className?: string;
  confirm?: string;
}) {
  const [state, formAction] = useActionState(action, {});
  return (
    <form
      action={formAction}
      className={className}
      onSubmit={(e) => {
        if (confirm && !window.confirm(confirm)) e.preventDefault();
      }}
    >
      {children}
      {state.error && <p className="mt-2 text-sm text-coral">{state.error}</p>}
      {state.ok && <p className="mt-2 whitespace-pre-wrap text-sm text-green-700">{state.ok}</p>}
    </form>
  );
}

export function Submit({
  children,
  variant = 'primary',
}: {
  children: React.ReactNode;
  variant?: 'primary' | 'secondary' | 'danger';
}) {
  const { pending } = useFormStatus();
  const styles = {
    primary: 'bg-coral text-white hover:opacity-90',
    secondary: 'bg-ink text-white hover:opacity-90',
    danger: 'border border-coral text-coral hover:bg-coral/10',
  }[variant];
  return (
    <button
      disabled={pending}
      className={`rounded-md px-4 py-2 text-sm font-semibold disabled:opacity-50 ${styles}`}
    >
      {pending ? 'Working…' : children}
    </button>
  );
}

export function Field({
  label,
  hint,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string }) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block font-medium">{label}</span>
      <input
        {...props}
        className="w-full rounded-md border border-border bg-white px-3 py-2 outline-none focus:border-ink"
      />
      {hint && <span className="mt-1 block text-xs text-slate">{hint}</span>}
    </label>
  );
}

export function Select({
  label,
  options,
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement> & { label: string; options: [string, string][] }) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block font-medium">{label}</span>
      <select {...props} className="w-full rounded-md border border-border bg-white px-3 py-2">
        {options.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
    </label>
  );
}

/** One-button action (no fields), e.g. revoke or run KYC. */
export function ActionButton({
  action,
  label,
  variant = 'secondary',
  confirm,
}: {
  action: () => Promise<ActionState>;
  label: string;
  variant?: 'primary' | 'secondary' | 'danger';
  confirm?: string;
}) {
  return (
    <ActionForm action={() => action()} confirm={confirm} className="inline-block">
      <Submit variant={variant}>{label}</Submit>
    </ActionForm>
  );
}

/** Opens a private document through a short-lived signed link (each view is audited). */
export function ViewDocument({ action, label }: { action: () => Promise<string>; label: string }) {
  return (
    <button
      type="button"
      className="text-sm font-medium text-ink underline"
      onClick={async () => {
        const url = await action();
        window.open(url, '_blank', 'noopener');
      }}
    >
      {label}
    </button>
  );
}
