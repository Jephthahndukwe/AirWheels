import Link from 'next/link';
import { Table, Td, lagosTime } from '@/components/ui';
import { api, requireMe } from '@/lib/api';

export const dynamic = 'force-dynamic';

interface Entry {
  id: string;
  time: string;
  actorLabel: string | null;
  actorRole: string;
  action: string;
  entity: string;
  entityId: string | null;
  before: unknown;
  after: unknown;
  ip: string | null;
}

const FILTERS = ['actor', 'action', 'entity', 'entityId', 'from', 'to'] as const;

/** Audit log viewer (ADM-14): who, what, before, after, when. */
export default async function Audit({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireMe();
  const sp = await searchParams;
  const qs = new URLSearchParams();
  for (const k of [...FILTERS, 'cursor'] as const) if (sp[k]) qs.set(k, sp[k]!);
  const r = await api<{ items: Entry[]; nextCursor: string | null; entities: string[] }>(`/v1/admin/audit?${qs.toString()}`);
  const next = new URLSearchParams(qs);
  if (r.nextCursor) next.set('cursor', r.nextCursor);

  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold">Audit log</h1>
      <form className="mb-4 grid grid-cols-6 items-end gap-2 text-sm">
        <label>
          <span className="block text-slate">Who</span>
          <input name="actor" defaultValue={sp.actor} placeholder="email or phone" className="w-full rounded-md border border-border bg-white px-2 py-1.5" />
        </label>
        <label>
          <span className="block text-slate">Action</span>
          <input name="action" defaultValue={sp.action} placeholder="e.g. driver.suspend" className="w-full rounded-md border border-border bg-white px-2 py-1.5" />
        </label>
        <label>
          <span className="block text-slate">Record type</span>
          <select name="entity" defaultValue={sp.entity ?? ''} className="w-full rounded-md border border-border bg-white px-2 py-1.5">
            <option value="">Any</option>
            {r.entities.map((e) => (
              <option key={e}>{e}</option>
            ))}
          </select>
        </label>
        <label>
          <span className="block text-slate">Record id</span>
          <input name="entityId" defaultValue={sp.entityId} className="w-full rounded-md border border-border bg-white px-2 py-1.5 font-mono text-xs" />
        </label>
        <label>
          <span className="block text-slate">From</span>
          <input name="from" type="date" defaultValue={sp.from} className="w-full rounded-md border border-border bg-white px-2 py-1.5" />
        </label>
        <div className="flex gap-2">
          <button className="rounded-md bg-ink px-4 py-1.5 text-white">Search</button>
          <Link href="/audit" className="px-2 py-1.5 underline">
            Clear
          </Link>
        </div>
      </form>

      <Table head={['When', 'Who', 'What', 'Record', 'Before', 'After']} empty={r.items.length === 0 && 'Nothing matches.'}>
        {r.items.map((e) => (
          <tr key={e.id}>
            <Td>
              {lagosTime(e.time)}
              <p className="font-mono text-[10px] text-slate">{e.ip}</p>
            </Td>
            <Td>{e.actorLabel ?? e.actorRole.toLowerCase()}</Td>
            <Td mono>{e.action}</Td>
            <Td>
              {e.entity}
              {e.entityId && (
                <Link href={`/audit?entityId=${e.entityId}`} className="block font-mono text-[10px] underline">
                  {e.entityId}
                </Link>
              )}
            </Td>
            <Td>
              <Json v={e.before} />
            </Td>
            <Td>
              <Json v={e.after} />
            </Td>
          </tr>
        ))}
      </Table>
      {r.nextCursor && (
        <Link href={`/audit?${next.toString()}`} className="mt-4 inline-block underline">
          Older entries →
        </Link>
      )}
    </div>
  );
}

function Json({ v }: { v: unknown }) {
  if (v === null || v === undefined) return <span className="text-slate">—</span>;
  return <pre className="max-w-xs overflow-x-auto whitespace-pre-wrap break-all font-mono text-[11px]">{JSON.stringify(v, null, 1)}</pre>;
}
