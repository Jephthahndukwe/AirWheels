import Link from 'next/link';
import { ActionForm, Field, Select, Submit } from '@/components/form';
import { Badge, Card, Table, Td, lagosTime, statusTone } from '@/components/ui';
import { api, can, requireMe } from '@/lib/api';
import { createDriver } from '../actions';

export const dynamic = 'force-dynamic';

interface Row {
  id: string;
  firstName: string;
  lastName: string;
  phone: string;
  status: string;
  onDuty: boolean;
  kycPassed: boolean;
  vehicle: string | null;
  createdAt: string;
}

export default async function Drivers({ searchParams }: { searchParams: Promise<{ q?: string; status?: string }> }) {
  const me = await requireMe();
  const { q, status } = await searchParams;
  const qs = new URLSearchParams({ ...(q ? { q } : {}), ...(status ? { status } : {}) });
  const rows = await api<Row[]>(`/v1/admin/drivers?${qs.toString()}`);

  return (
    <div className="max-w-6xl">
      <h1 className="mb-6 text-2xl font-bold">Drivers</h1>

      {can.write(me) && (
        <Card title="New driver (step 1 of onboarding)">
          <ActionForm action={createDriver} className="grid grid-cols-3 gap-3">
            <Field label="First name" name="firstName" required />
            <Field label="Last name" name="lastName" required />
            <Field label="Mobile number" name="phone" placeholder="0801 234 5678" required hint="The invite is bound to this number" />
            <Field label="Driver's licence number" name="licenceNumber" required />
            <Select label="ID for KYC" name="idType" options={[['NIN', 'NIN'], ['DRIVERS_LICENSE', "Driver's licence"]]} />
            <Field label="ID number" name="idNumber" required />
            <div className="col-span-3">
              <Field label="Home address" name="address" />
            </div>
            {[1, 2].map((i) => (
              <div key={i} className="col-span-3 grid grid-cols-3 gap-3">
                <Field label={`Referee ${i} name`} name={`ref${i}Name`} />
                <Field label={`Referee ${i} phone`} name={`ref${i}Phone`} />
                <Field label={`Referee ${i} relationship`} name={`ref${i}Rel`} />
              </div>
            ))}
            <div className="col-span-3">
              <Submit>Create driver and continue</Submit>
            </div>
          </ActionForm>
        </Card>
      )}

      <form className="mb-4 flex gap-3">
        <input name="q" defaultValue={q} placeholder="Search name or phone" className="w-72 rounded-md border border-border bg-white px-3 py-2 text-sm" />
        <select name="status" defaultValue={status ?? ''} className="rounded-md border border-border bg-white px-3 py-2 text-sm">
          <option value="">All statuses</option>
          {['ONBOARDING', 'INVITED', 'ACTIVATED', 'ACTIVE', 'SUSPENDED'].map((s) => (
            <option key={s} value={s}>
              {s.toLowerCase()}
            </option>
          ))}
        </select>
        <button className="rounded-md bg-ink px-4 py-2 text-sm text-white">Filter</button>
      </form>

      <Table head={['Driver', 'Phone', 'Status', 'KYC', 'Vehicle', 'Added']} empty={rows.length === 0 && 'No drivers yet.'}>
        {rows.map((d) => (
          <tr key={d.id}>
            <Td>
              <Link href={`/drivers/${d.id}`} className="font-medium underline">
                {d.firstName} {d.lastName}
              </Link>
            </Td>
            <Td mono>{d.phone}</Td>
            <Td>
              <Badge tone={statusTone(d.status)}>{d.status.toLowerCase()}</Badge> {d.onDuty && <Badge tone="good">on duty</Badge>}
            </Td>
            <Td>{d.kycPassed ? 'passed' : '—'}</Td>
            <Td mono>{d.vehicle ?? '—'}</Td>
            <Td>{lagosTime(d.createdAt)}</Td>
          </tr>
        ))}
      </Table>
    </div>
  );
}
