import Link from 'next/link';
import { Badge, Table, Td, statusTone } from '@/components/ui';
import { api, requireMe } from '@/lib/api';

export const dynamic = 'force-dynamic';

interface Airline {
  id: string;
  name: string;
  code: string;
  serviceBrandName: string;
  status: string;
  _count: { credentials: number };
}

export default async function Airlines() {
  await requireMe();
  const rows = await api<Airline[]>('/v1/admin/airlines');
  return (
    <div className="max-w-5xl">
      <h1 className="mb-6 text-2xl font-bold">Airlines</h1>
      <Table head={['Airline', 'Code', 'Service name', 'Status', 'Active API keys']} empty={rows.length === 0 && 'No airlines yet.'}>
        {rows.map((a) => (
          <tr key={a.id}>
            <Td>
              <Link href={`/airlines/${a.id}`} className="font-medium underline">
                {a.name}
              </Link>
            </Td>
            <Td mono>{a.code}</Td>
            <Td>{a.serviceBrandName}</Td>
            <Td>
              <Badge tone={statusTone(a.status)}>{a.status.toLowerCase()}</Badge>
            </Td>
            <Td>{a._count.credentials}</Td>
          </tr>
        ))}
      </Table>
      <p className="mt-4 text-sm text-slate">Branding, message templates, revenue share and settlement settings arrive with the airline integration (M5).</p>
    </div>
  );
}
