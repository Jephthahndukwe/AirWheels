import { ActionForm, Field, Select, Submit } from '@/components/form';
import { Badge, Card, Table, Td, lagosTime } from '@/components/ui';
import { api } from '@/lib/api';
import { assignDriver, correctLegStatus, sendMessage } from '../../traveller-actions';

interface Msg {
  id: string;
  template: string;
  channel: string;
  kind: string | null;
  status: string;
  preview: string | null;
  error: string | null;
  fallbackForId: string | null;
  sentAt: string | null;
  deliveredAt: string | null;
  readAt: string | null;
  time: string;
}
interface Reply {
  id: string;
  channel: string;
  buttonOrText: string;
  mappedIntent: string | null;
  time: string;
}
interface Call {
  id: string;
  fromRole: string;
  toRole: string;
  outcome: string;
  durationSeconds: number | null;
  time: string;
}
interface Driver {
  id: string;
  firstName: string;
  lastName: string;
  vehicle: string | null;
}

const EVENTS: [string, string][] = [
  ['booking.confirmed', 'Transfer confirmed'],
  ['pickup_time.set', 'Your pickup time'],
  ['pickup_time.changed', 'Pickup time changed (give a reason)'],
  ['driver.assigned', 'Driver assigned (night before)'],
  ['driver.en_route', 'Driver on the way'],
  ['driver.arrived', 'Driver outside'],
  ['trip.completed', 'Thank you'],
  ['arrival.confirmed', 'Arrival pickup confirmed'],
  ['arrival.driver_assigned', 'Your driver for arrival'],
  ['flight.landed', 'Welcome (landed)'],
  ['flight.changed', 'Change notice (give a reason)'],
  ['driver.replaced', 'New driver'],
  ['shared.confirmed', 'Shared ride confirmed'],
  ['shared.locked', 'Your shared ride'],
  ['shared.no_match', 'Your ride is now private'],
  ['shared.group_changed', 'Updated pickup time (group)'],
  ['pickup_code.reissued', 'Pickup code (resend)'],
];

const tone = (s: string) =>
  s === 'DELIVERED' || s === 'READ' ? 'good' : s === 'FAILED' ? 'bad' : 'warn';

/** Messages, delivery status, replies and calls on a booking (ADM-05, NTF-02, TRV-14), with ops actions. */
export async function MessagesCard({
  bookingId,
  legs,
  canWrite,
}: {
  bookingId: string;
  legs: { id: string; type: string; status: string }[];
  canWrite: boolean;
}) {
  const [m, drivers] = await Promise.all([
    api<{ notifications: Msg[]; replies: Reply[]; calls: Call[] }>(
      `/v1/admin/bookings/${bookingId}/messages`,
    ),
    canWrite ? api<Driver[]>('/v1/admin/drivers?status=ACTIVE') : Promise.resolve([] as Driver[]),
  ]);
  const legOptions: [string, string][] = legs.map((l) => [
    l.id,
    l.type === 'DEPARTURE' ? 'To airport' : 'From airport',
  ]);
  return (
    <>
      <Card title="Messages to the traveller">
        <Table
          head={['Sent', 'Message', 'Channel', 'Status', 'Text (codes hidden)']}
          empty={m.notifications.length === 0 && 'No messages yet.'}
        >
          {m.notifications.map((n) => (
            <tr key={n.id}>
              <Td>{lagosTime(n.sentAt ?? n.time)}</Td>
              <Td mono>{n.template}</Td>
              <Td>
                {n.channel.toLowerCase()}
                {n.kind && <span className="block text-xs text-slate">{n.kind.toLowerCase()}</span>}
                {n.fallbackForId && <span className="block text-xs text-slate">fallback</span>}
              </Td>
              <Td>
                <Badge tone={tone(n.status)}>{n.status.toLowerCase()}</Badge>
                {n.deliveredAt && (
                  <span className="block text-xs text-slate">{lagosTime(n.deliveredAt)}</span>
                )}
                {n.error && <span className="block max-w-48 text-xs text-red-700">{n.error}</span>}
              </Td>
              <Td>
                <span className="block max-w-md text-xs">{n.preview}</span>
              </Td>
            </tr>
          ))}
        </Table>
      </Card>

      <Card title="Traveller replies and calls">
        <Table
          head={['Time', 'Channel', 'Reply', 'Understood as']}
          empty={m.replies.length === 0 && 'No replies yet.'}
        >
          {m.replies.map((r) => (
            <tr key={r.id}>
              <Td>{lagosTime(r.time)}</Td>
              <Td>{r.channel.toLowerCase()}</Td>
              <Td>{r.buttonOrText}</Td>
              <Td>
                <Badge tone={r.mappedIntent === 'UNMATCHED' ? 'bad' : 'good'}>
                  {(r.mappedIntent ?? '').toLowerCase().replace(/_/g, ' ')}
                </Badge>
              </Td>
            </tr>
          ))}
        </Table>
        {m.calls.length > 0 && (
          <ul className="mt-3 space-y-1 text-sm">
            {m.calls.map((c) => (
              <li key={c.id}>
                {lagosTime(c.time)} · masked call {c.fromRole.toLowerCase()} →{' '}
                {c.toRole.toLowerCase()} · {c.outcome.toLowerCase()}
                {c.durationSeconds !== null && ` · ${c.durationSeconds}s`}
              </li>
            ))}
          </ul>
        )}
      </Card>

      {canWrite && (
        <Card title="Messages and legs (ops)">
          <div className="space-y-5">
            <ActionForm
              action={sendMessage.bind(null, bookingId)}
              className="grid grid-cols-4 items-end gap-3"
            >
              <Select label="Send message" name="event" options={EVENTS} />
              <Select label="Leg" name="legId" options={[['', 'Whole booking'], ...legOptions]} />
              <Field label="Reason (if the message has one)" name="reason" />
              <Submit variant="secondary">Send</Submit>
            </ActionForm>
            <ActionForm
              action={assignDriver.bind(null, bookingId)}
              className="grid grid-cols-4 items-end gap-3"
            >
              <Select label="Assign driver to leg" name="legId" options={legOptions} />
              <Select
                label="Active driver (with their car)"
                name="driverId"
                options={drivers.map((d): [string, string] => [
                  d.id,
                  `${d.firstName} ${d.lastName}${d.vehicle ? ` · ${d.vehicle}` : ' · no car'}`,
                ])}
              />
              <span />
              <Submit variant="secondary">Assign</Submit>
            </ActionForm>
            <ActionForm
              action={correctLegStatus.bind(null, bookingId)}
              className="grid grid-cols-4 items-end gap-3"
            >
              <Select label="Correct leg step" name="legId" options={legOptions} />
              <Select
                label="New step"
                name="status"
                options={[
                  ['DRIVER_CONFIRMED', 'Driver confirmed'],
                  ['EN_ROUTE', 'On the way'],
                  ['ARRIVED', 'Arrived'],
                  ['PICKED_UP', 'Picked up'],
                  ['COMPLETED', 'Completed'],
                ]}
              />
              <Field label="Reason" name="reason" required minLength={3} />
              <Submit variant="secondary">Update</Submit>
            </ActionForm>
          </div>
        </Card>
      )}
    </>
  );
}
