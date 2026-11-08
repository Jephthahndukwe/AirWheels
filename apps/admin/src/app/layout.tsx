import type { Metadata } from 'next';
import { Plus_Jakarta_Sans } from 'next/font/google';
import Link from 'next/link';
import { getMe } from '@/lib/api';
import { signOut } from './auth-actions';
import { NAV } from './nav';
import './globals.css';

const jakarta = Plus_Jakarta_Sans({
  subsets: ['latin'],
  variable: '--font-jakarta',
  display: 'swap',
});

export const metadata: Metadata = { title: 'Airwheels admin' };

const ROLE_LABEL = {
  OPS_AGENT: 'Ops agent',
  SUPER_ADMIN: 'Super admin',
  FINANCE: 'Finance (read-only)',
} as const;

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const me = await getMe();
  return (
    <html lang="en" className={jakarta.variable}>
      <body>
        {!me ? (
          <main className="flex min-h-screen items-center justify-center p-6">{children}</main>
        ) : (
          <div className="flex min-h-screen">
            <aside className="flex w-60 shrink-0 flex-col bg-ink p-4 text-white">
              <p className="mb-6 text-lg font-bold">
                <span className="text-coral">Air</span>wheels{' '}
                <span className="text-xs font-normal opacity-60">ops</span>
              </p>
              <nav className="flex-1 space-y-1 text-sm">
                {NAV.filter((n) => !n.roles || n.roles.includes(me.role)).map((n) => (
                  <Link
                    key={n.href}
                    href={n.href}
                    className="flex items-center justify-between rounded-md px-3 py-2 hover:bg-white/10"
                  >
                    {n.label}
                    {!n.ready && <span className="text-[10px] opacity-50">{n.milestone}</span>}
                  </Link>
                ))}
              </nav>
              <div className="mt-6 border-t border-white/15 pt-4 text-xs">
                <p className="font-semibold">{me.name}</p>
                <p className="opacity-70">{me.email}</p>
                <p className="opacity-70">{ROLE_LABEL[me.role]}</p>
                <form action={signOut} className="mt-3">
                  <button className="rounded-md bg-white/10 px-3 py-1.5 hover:bg-white/20">
                    Sign out
                  </button>
                </form>
              </div>
            </aside>
            <main className="flex-1 p-8">{children}</main>
          </div>
        )}
      </body>
    </html>
  );
}
