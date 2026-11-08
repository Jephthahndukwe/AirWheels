import { notFound } from 'next/navigation';
import { API_URL } from '@/lib/utils';
import { Phone } from './phone';

export const dynamic = 'force-dynamic';

/**
 * Development only (ACC-12): what the fake WhatsApp and SMS providers "delivered" to a number, with
 * tappable reply buttons that go through the real signed webhook. Not found outside development.
 */
export default async function DevPhone({
  searchParams,
}: {
  searchParams: Promise<{ to?: string }>;
}) {
  const { to } = await searchParams;
  const res = await fetch(
    `${API_URL}/v1/dev/phone/outbox${to ? `?to=${encodeURIComponent(to)}` : ''}`,
    { cache: 'no-store' },
  ).catch(() => null);
  if (!res?.ok) notFound();
  return <Phone to={to ?? ''} />;
}
