import { ActionButton, ActionForm, Field, Select, Submit } from '@/components/form';
import { Badge, Card, Table, Td, lagosTime } from '@/components/ui';
import { api, can, requireMe } from '@/lib/api';
import { addPricingRule, endPricingRule } from '../money-actions';

export const dynamic = 'force-dynamic';

interface Rule {
  id: string;
  type: string;
  key: string;
  values: unknown;
  version: number;
  effectiveFrom: string;
  effectiveTo: string | null;
  inForce: boolean;
  scheduled: boolean;
}

/**
 * Pricing rules (PRC-06, ADM-11). Every change is a new version with its own start (and optional
 * end), so a quote can always be traced to the exact rules it used. Super admins edit; staff read.
 */
export default async function Pricing({ searchParams }: { searchParams: Promise<{ type?: string; all?: string }> }) {
  const me = await requireMe();
  const { type, all } = await searchParams;
  const { rules, types } = await api<{ rules: Rule[]; types: { type: string; help: string }[] }>(`/v1/admin/pricing/rules${type ? `?type=${type}` : ''}`);
  const shown = all ? rules : rules.filter((r) => r.inForce || r.scheduled);
  const edit = can.superAdmin(me);

  return (
    <div className="max-w-6xl">
      <h1 className="mb-2 text-2xl font-bold">Pricing</h1>
      <p className="mb-6 text-sm text-slate">Amounts are in kobo (₦1 = 100 kobo) and percentages in basis points (1% = 100). Seeded fares are placeholders (PRD 12.1).</p>

      {edit && (
        <Card title="Add a new version">
          <ActionForm action={addPricingRule} className="grid grid-cols-4 gap-3">
            <Select label="Rule type" name="type" options={types.map((t): [string, string] => [t.type, t.type.toLowerCase().replace('_', ' ')])} />
            <Field label="Key" name="key" required placeholder="e.g. LEKKI_PHASE_1, FLEX, airport" />
            <Field label="Starts (Lagos time, blank = now)" name="effectiveFrom" type="datetime-local" />
            <Field label="Ends (optional)" name="effectiveTo" type="datetime-local" />
            <label className="col-span-4 block text-sm">
              <span className="mb-1 block font-medium">Values (JSON)</span>
              <textarea name="values" required rows={3} className="w-full rounded-md border border-border p-2 font-mono text-xs" placeholder='{"multiplierBps": 11500}' />
            </label>
            <div className="col-span-4">
              <Submit>Save version</Submit>
            </div>
          </ActionForm>
          <details className="mt-4 text-xs text-slate">
            <summary className="cursor-pointer">What each rule type expects</summary>
            <ul className="mt-2 space-y-1">
              {types.map((t) => (
                <li key={t.type}>
                  <span className="font-mono font-semibold">{t.type}</span>: {t.help}
                </li>
              ))}
            </ul>
          </details>
        </Card>
      )}

      <form className="mb-3 flex items-center gap-3 text-sm">
        <select name="type" defaultValue={type ?? ''} className="rounded-md border border-border bg-white px-3 py-2">
          <option value="">All types</option>
          {types.map((t) => (
            <option key={t.type}>{t.type}</option>
          ))}
        </select>
        <label className="flex items-center gap-1">
          <input type="checkbox" name="all" value="1" defaultChecked={!!all} /> show ended and replaced versions
        </label>
        <button className="rounded-md bg-ink px-4 py-2 text-white">Show</button>
      </form>

      <Table head={['Type', 'Key', 'Values', 'Version', 'In force', edit ? '' : ' ']} empty={shown.length === 0 && 'No rules.'}>
        {shown.map((r) => (
          <tr key={r.id}>
            <Td mono>{r.type}</Td>
            <Td mono>{r.key}</Td>
            <Td>
              <pre className="max-w-md whitespace-pre-wrap break-all font-mono text-[11px]">{JSON.stringify(r.values)}</pre>
            </Td>
            <Td>v{r.version}</Td>
            <Td>
              {r.inForce ? <Badge tone="good">in force</Badge> : r.scheduled ? <Badge tone="warn">scheduled</Badge> : <Badge>not used</Badge>}
              <p className="mt-1 text-xs text-slate">
                from {lagosTime(r.effectiveFrom)}
                {r.effectiveTo && ` to ${lagosTime(r.effectiveTo)}`}
              </p>
            </Td>
            <Td>{edit && (r.inForce || r.scheduled) && !r.effectiveTo && <ActionButton action={endPricingRule.bind(null, r.id)} label="End now" variant="danger" confirm="End this rule now? Quotes from now on stop using it." />}</Td>
          </tr>
        ))}
      </Table>
    </div>
  );
}
