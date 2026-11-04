import type { Metadata } from 'next';
import { Plus_Jakarta_Sans } from 'next/font/google';
import Link from 'next/link';
import { NAV } from './nav';
import './globals.css';

const jakarta = Plus_Jakarta_Sans({ subsets: ['latin'], variable: '--font-jakarta', display: 'swap' });

export const metadata: Metadata = { title: 'Airwheels admin' };

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={jakarta.variable}>
      <body>
        <div className="flex min-h-screen">
          <aside className="w-60 shrink-0 bg-ink p-4 text-white">
            <p className="mb-6 text-lg font-bold">
              <span className="text-coral">Air</span>wheels <span className="text-xs font-normal opacity-60">ops</span>
            </p>
            <nav className="space-y-1 text-sm">
              {NAV.map((n) => (
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
          </aside>
          <main className="flex-1 p-8">{children}</main>
        </div>
      </body>
    </html>
  );
}
