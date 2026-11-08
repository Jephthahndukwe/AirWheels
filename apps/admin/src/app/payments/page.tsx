import { formatNaira } from '@airwheels/types';
import Link from 'next/link';
import { ActionForm, Field, Submit } from '@/components/form';
import { Badge, Card, Table, Td, lagosTime } from '@/components/ui';
import { api, can, requireMe } from '@/lib/api';
import { reconcileNow } from '../money-actions';

export const dynamic = 'force-dynamic';

interface Intent {
  id: string;
  gatewayReference: string;
  amountKobo: number;
  status: string;
  gatewayFeeKobo: number | null;
  paidAt: string | null;
  createdAt: string;
  booking: { id: string; airlineBookingReference: string; status: string };
}
interface Run {
  id: string;
  day: string;
  trigger: string;
  checked: number;
  settled: number;
  failed: number;
  mismatches: { kind: string; reference: string; detail: string }[];
  finishedAt: string | null;
}
interface Account {
  code: string;
  name: string;
  type: string;
  balanceKobo: number;
}

/** Payments, reconciliation and the ledger (PRD 17.1, PAY-03, PAY-06). Finance reads everything here. */
export default async function Payments() {
  const me = await requireMe();
  const [p, ledger] = await Promise.all([
    api<{ gateway: string; intents: Intent[]; reconciliation: Run[] }>('/v1/admin/payments'),
    api<{
      accounts: Account[];
      trialBalance: { debitsKobo: number; creditsKobo: number; balanced: boolean };
    }>('/v1/admin/ledger/balances'),
  ]);
  return (
    <div className="max-w-6xl">
      <h1 className="mb-2 text-2xl font-bold">Payments</h1>
      <p className="mb-6 text-sm text-slate">
        Gateway:{' '}
        <Badge tone={p.gateway === 'live' ? 'good' : 'warn'}>
          {p.gateway === 'live' ? 'Paystack' : 'fake (local only)'}
        </Badge>
      </p>

      <Card
        title={`Ledger: ${ledger.trialBalance.balanced ? 'balanced' : 'NOT BALANCED'} (debits ${formatNaira(ledger.trialBalance.debitsKobo)}, credits ${formatNaira(ledger.trialBalance.creditsKobo)})`}
        done={ledger.trialBalance.balanced}
      >
        <Table head={['Account', 'Type', 'Balance']}>
          {ledger.accounts.map((a) => (
            <tr key={a.code}>
              <Td>
                {a.name}
                <span className="block font-mono text-[10px] text-slate">{a.code}</span>
              </Td>
              <Td>{a.type.toLowerCase()}</Td>
              <Td>{formatNaira(a.balanceKobo)}</Td>
            </tr>
          ))}
        </Table>
      </Card>

      <Card title="Reconciliation with Paystack">
        {can.write(me) && (
          <ActionForm action={reconcileNow} className="mb-4 flex items-end gap-3">
            <div className="w-56">
              <Field label="Day (blank = yesterday)" name="day" type="date" />
            </div>
            <Submit variant="secondary">Reconcile now</Submit>
          </ActionForm>
        )}
        <Table
          head={['Day', 'Run by', 'Checked', 'Settled', 'Failed', 'Mismatches']}
          empty={p.reconciliation.length === 0 && 'Runs daily at the hour set in Settings.'}
        >
          {p.reconciliation.map((r) => (
            <tr key={r.id}>
              <Td>{r.day}</Td>
              <Td>
                {r.trigger}{' '}
                <span className="block text-xs text-slate">{lagosTime(r.finishedAt)}</span>
              </Td>
              <Td>{r.checked}</Td>
              <Td>{r.settled}</Td>
              <Td>{r.failed}</Td>
              <Td>
                {r.mismatches.length === 0 ? (
                  <Badge tone="good">none</Badge>
                ) : (
                  <ul className="text-xs">
                    {r.mismatches.map((m, i) => (
                      <li key={i}>
                        <Badge tone="bad">{m.kind.toLowerCase().replaceAll('_', ' ')}</Badge>{' '}
                        <span className="font-mono">{m.reference}</span> {m.detail}
                      </li>
                    ))}
                  </ul>
                )}
              </Td>
            </tr>
          ))}
        </Table>
      </Card>

      <Card title="Recent payments">
        <Table
          head={['Reference', 'Booking', 'Amount', 'Fee', 'Status', 'Started', 'Paid']}
          empty={p.intents.length === 0 && 'No payments yet.'}
        >
          {p.intents.map((i) => (
            <tr key={i.id}>
              <Td mono>{i.gatewayReference}</Td>
              <Td mono>
                <Link href={`/bookings/${i.booking.id}`} className="underline">
                  {i.booking.airlineBookingReference}
                </Link>
              </Td>
              <Td>{formatNaira(i.amountKobo)}</Td>
              <Td>{i.gatewayFeeKobo !== null ? formatNaira(i.gatewayFeeKobo) : '—'}</Td>
              <Td>
                <Badge
                  tone={i.status === 'SUCCEEDED' ? 'good' : i.status === 'PENDING' ? 'warn' : 'bad'}
                >
                  {i.status.toLowerCase()}
                </Badge>
              </Td>
              <Td>{lagosTime(i.createdAt)}</Td>
              <Td>{lagosTime(i.paidAt)}</Td>
            </tr>
          ))}
        </Table>
      </Card>
    </div>
  );
}
