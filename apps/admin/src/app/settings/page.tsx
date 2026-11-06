import Link from 'next/link';
import { ActionForm, Submit } from '@/components/form';
import { Table, Td, lagosTime } from '@/components/ui';
import { api, can, requireMe } from '@/lib/api';
import { saveConfig } from '../actions';

export const dynamic = 'force-dynamic';

interface Entry {
  key: string;
  value: unknown;
  version: number;
  description: string | null;
  updatedAt: string;
}

/** Config store (buffers, cut-offs, limits). Everyone on staff can read; only super admins edit. Every change is a new version. */
export default async function Settings() {
  const me = await requireMe();
  const rows = await api<Entry[]>('/v1/admin/config');
  const edit = can.superAdmin(me);
  return (
    <div className="max-w-6xl">
      <h1 className="mb-2 text-2xl font-bold">Settings</h1>
      <p className="mb-6 text-sm text-slate">
        {edit ? 'Values are JSON and must keep the same shape. Each save is a new version and goes in the ' : 'Only super admins can change these. Changes are in the '}
        <Link href="/audit?entity=ConfigEntry" className="underline">
          audit log
        </Link>
        .
      </p>
      <Table head={['Setting', 'Value', 'Version']}>
        {rows.map((r) => (
          <tr key={r.key}>
            <Td>
              <p className="font-mono text-xs font-semibold">{r.key}</p>
              <p className="mt-1 text-xs text-slate">{r.description}</p>
            </Td>
            <Td>
              {edit ? (
                <ActionForm action={saveConfig.bind(null, r.key)} className="flex items-start gap-2">
                  <textarea
                    name="value"
                    defaultValue={JSON.stringify(r.value, null, typeof r.value === 'object' ? 2 : 0)}
                    rows={typeof r.value === 'object' && r.value !== null ? Math.min(12, JSON.stringify(r.value, null, 2).split('\n').length) : 1}
                    className="w-[28rem] rounded-md border border-border p-2 font-mono text-xs"
                  />
                  <Submit variant="secondary">Save</Submit>
                </ActionForm>
              ) : (
                <pre className="font-mono text-xs">{JSON.stringify(r.value, null, 1)}</pre>
              )}
            </Td>
            <Td>
              v{r.version}
              <p className="text-xs text-slate">{lagosTime(r.updatedAt)}</p>
            </Td>
          </tr>
        ))}
      </Table>
    </div>
  );
}
