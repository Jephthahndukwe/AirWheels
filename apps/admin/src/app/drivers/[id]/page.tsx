import Link from 'next/link';
import { ActionButton, ActionForm, Field, Select, Submit, ViewDocument } from '@/components/form';
import { Badge, Card, Table, Td, lagosTime, statusTone } from '@/components/ui';
import { api, can, requireMe } from '@/lib/api';
import {
  assignVehicle,
  reactivateDriver,
  revokeDriverInvite,
  runKyc,
  saveTraining,
  sendDriverInvite,
  suspendDriver,
  uploadDocument,
  viewDocument,
} from '../../actions';

export const dynamic = 'force-dynamic';

interface Driver {
  id: string;
  firstName: string;
  lastName: string;
  phone: string;
  status: string;
  onDuty: boolean;
  licenceNumber: string | null;
  idType: string | null;
  idNumber: string | null;
  address: string | null;
  referees: { name: string; phone: string; relationship: string }[] | null;
  kycResult: { passed?: boolean; reference?: string; checkedAt?: string } | null;
  trainingChecklist: Record<string, boolean> | null;
  deviceId: string | null;
  hasPin: boolean;
  suspendedReason: string | null;
  activatedAt: string | null;
  activeSessions: number;
  vehicle: { id: string; plate: string; brand: string; model: string; colour: string } | null;
  documents: { id: string; type: string; fileName: string | null; expiresAt: string | null; uploadedAt: string }[];
  invites: { id: string; expiresAt: string; usedAt: string | null; revokedAt: string | null; createdAt: string }[];
  checklist: {
    details: boolean;
    documents: { required: string[]; missing: string[] };
    kyc: boolean;
    vehicle: boolean;
    training: { items: string[]; missing: string[] };
    readyToInvite: boolean;
  };
}
interface Vehicle {
  id: string;
  plate: string;
  brand: string;
  model: string;
  class: string;
  active: boolean;
  assignments: { driver: { id: string; firstName: string } }[];
}

const TRAINING_LABEL: Record<string, string> = {
  airportRules: 'Airport pickup and drop-off rules',
  pickupCodes: 'Pickup codes and checking the traveller',
  customerCare: 'Customer care',
  safety: 'Safety and emergencies',
};

/** Onboarding wizard (ADM-01): details, documents, KYC, vehicle, training, invite. Then suspend or reactivate (ADM-02). */
export default async function DriverPage({ params }: { params: Promise<{ id: string }> }) {
  const me = await requireMe();
  const { id } = await params;
  const [d, vehicles] = await Promise.all([api<Driver>(`/v1/admin/drivers/${id}`), api<Vehicle[]>('/v1/admin/vehicles')]);
  const w = can.write(me);
  const c = d.checklist;
  const pendingInvite = d.invites.find((i) => !i.usedAt && !i.revokedAt && new Date(i.expiresAt) > new Date());

  return (
    <div className="max-w-4xl">
      <Link href="/drivers" className="text-sm text-slate underline">
        ← Drivers
      </Link>
      <h1 className="mb-1 mt-2 text-2xl font-bold">
        {d.firstName} {d.lastName}
      </h1>
      <p className="mb-6 flex items-center gap-2 text-sm text-slate">
        <span className="font-mono">{d.phone}</span>
        <Badge tone={statusTone(d.status)}>{d.status.toLowerCase()}</Badge>
        {d.onDuty && <Badge tone="good">on duty</Badge>}
        {d.activeSessions > 0 && <span>{d.activeSessions} active session</span>}
      </p>

      <Card title="1. Details" done={c.details}>
        <dl className="grid grid-cols-3 gap-3 text-sm">
          <div>
            <dt className="text-slate">Licence</dt>
            <dd>{d.licenceNumber}</dd>
          </div>
          <div>
            <dt className="text-slate">ID</dt>
            <dd>
              {d.idType} {d.idNumber}
            </dd>
          </div>
          <div>
            <dt className="text-slate">Address</dt>
            <dd>{d.address ?? '—'}</dd>
          </div>
          <div className="col-span-3">
            <dt className="text-slate">Referees</dt>
            <dd>{d.referees?.length ? d.referees.map((r) => `${r.name} (${r.relationship}, ${r.phone})`).join('; ') : '—'}</dd>
          </div>
        </dl>
      </Card>

      <Card title="2. Documents (private storage)" done={c.documents.missing.length === 0}>
        {c.documents.missing.length > 0 && <p className="mb-3 text-sm text-coral">Still needed: {c.documents.missing.join(', ')}</p>}
        {d.documents.length > 0 && (
          <ul className="mb-4 space-y-1 text-sm">
            {d.documents.map((doc) => (
              <li key={doc.id} className="flex items-center gap-3">
                <Badge>{doc.type}</Badge> {doc.fileName} <span className="text-slate">uploaded {lagosTime(doc.uploadedAt)}</span>
                {doc.expiresAt && <span className="text-slate">expires {lagosTime(doc.expiresAt)}</span>}
                {w && <ViewDocument action={viewDocument.bind(null, doc.id)} label="View" />}
              </li>
            ))}
          </ul>
        )}
        {w && (
          <ActionForm action={uploadDocument.bind(null, d.id)} className="grid grid-cols-4 items-end gap-3">
            <Select label="Type" name="type" options={['LICENCE', 'ID', 'PHOTO', 'REFEREE', 'INSURANCE', 'OTHER'].map((t) => [t, t.toLowerCase()])} />
            <Field label="File (PDF, JPEG or PNG, up to 10 MB)" name="file" type="file" accept="application/pdf,image/jpeg,image/png" required />
            <Field label="Expires (optional)" name="expiresAt" type="date" />
            <div>
              <Submit>Upload</Submit>
            </div>
          </ActionForm>
        )}
      </Card>

      <Card title="3. KYC check" done={c.kyc}>
        <p className="mb-3 text-sm">
          {d.kycResult ? (
            <>
              Last check: {d.kycResult.passed ? <Badge tone="good">passed</Badge> : <Badge tone="bad">failed</Badge>} reference{' '}
              <span className="font-mono">{d.kycResult.reference}</span>, {lagosTime(d.kycResult.checkedAt)}
            </>
          ) : (
            'Not checked yet.'
          )}
        </p>
        {w && <ActionButton action={runKyc.bind(null, d.id)} label={d.kycResult ? 'Run KYC again' : 'Run KYC check'} />}
      </Card>

      <Card title="4. Vehicle" done={c.vehicle}>
        <p className="mb-3 text-sm">{d.vehicle ? `${d.vehicle.plate}, ${d.vehicle.colour} ${d.vehicle.brand} ${d.vehicle.model}` : 'No vehicle assigned.'}</p>
        {w && (
          <ActionForm action={assignVehicle.bind(null, d.id)} className="flex items-end gap-3">
            <div className="w-96">
              <Select
                label="Assign a vehicle"
                name="vehicleId"
                options={vehicles
                  .filter((v) => v.active)
                  .map((v) => [v.id, `${v.plate} · ${v.brand} ${v.model} (${v.class.toLowerCase()})${v.assignments[0] && v.assignments[0].driver.id !== d.id ? ` · with ${v.assignments[0].driver.firstName}` : ''}`])}
              />
            </div>
            <Submit>Assign</Submit>
            <Link href="/vehicles" className="pb-2 text-sm underline">
              Add a vehicle
            </Link>
          </ActionForm>
        )}
      </Card>

      <Card title="5. Training checklist" done={c.training.missing.length === 0}>
        <ActionForm action={saveTraining.bind(null, d.id, c.training.items)} className="space-y-2">
          {c.training.items.map((item) => (
            <label key={item} className="flex items-center gap-2 text-sm">
              <input type="checkbox" name={item} defaultChecked={d.trainingChecklist?.[item] === true} disabled={!w} />
              {TRAINING_LABEL[item] ?? item}
            </label>
          ))}
          {w && <Submit variant="secondary">Save checklist</Submit>}
        </ActionForm>
      </Card>

      <Card title="6. Invite" done={['ACTIVATED', 'ACTIVE'].includes(d.status) || !!pendingInvite}>
        {d.status === 'ACTIVE' ? (
          <p className="text-sm">
            Activated {lagosTime(d.activatedAt)}. PIN set, bound to device <span className="font-mono text-xs">{d.deviceId}</span>.
          </p>
        ) : (
          <>
            <p className="mb-3 text-sm">
              {pendingInvite
                ? `Invite sent ${lagosTime(pendingInvite.createdAt)}, expires ${lagosTime(pendingInvite.expiresAt)}.`
                : c.readyToInvite
                  ? 'Ready. The driver gets an SMS with a six-digit code bound to their phone number.'
                  : 'Finish steps 1 to 5 first.'}
            </p>
            {w && d.status !== 'SUSPENDED' && (
              <div className="flex gap-3">
                {c.readyToInvite && <ActionButton action={sendDriverInvite.bind(null, d.id)} label={pendingInvite ? 'Resend invite' : 'Send invite'} variant="primary" />}
                {pendingInvite && <ActionButton action={revokeDriverInvite.bind(null, d.id)} label="Revoke invite" variant="danger" />}
              </div>
            )}
          </>
        )}
      </Card>

      {w && (
        <Card title={d.status === 'SUSPENDED' ? 'Suspended' : 'Suspend'}>
          {d.status === 'SUSPENDED' ? (
            <>
              <p className="mb-3 text-sm">Reason: {d.suspendedReason}</p>
              {can.superAdmin(me) ? (
                <ActionForm action={reactivateDriver.bind(null, d.id)} className="flex items-end gap-3">
                  <div className="w-96">
                    <Field label="Reason for reactivating" name="reason" required minLength={3} />
                  </div>
                  <Submit variant="secondary">Reactivate</Submit>
                </ActionForm>
              ) : (
                <p className="text-sm text-slate">Only a super admin can reactivate a driver.</p>
              )}
            </>
          ) : (
            <ActionForm action={suspendDriver.bind(null, d.id)} className="flex items-end gap-3" confirm="Suspend this driver? They are signed out of the app at once and cannot take jobs.">
              <div className="w-96">
                <Field label="Reason" name="reason" required minLength={3} />
              </div>
              <Submit variant="danger">Suspend driver</Submit>
            </ActionForm>
          )}
        </Card>
      )}

      <p className="text-sm">
        <Link href={`/audit?entityId=${d.id}`} className="underline">
          See this driver&apos;s audit trail
        </Link>
      </p>
      <Table head={['Invite sent', 'Expires', 'Result']} empty={d.invites.length === 0 && 'No invites yet.'}>
        {d.invites.map((i) => (
          <tr key={i.id}>
            <Td>{lagosTime(i.createdAt)}</Td>
            <Td>{lagosTime(i.expiresAt)}</Td>
            <Td>{i.usedAt ? `used ${lagosTime(i.usedAt)}` : i.revokedAt ? 'revoked' : new Date(i.expiresAt) < new Date() ? 'expired' : 'waiting'}</Td>
          </tr>
        ))}
      </Table>
    </div>
  );
}
