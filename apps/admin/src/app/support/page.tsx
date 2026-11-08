import Link from 'next/link';
import { ActionButton } from '@/components/form';
import { Badge, Card, Table, Td, lagosTime } from '@/components/ui';
import { api, can, requireMe } from '@/lib/api';
import { resolveAlert } from '../traveller-actions';

export const dynamic = 'force-dynamic';

interface Alert {
  id: string;
  type: string;
  message: string;
  bookingId: string | null;
  createdAt: string;
}

const TRAVELLER_TYPES = [
  'EMERGENCY',
  'TRAVELLER_MESSAGE',
  'SUPPORT_REQUEST',
  'MESSAGE_UNDELIVERED',
  'FEE_TO_COLLECT',
  'LOW_RATING',
  'CALL_FAILED',
];

/** Travellers and support (PRD 17.1): emergencies first, then replies we could not understand (TRV-15). */
export default async function Support() {
  const me = await requireMe();
  const alerts = (await api<Alert[]>('/v1/admin/alerts?status=OPEN&limit=200')).filter((a) =>
    TRAVELLER_TYPES.includes(a.type),
  );
  alerts.sort((a, b) => Number(b.type === 'EMERGENCY') - Number(a.type === 'EMERGENCY'));
  return (
    <div className="max-w-6xl">
      <h1 className="mb-6 text-2xl font-bold">Travellers and support</h1>
      <Card title={`Open (${alerts.length})`}>
        <Table
          head={['When', 'Type', 'Message', 'Booking', '']}
          empty={alerts.length === 0 && 'Nothing waiting.'}
        >
          {alerts.map((a) => (
            <tr key={a.id}>
              <Td>{lagosTime(a.createdAt)}</Td>
              <Td>
                <Badge tone={a.type === 'EMERGENCY' ? 'bad' : 'warn'}>
                  {a.type.toLowerCase().replace(/_/g, ' ')}
                </Badge>
              </Td>
              <Td>{a.message}</Td>
              <Td>
                {a.bookingId && (
                  <Link href={`/bookings/${a.bookingId}`} className="underline">
                    Open
                  </Link>
                )}
              </Td>
              <Td>
                {can.write(me) && (
                  <ActionButton action={resolveAlert.bind(null, a.id)} label="Done" />
                )}
              </Td>
            </tr>
          ))}
        </Table>
      </Card>
    </div>
  );
}
