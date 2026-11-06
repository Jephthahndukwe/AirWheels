import { ActionButton } from '@/components/form';
import { Badge, Card, lagosTime } from '@/components/ui';
import { api, can, requireMe } from '@/lib/api';
import { API_URL } from '@/lib/utils';
import { resolveAlert } from './actions';

export const dynamic = 'force-dynamic';

interface Alert {
  id: string;
  type: string;
  message: string;
  legId: string | null;
  driverId: string | null;
  createdAt: string;
}

async function apiHealthy() {
  try {
    const r = await fetch(`${API_URL}/v1/health`, { cache: 'no-store' });
    return r.ok;
  } catch {
    return false;
  }
}

export default async function Overview() {
  const me = await requireMe();
  const [healthy, alerts] = await Promise.all([apiHealthy(), api<Alert[]>('/v1/admin/alerts?status=OPEN')]);
  return (
    <div className="max-w-5xl">
      <h1 className="mb-6 text-2xl font-bold">Overview</h1>
      <div className="mb-6 grid grid-cols-3 gap-4">
        {[
          ["Today's legs", '—'],
          ['Open alerts', String(alerts.length)],
          ['Unassigned legs', '—'],
        ].map(([label, value]) => (
          <div key={label} className="rounded-lg bg-white p-5 shadow-sm">
            <p className="text-sm text-slate">{label}</p>
            <p className="text-3xl font-bold">{value}</p>
          </div>
        ))}
      </div>

      <Card title="Open alerts">
        {alerts.length === 0 ? (
          <p className="text-sm text-slate">Nothing needs attention.</p>
        ) : (
          <ul className="divide-y divide-border">
            {alerts.map((a) => (
              <li key={a.id} className="flex items-start justify-between gap-4 py-3 text-sm">
                <div>
                  <Badge tone="bad">{a.type.replaceAll('_', ' ').toLowerCase()}</Badge> <span className="text-slate">{lagosTime(a.createdAt)}</span>
                  <p className="mt-1">{a.message}</p>
                  {a.legId && <p className="font-mono text-xs text-slate">leg {a.legId}</p>}
                </div>
                {can.write(me) && <ActionButton action={resolveAlert.bind(null, a.id)} label="Resolve" />}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <p className="text-sm">
        API status:{' '}
        <span className={healthy ? 'font-semibold text-green-700' : 'font-semibold text-coral'}>{healthy ? 'healthy' : 'unreachable'}</span>
      </p>
    </div>
  );
}
