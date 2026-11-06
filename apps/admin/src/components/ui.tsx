/** Small presentational helpers shared by admin pages (server components). */
export const lagosTime = (v: string | Date | null | undefined) =>
  v ? new Intl.DateTimeFormat('en-NG', { timeZone: 'Africa/Lagos', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(v)) : '—';

export function Card({ title, children, done }: { title: string; children: React.ReactNode; done?: boolean }) {
  return (
    <section className="mb-5 rounded-lg bg-white p-5 shadow-sm">
      <h2 className="mb-3 flex items-center gap-2 font-semibold">
        {done !== undefined && (
          <span className={`inline-block h-2.5 w-2.5 rounded-full ${done ? 'bg-green-600' : 'bg-coral'}`} aria-label={done ? 'done' : 'to do'} />
        )}
        {title}
      </h2>
      {children}
    </section>
  );
}

export function Badge({ children, tone = 'neutral' }: { children: React.ReactNode; tone?: 'neutral' | 'good' | 'bad' | 'warn' }) {
  const t = { neutral: 'bg-cloud text-slate', good: 'bg-green-100 text-green-800', bad: 'bg-coral/15 text-coral', warn: 'bg-amber-100 text-amber-800' }[tone];
  return <span className={`rounded px-2 py-0.5 text-xs font-medium ${t}`}>{children}</span>;
}

export function Table({ head, children, empty }: { head: string[]; children: React.ReactNode; empty?: string | false }) {
  return (
    <table className="w-full overflow-hidden rounded-lg bg-white text-left text-sm shadow-sm">
      <thead className="bg-cloud text-slate">
        <tr>
          {head.map((h) => (
            <th key={h} className="px-4 py-3 font-medium">
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {children}
        {empty && (
          <tr>
            <td colSpan={head.length} className="px-4 py-8 text-center text-slate">
              {empty}
            </td>
          </tr>
        )}
      </tbody>
    </table>
  );
}

export const Td = ({ children, mono }: { children: React.ReactNode; mono?: boolean }) => (
  <td className={`border-t border-border px-4 py-3 align-top ${mono ? 'font-mono text-xs' : ''}`}>{children}</td>
);

export const statusTone = (s: string): 'good' | 'bad' | 'warn' | 'neutral' =>
  s === 'ACTIVE' ? 'good' : s === 'SUSPENDED' || s === 'DISABLED' || s === 'REVOKED' ? 'bad' : s === 'INVITED' || s === 'ACTIVATED' ? 'warn' : 'neutral';
