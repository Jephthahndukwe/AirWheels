'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import type { ActionState } from '@/components/form';
import { ApiError, api, errorMessage } from '@/lib/api';

const s = (f: FormData, k: string) => String(f.get(k) ?? '').trim();
const opt = (f: FormData, k: string) => s(f, k) || undefined;

async function run(path: string | null, fn: () => Promise<string | void>): Promise<ActionState> {
  try {
    const ok = await fn();
    if (path) revalidatePath(path);
    return { ok: ok || 'Saved.' };
  } catch (e) {
    return { error: errorMessage(e) };
  }
}

// ---------- staff ----------

export async function inviteStaff(_p: ActionState, f: FormData): Promise<ActionState> {
  return run('/staff', async () => {
    const r = await api<{ email: string; devLink?: string }>('/v1/admin/staff/invites', {
      method: 'POST',
      body: { email: s(f, 'email'), name: s(f, 'name'), role: s(f, 'role') },
    });
    return `Invite sent to ${r.email}.${r.devLink ? `\nDevelopment only, invite link: ${r.devLink}` : ''}`;
  });
}

export async function revokeStaffInvite(id: string): Promise<ActionState> {
  return run('/staff', async () => {
    await api(`/v1/admin/staff/invites/${id}/revoke`, { method: 'POST' });
    return 'Invite revoked.';
  });
}

export async function updateStaff(
  id: string,
  body: { role?: string; disabled?: boolean; unlock?: boolean },
): Promise<ActionState> {
  return run('/staff', async () => {
    await api(`/v1/admin/staff/${id}`, { method: 'PATCH', body });
  });
}

// ---------- drivers ----------

export async function createDriver(_p: ActionState, f: FormData): Promise<ActionState> {
  let id: string;
  try {
    const referees = [1, 2]
      .map((i) => ({
        name: s(f, `ref${i}Name`),
        phone: s(f, `ref${i}Phone`),
        relationship: s(f, `ref${i}Rel`),
      }))
      .filter((r) => r.name);
    const d = await api<{ id: string }>('/v1/admin/drivers', {
      method: 'POST',
      body: {
        firstName: s(f, 'firstName'),
        lastName: s(f, 'lastName'),
        phone: s(f, 'phone'),
        licenceNumber: s(f, 'licenceNumber'),
        idType: s(f, 'idType'),
        idNumber: s(f, 'idNumber'),
        address: opt(f, 'address'),
        referees,
      },
    });
    id = d.id;
  } catch (e) {
    return { error: errorMessage(e) };
  }
  redirect(`/drivers/${id}`);
}

export async function uploadDocument(
  driverId: string,
  _p: ActionState,
  f: FormData,
): Promise<ActionState> {
  return run(`/drivers/${driverId}`, async () => {
    const file = f.get('file');
    if (!(file instanceof File) || file.size === 0)
      throw new ApiError(400, 'NO_FILE', 'Choose a file.');
    const req = await api<{ documentId: string; uploadUrl: string; maxBytes: number }>(
      `/v1/admin/drivers/${driverId}/documents`,
      {
        method: 'POST',
        body: {
          type: s(f, 'type'),
          fileName: file.name,
          contentType: file.type,
          expiresAt: opt(f, 'expiresAt'),
        },
      },
    );
    if (file.size > req.maxBytes)
      throw new ApiError(400, 'FILE_TOO_LARGE', 'Files must be 10 MB or smaller.');
    const put = await fetch(req.uploadUrl, {
      method: 'PUT',
      headers: { 'content-type': file.type },
      body: Buffer.from(await file.arrayBuffer()),
    });
    if (!put.ok)
      throw new ApiError(put.status, 'UPLOAD_FAILED', 'Upload to storage failed. Try again.');
    await api(`/v1/admin/documents/${req.documentId}/confirm`, { method: 'POST' });
    return `${s(f, 'type')} uploaded.`;
  });
}

export async function viewDocument(id: string): Promise<string> {
  const r = await api<{ url: string }>(`/v1/admin/documents/${id}/view`, { method: 'POST' });
  return r.url;
}

export async function runKyc(driverId: string): Promise<ActionState> {
  return run(`/drivers/${driverId}`, async () => {
    const r = await api<{ passed: boolean; reference: string }>(
      `/v1/admin/drivers/${driverId}/kyc`,
      { method: 'POST' },
    );
    if (!r.passed)
      throw new ApiError(400, 'KYC_FAILED', `KYC did not pass (reference ${r.reference}).`);
    return `KYC passed (reference ${r.reference}).`;
  });
}

export async function assignVehicle(
  driverId: string,
  _p: ActionState,
  f: FormData,
): Promise<ActionState> {
  return run(`/drivers/${driverId}`, async () => {
    await api(`/v1/admin/drivers/${driverId}/vehicle`, {
      method: 'PUT',
      body: { vehicleId: s(f, 'vehicleId') },
    });
    return 'Vehicle assigned.';
  });
}

export async function saveTraining(
  driverId: string,
  items: string[],
  _p: ActionState,
  f: FormData,
): Promise<ActionState> {
  return run(`/drivers/${driverId}`, async () => {
    await api(`/v1/admin/drivers/${driverId}/training`, {
      method: 'PUT',
      body: { items: Object.fromEntries(items.map((i) => [i, f.get(i) === 'on'])) },
    });
    return 'Training checklist saved.';
  });
}

export async function sendDriverInvite(driverId: string): Promise<ActionState> {
  return run(`/drivers/${driverId}`, async () => {
    const r = await api<{ expiresAt: string; devCode?: string }>(
      `/v1/admin/drivers/${driverId}/invite`,
      { method: 'POST' },
    );
    return `Invite sent by SMS. It expires ${new Date(r.expiresAt).toLocaleString('en-NG', { timeZone: 'Africa/Lagos' })}.${r.devCode ? `\nDevelopment only, invite code: ${r.devCode}` : ''}`;
  });
}

export async function revokeDriverInvite(driverId: string): Promise<ActionState> {
  return run(`/drivers/${driverId}`, async () => {
    await api(`/v1/admin/drivers/${driverId}/invite/revoke`, { method: 'POST' });
    return 'Invite revoked.';
  });
}

export async function suspendDriver(
  driverId: string,
  _p: ActionState,
  f: FormData,
): Promise<ActionState> {
  return run(`/drivers/${driverId}`, async () => {
    const r = await api<{ sessionsEnded: number }>(`/v1/admin/drivers/${driverId}/suspend`, {
      method: 'POST',
      body: { reason: s(f, 'reason') },
    });
    return `Driver suspended. ${r.sessionsEnded} session(s) signed out.`;
  });
}

export async function reactivateDriver(
  driverId: string,
  _p: ActionState,
  f: FormData,
): Promise<ActionState> {
  return run(`/drivers/${driverId}`, async () => {
    const r = await api<{ status: string }>(`/v1/admin/drivers/${driverId}/reactivate`, {
      method: 'POST',
      body: { reason: s(f, 'reason') },
    });
    return `Driver is now ${r.status.toLowerCase()}.`;
  });
}

// ---------- vehicles ----------

export async function createVehicle(_p: ActionState, f: FormData): Promise<ActionState> {
  return run('/vehicles', async () => {
    await api('/v1/admin/vehicles', {
      method: 'POST',
      body: {
        plate: s(f, 'plate'),
        brand: s(f, 'brand'),
        model: s(f, 'model'),
        colour: s(f, 'colour'),
        class: s(f, 'class'),
        seats: Number(s(f, 'seats')),
        bagCapacity: Number(s(f, 'bagCapacity')),
        powerType: s(f, 'powerType'),
        partnerId: opt(f, 'partnerId'),
      },
    });
    return 'Vehicle added.';
  });
}

// ---------- airlines ----------

const ipList = (f: FormData) =>
  s(f, 'allowedIps')
    .split(/[\s,]+/)
    .map((x) => x.trim())
    .filter(Boolean);

const secretMessage = (r: { keyId: string; secret: string; oldKeyExpiresAt?: string }) =>
  `New key ${r.keyId}\nSecret (shown once, copy it now): ${r.secret}${r.oldKeyExpiresAt ? `\nThe old key keeps working until ${new Date(r.oldKeyExpiresAt).toLocaleString('en-NG', { timeZone: 'Africa/Lagos' })}.` : ''}`;

export async function createCredential(
  airlineId: string,
  _p: ActionState,
  f: FormData,
): Promise<ActionState> {
  return run(`/airlines/${airlineId}`, async () =>
    secretMessage(
      await api(`/v1/admin/airlines/${airlineId}/credentials`, {
        method: 'POST',
        body: { allowedIps: ipList(f) },
      }),
    ),
  );
}

export async function rotateCredential(airlineId: string, credId: string): Promise<ActionState> {
  return run(`/airlines/${airlineId}`, async () =>
    secretMessage(await api(`/v1/admin/airlines/credentials/${credId}/rotate`, { method: 'POST' })),
  );
}

export async function revokeCredential(airlineId: string, credId: string): Promise<ActionState> {
  return run(`/airlines/${airlineId}`, async () => {
    await api(`/v1/admin/airlines/credentials/${credId}/revoke`, { method: 'POST' });
    return 'Key revoked. Calls signed with it are refused from now on.';
  });
}

export async function updateCredentialIps(
  airlineId: string,
  credId: string,
  _p: ActionState,
  f: FormData,
): Promise<ActionState> {
  return run(`/airlines/${airlineId}`, async () => {
    await api(`/v1/admin/airlines/credentials/${credId}/ips`, {
      method: 'PUT',
      body: { allowedIps: ipList(f) },
    });
    return 'Allowed IPs saved.';
  });
}

// ---------- settings (config store) ----------

export async function saveConfig(key: string, _p: ActionState, f: FormData): Promise<ActionState> {
  return run('/settings', async () => {
    let value: unknown;
    try {
      value = JSON.parse(s(f, 'value'));
    } catch {
      throw new ApiError(400, 'JSON', 'The value is not valid JSON.');
    }
    const r = await api<{ version: number }>(`/v1/admin/config/${encodeURIComponent(key)}`, {
      method: 'PUT',
      body: { value },
    });
    return `Saved as version ${r.version}.`;
  });
}

// ---------- alerts ----------

export async function resolveAlert(id: string): Promise<ActionState> {
  return run('/', async () => {
    await api(`/v1/admin/alerts/${id}/resolve`, { method: 'POST' });
  });
}
