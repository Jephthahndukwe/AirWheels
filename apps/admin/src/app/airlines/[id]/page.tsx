import Link from 'next/link';
import { ActionButton, ActionForm, Field, Submit } from '@/components/form';
import { Badge, Card, Table, Td, lagosTime, statusTone } from '@/components/ui';
import { api, can, requireMe } from '@/lib/api';
import {
  createCredential,
  revokeCredential,
  rotateCredential,
  updateCredentialIps,
} from '../../actions';

export const dynamic = 'force-dynamic';

interface Credential {
  id: string;
  keyId: string;
  status: string;
  allowedIps: string[];
  createdAt: string;
  rotatedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
}
interface Airline {
  id: string;
  name: string;
  code: string;
  serviceBrandName: string;
  status: string;
  credentials: Credential[];
}

/** API key pairs per airline (ACC-08). Super admins create, rotate and revoke; secrets are shown once. */
export default async function AirlinePage({ params }: { params: Promise<{ id: string }> }) {
  const me = await requireMe();
  const { id } = await params;
  const a = await api<Airline>(`/v1/admin/airlines/${id}`);
  const sa = can.superAdmin(me);
  const effective = (c: Credential) =>
    c.status !== 'ACTIVE'
      ? 'revoked'
      : c.expiresAt && new Date(c.expiresAt) < new Date()
        ? 'expired'
        : c.expiresAt
          ? 'rotating out'
          : 'active';

  return (
    <div className="max-w-5xl">
      <Link href="/airlines" className="text-sm text-slate underline">
        ← Airlines
      </Link>
      <h1 className="mb-1 mt-2 text-2xl font-bold">{a.name}</h1>
      <p className="mb-6 text-sm text-slate">
        {a.code} · {a.serviceBrandName} ·{' '}
        <Badge tone={statusTone(a.status)}>{a.status.toLowerCase()}</Badge>
      </p>

      {sa && (
        <Card title="Create an API key pair">
          <ActionForm action={createCredential.bind(null, a.id)} className="flex items-end gap-3">
            <div className="w-[28rem]">
              <Field
                label="Allowed IPs (optional)"
                name="allowedIps"
                placeholder="203.0.113.10, 198.51.100.0/24"
                hint="Leave empty to allow any IP. Addresses or CIDR ranges, separated by commas."
              />
            </div>
            <Submit>Create key</Submit>
          </ActionForm>
        </Card>
      )}

      <Card title="API keys">
        <Table
          head={['Key id', 'Status', 'Allowed IPs', 'Created', sa ? 'Actions' : '']}
          empty={a.credentials.length === 0 && 'No keys yet.'}
        >
          {a.credentials.map((c) => (
            <tr key={c.id}>
              <Td mono>{c.keyId}</Td>
              <Td>
                <Badge
                  tone={
                    effective(c) === 'active'
                      ? 'good'
                      : effective(c) === 'rotating out'
                        ? 'warn'
                        : 'bad'
                  }
                >
                  {effective(c)}
                </Badge>
                {c.expiresAt && c.status === 'ACTIVE' && (
                  <p className="mt-1 text-xs text-slate">until {lagosTime(c.expiresAt)}</p>
                )}
              </Td>
              <Td>
                {sa && c.status === 'ACTIVE' ? (
                  <ActionForm
                    action={updateCredentialIps.bind(null, a.id, c.id)}
                    className="flex gap-2"
                  >
                    <input
                      name="allowedIps"
                      defaultValue={c.allowedIps.join(', ')}
                      placeholder="any"
                      className="w-56 rounded-md border border-border px-2 py-1 font-mono text-xs"
                    />
                    <Submit variant="secondary">Save</Submit>
                  </ActionForm>
                ) : (
                  <span className="font-mono text-xs">{c.allowedIps.join(', ') || 'any'}</span>
                )}
              </Td>
              <Td>{lagosTime(c.createdAt)}</Td>
              <Td>
                {sa && c.status === 'ACTIVE' && (
                  <div className="flex gap-2">
                    {!c.expiresAt && (
                      <ActionButton
                        action={rotateCredential.bind(null, a.id, c.id)}
                        label="Rotate"
                        confirm="Create a new key? The old key keeps working for the grace period in Settings, then stops."
                      />
                    )}
                    <ActionButton
                      action={revokeCredential.bind(null, a.id, c.id)}
                      label="Revoke"
                      variant="danger"
                      confirm="Revoke this key now? The airline's calls signed with it fail at once."
                    />
                  </div>
                )}
              </Td>
            </tr>
          ))}
        </Table>
      </Card>
    </div>
  );
}
