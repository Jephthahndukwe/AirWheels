import { redirect } from 'next/navigation';
import { getMe } from '@/lib/api';
import { LoginForm } from './login-form';

export const dynamic = 'force-dynamic';

export default async function Login({ searchParams }: { searchParams: Promise<{ expired?: string }> }) {
  if (await getMe()) redirect('/');
  const { expired } = await searchParams;
  return (
    <div className="w-full max-w-sm rounded-lg bg-white p-8 shadow-sm">
      <p className="mb-1 text-2xl font-bold">
        <span className="text-coral">Air</span>wheels
      </p>
      <p className="mb-6 text-sm text-slate">Staff sign-in</p>
      {expired && <p className="mb-4 rounded bg-cloud p-2 text-sm">Your session ended. Sign in again.</p>}
      <LoginForm />
    </div>
  );
}
