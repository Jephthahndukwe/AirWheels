import { API_URL } from '@/lib/utils';

async function apiHealthy() {
  try {
    const r = await fetch(`${API_URL}/v1/health`, { cache: 'no-store' });
    return r.ok;
  } catch {
    return false;
  }
}

export default async function Overview() {
  const healthy = await apiHealthy();
  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold">Overview</h1>
      <div className="grid grid-cols-3 gap-4">
        {[
          ["Today's legs", '—'],
          ['Open alerts', '—'],
          ['Unassigned legs', '—'],
        ].map(([label, value]) => (
          <div key={label} className="rounded-lg bg-white p-5 shadow-sm">
            <p className="text-sm text-slate">{label}</p>
            <p className="text-3xl font-bold">{value}</p>
          </div>
        ))}
      </div>
      <p className="mt-6 text-sm">
        API status:{' '}
        <span className={healthy ? 'font-semibold text-green-700' : 'font-semibold text-coral'}>
          {healthy ? 'healthy' : 'unreachable'}
        </span>
      </p>
      <p className="mt-2 text-sm text-slate">
        Admin sign-in (email, password and TOTP) arrives in M1. Until then admin data is only served in local development.
      </p>
    </div>
  );
}
