import { formatNaira } from '@airwheels/types';
import Link from 'next/link';
import { Badge, Card, Table, Td, lagosTime } from '@/components/ui';
import { api, can, requireMe } from '@/lib/api';

type Row = {
  id: string;
  airlineBookingReference: string;
  status: string;
  channel: string;
  amountKobo: number;
  flaggedForOps: boolean;
  flagReason: string | null;
  createdAt: string;
  airline: { code: string } | null;
  traveller: { name: string; phone: string } | null;
  legs: { type: string; status: string }[];
};
type Stuck = { id: string; reference: string; status: string; traveller?: string; since: string; failedSteps: { step: string; error: string | null }[] };

export const dynamic = 'force-dynamic';

const tone = (s: string) => (['CONFIRMED', 'COMPLETED'].includes(s) ? 'good' : ['PAYMENT_FAILED', 'REJECTED', 'CANCELLED'].includes(s) ? 'bad' : ['PENDING_PAYMENT', 'REFUNDING', 'CANCELLING'].includes(s) ? 'warn' : 'neutral');

/** Bookings: search by reference, phone or name, and the stuck-booking view (ADM-05, ADM-06). */
export default async function Bookings({ searchParams }: { searchParams: Promise<{ q?: string; status?: string }> }) {
  const me = await requireMe();
  const { q, status } = await searchParams;
  const qs = new URLSearchParams({ ...(q ? { q } : {}), ...(status ? { status } : {}) });
  const [rows, stuck] = await Promise.all([api<Row[]>(`/v1/admin/bookings?${qs.toString()}`), api<Stuck[]>('/v1/admin/bookings/stuck')]);

  return (
    <div className="max-w-6xl">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold">Bookings</h1>
        {can.write(me) && (
          <Link href="/bookings/new" className="rounded-md bg-coral px-4 py-2 text-sm font-semibold text-white">
            New phone or WhatsApp booking
          </Link>
        )}
      </div>

      {stuck.length > 0 && (
        <Card title={`Stuck bookings (${stuck.length})`}>
          <ul className="divide-y divide-border text-sm">
            {stuck.map((s) => (
              <li key={s.id} className="flex items-center justify-between py-2">
                <span>
                  <Link href={`/bookings/${s.id}`} className="font-mono underline">
                    {s.reference}
                  </Link>{' '}
                  {s.traveller} · <Badge tone="warn">{s.status.toLowerCase().replace('_', ' ')}</Badge> since {lagosTime(s.since)}
                  {s.failedSteps.map((f) => (
                    <span key={f.step} className="ml-2 text-xs text-coral">
                      {f.step} failed: {f.error}
                    </span>
                  ))}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <form className="mb-4 flex gap-3">
        <input name="q" defaultValue={q} placeholder="Reference, phone or name" className="w-72 rounded-md border border-border bg-white px-3 py-2 text-sm" />
        <select name="status" defaultValue={status ?? ''} className="rounded-md border border-border bg-white px-3 py-2 text-sm">
          <option value="">All statuses</option>
          {['PENDING_PAYMENT', 'CONFIRMED', 'PAYMENT_FAILED', 'CANCELLED', 'REFUNDING', 'REFUNDED', 'COMPLETED'].map((s) => (
            <option key={s} value={s}>
              {s.toLowerCase().replace('_', ' ')}
            </option>
          ))}
        </select>
        <button className="rounded-md bg-ink px-4 py-2 text-sm text-white">Search</button>
      </form>

      <Table head={['Reference', 'Channel', 'Traveller', 'Legs', 'Amount', 'Status', 'Created']} empty={rows.length === 0 && 'No bookings match.'}>
        {rows.map((b) => (
          <tr key={b.id}>
            <Td mono>
              <Link href={`/bookings/${b.id}`} className="underline">
                {b.airlineBookingReference}
              </Link>
            </Td>
            <Td>
              {b.channel.toLowerCase().replace('_', ' ')}
              {b.airline && <span className="text-slate"> · {b.airline.code}</span>}
            </Td>
            <Td>{b.traveller?.name}</Td>
            <Td>{b.legs.map((l) => (l.type === 'DEPARTURE' ? 'to airport' : 'from airport')).join(', ')}</Td>
            <Td>{formatNaira(b.amountKobo)}</Td>
            <Td>
              <Badge tone={tone(b.status)}>{b.status.toLowerCase().replace('_', ' ')}</Badge>
              {b.flaggedForOps && <span className="ml-1 text-xs text-coral">{b.flagReason}</span>}
            </Td>
            <Td>{lagosTime(b.createdAt)}</Td>
          </tr>
        ))}
      </Table>
    </div>
  );
}
