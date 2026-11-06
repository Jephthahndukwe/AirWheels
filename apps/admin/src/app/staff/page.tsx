import { redirect } from 'next/navigation';
import { ActionButton, ActionForm, Field, Select, Submit } from '@/components/form';
import { Badge, Card, Table, Td, lagosTime, statusTone } from '@/components/ui';
import { api, can, requireMe } from '@/lib/api';
import { inviteStaff, revokeStaffInvite, updateStaff } from '../actions';

export const dynamic = 'force-dynamic';

interface Staff {
  id: string;
  name: string;
  email: string;
  role: string;
  status: string;
  twoFactor: boolean;
  lockedUntil: string | null;
  lastLoginAt: string | null;
  lastLoginIp: string | null;
}
interface Invite {
  id: string;
  email: string;
  name: string;
  role: string;
  expiresAt: string;
}
interface LoginRow {
  id: string;
  identifier: string;
  success: boolean;
  reason: string | null;
  ip: string | null;
  userAgent: string | null;
  time: string;
}

const ROLES: [string, string][] = [
  ['OPS_AGENT', 'Ops agent'],
  ['SUPER_ADMIN', 'Super admin'],
  ['FINANCE', 'Finance (read-only)'],
];

export default async function StaffPage() {
  const me = await requireMe();
  if (!can.superAdmin(me)) redirect('/');
  const [{ staff, invites }, logins] = await Promise.all([
    api<{ staff: Staff[]; invites: Invite[] }>('/v1/admin/staff'),
    api<LoginRow[]>('/v1/admin/staff/logins'),
  ]);

  return (
    <div className="max-w-5xl">
      <h1 className="mb-6 text-2xl font-bold">Staff and roles</h1>

      <Card title="Invite staff">
        <ActionForm action={inviteStaff} className="grid grid-cols-4 items-end gap-3">
          <Field label="Name" name="name" required />
          <Field label="Email" name="email" type="email" required />
          <Select label="Role" name="role" options={ROLES} />
          <div>
            <Submit>Send invite</Submit>
          </div>
        </ActionForm>
      </Card>

      {invites.length > 0 && (
        <Card title="Pending invites">
          <Table head={['Name', 'Email', 'Role', 'Expires', '']}>
            {invites.map((i) => (
              <tr key={i.id}>
                <Td>{i.name}</Td>
                <Td>{i.email}</Td>
                <Td>{i.role}</Td>
                <Td>{lagosTime(i.expiresAt)}</Td>
                <Td>
                  <ActionButton action={revokeStaffInvite.bind(null, i.id)} label="Revoke" variant="danger" />
                </Td>
              </tr>
            ))}
          </Table>
        </Card>
      )}

      <Card title="Staff">
        <Table head={['Name', 'Role', 'Status', '2FA', 'Last sign-in', 'Actions']}>
          {staff.map((a) => (
            <tr key={a.id}>
              <Td>
                <p className="font-medium">{a.name}</p>
                <p className="text-xs text-slate">{a.email}</p>
              </Td>
              <Td>{a.role}</Td>
              <Td>
                <Badge tone={statusTone(a.status)}>{a.status.toLowerCase()}</Badge>
                {a.lockedUntil && new Date(a.lockedUntil) > new Date() && <Badge tone="bad">locked</Badge>}
              </Td>
              <Td>{a.twoFactor ? 'on' : 'off'}</Td>
              <Td>
                {lagosTime(a.lastLoginAt)}
                <p className="text-xs text-slate">{a.lastLoginIp}</p>
              </Td>
              <Td>
                {a.email !== me.email && (
                  <div className="flex flex-wrap gap-2">
                    {ROLES.filter(([r]) => r !== a.role).map(([r, l]) => (
                      <ActionButton key={r} action={updateStaff.bind(null, a.id, { role: r })} label={`Make ${l.split(' ')[0]!.toLowerCase()}`} />
                    ))}
                    <ActionButton
                      action={updateStaff.bind(null, a.id, { disabled: a.status === 'ACTIVE' })}
                      label={a.status === 'ACTIVE' ? 'Disable' : 'Enable'}
                      variant="danger"
                      confirm={a.status === 'ACTIVE' ? `Disable ${a.name}? They are signed out at once.` : undefined}
                    />
                    {a.lockedUntil && <ActionButton action={updateStaff.bind(null, a.id, { unlock: true })} label="Unlock" />}
                  </div>
                )}
              </Td>
            </tr>
          ))}
        </Table>
      </Card>

      <Card title="Sign-in history">
        <Table head={['When', 'Email', 'Result', 'IP', 'Device']}>
          {logins.map((l) => (
            <tr key={l.id}>
              <Td>{lagosTime(l.time)}</Td>
              <Td>{l.identifier}</Td>
              <Td>{l.success ? <Badge tone="good">signed in</Badge> : <Badge tone="bad">{l.reason ?? 'failed'}</Badge>}</Td>
              <Td mono>{l.ip}</Td>
              <Td>
                <span className="text-xs text-slate">{l.userAgent?.slice(0, 60)}</span>
              </Td>
            </tr>
          ))}
        </Table>
      </Card>
    </div>
  );
}
