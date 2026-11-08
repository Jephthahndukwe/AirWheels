import { notFound } from 'next/navigation';
import { API_URL } from '@/lib/utils';
import { ChangeFlow } from '../code-gate';

export const dynamic = 'force-dynamic';

export default async function ChangePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const res = await fetch(`${API_URL}/v1/t/${encodeURIComponent(token)}`, {
    cache: 'no-store',
  }).catch(() => null);
  if (!res || !res.ok) notFound();
  const v = (await res.json()) as {
    legs: {
      id: string;
      type: 'DEPARTURE' | 'ARRIVAL';
      scheduledAt: string | null;
      pickup: string;
      dropoff: string;
      status: string;
    }[];
  };
  const open = v.legs.filter((l) => !['CANCELLED', 'COMPLETED', 'NO_SHOW'].includes(l.status));
  return <ChangeFlow token={token} legs={open} />;
}
