import type { Metadata, Viewport } from 'next';
import { Plus_Jakarta_Sans } from 'next/font/google';
import { Analytics } from '@/components/analytics';
import './globals.css';

const jakarta = Plus_Jakarta_Sans({ subsets: ['latin'], variable: '--font-jakarta', display: 'swap' });

export const metadata: Metadata = {
  title: 'Airwheels — airport transfers',
  description: 'Door-to-door airport transfers that follow your flight.',
};

export const viewport: Viewport = { themeColor: '#FF4D3D', width: 'device-width', initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={jakarta.variable}>
      <body>
        <Analytics />
        <main className="mx-auto min-h-screen max-w-lg px-4 pt-6">{children}</main>
      </body>
    </html>
  );
}
