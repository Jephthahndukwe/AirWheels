import { MessagesCard } from './messages';
import { formatNaira } from '@airwheels/types';
import Link from 'next/link';
import { ActionButton, ActionForm, Field, Select, Submit } from '@/components/form';
import { Badge, Card, Table, Td, lagosTime } from '@/components/ui';
import { api, can, requireMe } from '@/lib/api';
import { cancelBooking, refundBooking, retryBooking } from '../../money-actions';

export const dynamic = 'force-dynamic';

interface Line {
  code: string;
  label: string;
  amountKobo: number;
}
interface Detail {
  id: string;
  airlineBookingReference: string;
  status: string;
  channel: string;
  collectedBy: string;
  plan: string;
  rideType: string;
  amountKobo: number;
  airlineShareKobo: number;
  passengers: number;
  bags: number;
  flaggedForOps: boolean;
  flagReason: string | null;
  createdAt: string;
  airline: { code: string; name: string } | null;
  traveller: { name: string; phone: string; whatsapp: boolean; email: string | null } | null;
  legs: {
    id: string;
    type: string;
    status: string;
    pickupText: string;
    dropoffText: string;
    pickupLandmark: string | null;
    dropoffLandmark: string | null;
    scheduledAt: string | null;
    vehicleClass: string;
    amountKobo: number;
    flight: { flightNumber: string; date: string } | null;
  }[];
  quoteSnapshot: {
    legs?: { lines: Line[]; cost?: { totalKobo: number }; marginKobo: number }[];
    marginKobo?: number;
    estimatedCostKobo?: number;
    flagReasons?: string[];
    rulesUsed?: unknown[];
  } | null;
  quote: { id: string; expiresAt: string; lockedAt: string | null } | null;
  events: { id: string; type: string; actorRole: string; reason: string | null; time: string }[];
  steps: {
    step: string;
    status: string;
    attempts: number;
    error: string | null;
    completedAt: string | null;
  }[];
  paymentIntents: {
    id: string;
    gatewayReference: string;
    amountKobo: number;
    status: string;
    gatewayFeeKobo: number | null;
    paidAt: string | null;
    authorizationUrl: string | null;
  }[];
  refunds: {
    id: string;
    amountKobo: number;
    route: string;
    status: string;
    reason: string;
    issuedByRole: string | null;
    createdAt: string;
  }[];
  ledger: {
    id: string;
    reference: string;
    kind: string;
    account: string;
    accountName: string;
    direction: string;
    amountKobo: number;
    time: string;
  }[];
}

const naira = (k: number) => (k < 0 ? `−${formatNaira(-k)}` : formatNaira(k));

/** Booking detail (ADM-05): timeline, quote, payments, refunds, ledger, steps and safe actions (BKG-08). */
export default async function BookingDetail({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ created?: string }>;
}) {
  const me = await requireMe();
  const { id } = await params;
  const { created } = await searchParams;
  const [b, refundable] = await Promise.all([
    api<Detail>(`/v1/admin/bookings/${id}`),
    api<{ paidKobo: number; refundedKobo: number; refundableKobo: number }>(
      `/v1/admin/bookings/${id}/refundable`,
    ),
  ]);
  const w = can.write(me);
  const payLink =
    b.status === 'PENDING_PAYMENT'
      ? b.paymentIntents.find((p) => p.status === 'PENDING')?.authorizationUrl
      : undefined;
  const debits = b.ledger
    .filter((l) => l.direction === 'DEBIT')
    .reduce((s, l) => s + l.amountKobo, 0);
  const credits = b.ledger
    .filter((l) => l.direction === 'CREDIT')
    .reduce((s, l) => s + l.amountKobo, 0);

  return (
    <div className="max-w-5xl">
      <Link href="/bookings" className="text-sm text-slate underline">
        ← Bookings
      </Link>
      <h1 className="mb-1 mt-2 font-mono text-2xl font-bold">{b.airlineBookingReference}</h1>
      <p className="mb-6 flex flex-wrap items-center gap-2 text-sm text-slate">
        <Badge
          tone={
            b.status === 'CONFIRMED'
              ? 'good'
              : b.status.includes('FAIL') || b.status === 'CANCELLED'
                ? 'bad'
                : 'warn'
          }
        >
          {b.status.toLowerCase().replace('_', ' ')}
        </Badge>
        {b.channel.toLowerCase().replace('_', ' ')} ·{' '}
        {b.collectedBy === 'AIRLINE' ? `collected by ${b.airline?.code}` : 'paid to Airwheels'} ·{' '}
        {b.rideType.toLowerCase()} · {b.plan.toLowerCase()} · {formatNaira(b.amountKobo)}
        {b.flaggedForOps && <Badge tone="bad">flagged: {b.flagReason}</Badge>}
      </p>
      {created && (
        <p className="mb-4 rounded bg-green-50 p-3 text-sm text-green-800">
          Booking created and waiting for payment.
        </p>
      )}
      {payLink && (
        <p className="mb-4 rounded bg-cloud p-3 text-sm">
          Payment link to send the traveller (price held until {lagosTime(b.quote?.expiresAt)}):{' '}
          <a href={payLink} className="break-all font-mono text-xs underline">
            {payLink}
          </a>
        </p>
      )}

      <Card title="Traveller and legs">
        <p className="mb-3 text-sm">
          {b.traveller?.name} · <span className="font-mono">{b.traveller?.phone}</span>{' '}
          {b.traveller?.whatsapp && '(WhatsApp)'} {b.traveller?.email} · {b.passengers} passenger
          {b.passengers > 1 ? 's' : ''}, {b.bags} bag{b.bags === 1 ? '' : 's'}
        </p>
        <Table head={['Leg', 'Flight', 'Pickup', 'Route', 'Vehicle', 'Price', 'Status']}>
          {b.legs.map((l) => (
            <tr key={l.id}>
              <Td>{l.type === 'DEPARTURE' ? 'To airport' : 'From airport'}</Td>
              <Td mono>{l.flight ? `${l.flight.flightNumber} ${l.flight.date}` : '—'}</Td>
              <Td>{lagosTime(l.scheduledAt)}</Td>
              <Td>
                {l.pickupText}
                {l.pickupLandmark && (
                  <span className="block text-xs text-slate">{l.pickupLandmark}</span>
                )}{' '}
                → {l.dropoffText}
              </Td>
              <Td>{l.vehicleClass.toLowerCase()}</Td>
              <Td>{formatNaira(l.amountKobo)}</Td>
              <Td>{l.status.toLowerCase().replace('_', ' ')}</Td>
            </tr>
          ))}
        </Table>
      </Card>

      {b.quoteSnapshot?.legs && (
        <Card title="Quote snapshot (frozen at booking)">
          <div className="grid grid-cols-2 gap-4 text-sm">
            {b.quoteSnapshot.legs.map((l, i) => (
              <dl key={i} className="space-y-0.5">
                <dt className="font-semibold">
                  {b.legs[i]?.type === 'ARRIVAL' ? 'From airport' : 'To airport'}
                </dt>
                {l.lines.map((x) => (
                  <div key={x.code} className="flex justify-between">
                    <span className="text-slate">{x.label}</span>
                    <span className="tabular-nums">{naira(x.amountKobo)}</span>
                  </div>
                ))}
                <div className="flex justify-between border-t border-border pt-1 text-xs text-slate">
                  <span>Estimated cost {naira(l.cost?.totalKobo ?? 0)}</span>
                  <span>Margin {naira(l.marginKobo)}</span>
                </div>
              </dl>
            ))}
          </div>
          <p className="mt-3 text-xs text-slate">
            Airline share {formatNaira(b.airlineShareKobo)} · total margin{' '}
            {naira(b.quoteSnapshot.marginKobo ?? 0)} · {b.quoteSnapshot.rulesUsed?.length ?? 0}{' '}
            pricing rule versions used
            {b.quote &&
              ` · quote held until ${lagosTime(b.quote.expiresAt)}, locked ${lagosTime(b.quote.lockedAt)}`}
          </p>
        </Card>
      )}

      <Card title="Payments and refunds">
        <Table
          head={['Reference', 'Amount', 'Fee', 'Status', 'Paid']}
          empty={
            b.paymentIntents.length === 0 &&
            (b.collectedBy === 'AIRLINE'
              ? 'Collected by the airline: settled on its statement.'
              : 'No payment started yet.')
          }
        >
          {b.paymentIntents.map((p) => (
            <tr key={p.id}>
              <Td mono>{p.gatewayReference}</Td>
              <Td>{formatNaira(p.amountKobo)}</Td>
              <Td>{p.gatewayFeeKobo !== null ? formatNaira(p.gatewayFeeKobo) : '—'}</Td>
              <Td>{p.status.toLowerCase()}</Td>
              <Td>{lagosTime(p.paidAt)}</Td>
            </tr>
          ))}
        </Table>
        {b.refunds.length > 0 && (
          <ul className="mt-3 space-y-1 text-sm">
            {b.refunds.map((r) => (
              <li key={r.id}>
                Refund {formatNaira(r.amountKobo)} via {r.route.toLowerCase()} ·{' '}
                {r.status.toLowerCase()} · {r.reason} · by{' '}
                {r.issuedByRole?.toLowerCase().replace('_', ' ')} {lagosTime(r.createdAt)}
              </li>
            ))}
          </ul>
        )}
        <p className="mt-3 text-sm text-slate">
          Paid {formatNaira(refundable.paidKobo)} · refunded {formatNaira(refundable.refundedKobo)}{' '}
          · can still refund {formatNaira(refundable.refundableKobo)}
        </p>
        {w && refundable.refundableKobo > 0 && (
          <ActionForm
            action={refundBooking.bind(null, b.id)}
            className="mt-3 grid grid-cols-4 items-end gap-3"
            confirm="Send this refund? It goes into the ledger at once."
          >
            <Field
              label="Amount (naira)"
              name="amount"
              inputMode="decimal"
              required
              placeholder={String(refundable.refundableKobo / 100)}
            />
            <div className="col-span-2">
              <Field label="Reason" name="reason" required minLength={3} />
            </div>
            <Select
              label="Leg"
              name="legId"
              options={[
                ['', 'Whole booking'],
                ...b.legs.map((l): [string, string] => [
                  l.id,
                  l.type === 'DEPARTURE' ? 'To airport' : 'From airport',
                ]),
              ]}
            />
            <div className="col-span-4">
              <Submit variant="danger">Refund</Submit>
              {me.role === 'OPS_AGENT' && (
                <span className="ml-3 text-xs text-slate">Larger refunds need a super admin.</span>
              )}
            </div>
          </ActionForm>
        )}
      </Card>

      <Card
        title={`Ledger (${b.ledger.length} lines, ${debits === credits ? 'balanced' : 'NOT BALANCED'})`}
      >
        <Table
          head={['When', 'Posting', 'Account', 'Debit', 'Credit']}
          empty={b.ledger.length === 0 && 'Nothing posted yet.'}
        >
          {b.ledger.map((l) => (
            <tr key={l.id}>
              <Td>{lagosTime(l.time)}</Td>
              <Td mono>{l.kind}</Td>
              <Td>{l.accountName}</Td>
              <Td>{l.direction === 'DEBIT' ? formatNaira(l.amountKobo) : ''}</Td>
              <Td>{l.direction === 'CREDIT' ? formatNaira(l.amountKobo) : ''}</Td>
            </tr>
          ))}
        </Table>
      </Card>

      <MessagesCard bookingId={b.id} legs={b.legs} canWrite={w} />

      <Card title="Timeline">
        <ul className="space-y-1 text-sm">
          {b.events.map((e) => (
            <li key={e.id}>
              <span className="text-slate">{lagosTime(e.time)}</span>{' '}
              <span className="font-mono">{e.type}</span> by {e.actorRole.toLowerCase()}{' '}
              {e.reason && `· ${e.reason}`}
            </li>
          ))}
        </ul>
        {b.steps.length > 0 && (
          <p className="mt-3 text-xs text-slate">
            Steps:{' '}
            {b.steps
              .map(
                (s) =>
                  `${s.step} ${s.status.toLowerCase()}${s.attempts > 1 ? ` (${s.attempts} tries)` : ''}${s.error ? `: ${s.error}` : ''}`,
              )
              .join(' · ')}
          </p>
        )}
      </Card>

      {w && (
        <Card title="Actions">
          <div className="flex flex-wrap items-end gap-4">
            {['CONFIRMED', 'IN_PROGRESS', 'COMPLETED'].includes(b.status) && (
              <ActionButton action={retryBooking.bind(null, b.id)} label="Retry unfinished steps" />
            )}
            {!['CANCELLED', 'REFUNDED', 'REJECTED', 'COMPLETED'].includes(b.status) && (
              <ActionForm
                action={cancelBooking.bind(null, b.id)}
                className="flex items-end gap-3"
                confirm="Cancel this booking and its legs?"
              >
                <div className="w-80">
                  <Field label="Cancel reason" name="reason" required minLength={3} />
                </div>
                <Submit variant="danger">Cancel booking</Submit>
              </ActionForm>
            )}
          </div>
        </Card>
      )}
      <p className="text-sm">
        <Link href={`/audit?entityId=${b.id}`} className="underline">
          Audit trail
        </Link>
      </p>
    </div>
  );
}
