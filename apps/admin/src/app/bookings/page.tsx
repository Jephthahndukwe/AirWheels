import { formatNaira } from '@airwheels/types';
import { api, requireMe } from '@/lib/api';

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
  traveller: { name: string } | null;
  legs: { type: string; status: string }[];
};

export const dynamic = 'force-dynamic';

export default async function Bookings() {
  await requireMe();
  let rows: Row[] = [];
  let error: string | null = null;
  try {
    rows = await api<Row[]>('/v1/admin/bookings');
  } catch (e) {
    if (e && typeof e === 'object' && 'digest' in e) throw e;
    error = (e as Error).message;
  }

  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold">Bookings</h1>
      {error && <p className="mb-4 text-coral">Could not load bookings: {error}</p>}
      <table className="w-full overflow-hidden rounded-lg bg-white text-left text-sm shadow-sm">
        <thead className="bg-cloud text-slate">
          <tr>
            {['Reference', 'Airline', 'Traveller', 'Legs', 'Amount', 'Status', 'Created'].map((h) => (
              <th key={h} className="px-4 py-3 font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((b) => (
            <tr key={b.id} className="border-t border-border">
              <td className="px-4 py-3 font-mono">{b.airlineBookingReference}</td>
              <td className="px-4 py-3">{b.airline?.code ?? 'Own'}</td>
              <td className="px-4 py-3">{b.traveller?.name}</td>
              <td className="px-4 py-3">{b.legs.map((l) => l.type.toLowerCase()).join(', ')}</td>
              <td className="px-4 py-3">{formatNaira(b.amountKobo)}</td>
              <td className="px-4 py-3">
                {b.status.toLowerCase()}
                {b.flaggedForOps && <span className="ml-2 rounded-sm bg-coral/15 px-1.5 text-xs text-coral">{b.flagReason}</span>}
              </td>
              <td className="px-4 py-3 text-slate">
                {new Intl.DateTimeFormat('en-NG', { timeZone: 'Africa/Lagos', dateStyle: 'medium', timeStyle: 'short' }).format(
                  new Date(b.createdAt),
                )}
              </td>
            </tr>
          ))}
          {rows.length === 0 && !error && (
            <tr>
              <td colSpan={7} className="px-4 py-8 text-center text-slate">
                No bookings yet. Send one with <code>pnpm mock:booking</code>.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
