'use server';

import { revalidatePath } from 'next/cache';
import type { ActionState } from '@/components/form';
import { api, errorMessage } from '@/lib/api';

const s = (f: FormData, k: string) => String(f.get(k) ?? '').trim();

async function run(path: string, fn: () => Promise<string | void>): Promise<ActionState> {
  try {
    const ok = await fn();
    revalidatePath(path);
    return { ok: ok || 'Saved.' };
  } catch (e) {
    return { error: errorMessage(e) };
  }
}

/** Ops sends a timeline message by hand (Phase 0, or a resend). Same templates and SMS fallback. */
export async function sendMessage(
  bookingId: string,
  _p: ActionState,
  f: FormData,
): Promise<ActionState> {
  return run(`/bookings/${bookingId}`, async () => {
    await api(`/v1/admin/bookings/${bookingId}/messages`, {
      method: 'POST',
      body: {
        event: s(f, 'event'),
        legId: s(f, 'legId') || undefined,
        reason: s(f, 'reason') || undefined,
      },
    });
    return 'Queued. It appears below once sent.';
  });
}

export async function assignDriver(
  bookingId: string,
  _p: ActionState,
  f: FormData,
): Promise<ActionState> {
  return run(`/bookings/${bookingId}`, async () => {
    const r = await api<{ travellerMessage: string }>(`/v1/admin/legs/${s(f, 'legId')}/assign`, {
      method: 'POST',
      body: { driverId: s(f, 'driverId') },
    });
    return `Assigned. Traveller message: ${r.travellerMessage.replace(/[._]/g, ' ')}.`;
  });
}

export async function correctLegStatus(
  bookingId: string,
  _p: ActionState,
  f: FormData,
): Promise<ActionState> {
  return run(`/bookings/${bookingId}`, async () => {
    await api(`/v1/admin/legs/${s(f, 'legId')}/status`, {
      method: 'POST',
      body: { status: s(f, 'status'), reason: s(f, 'reason') },
    });
    return 'Leg updated and the traveller told.';
  });
}

export async function addTemplateVersion(_p: ActionState, f: FormData): Promise<ActionState> {
  return run('/messages', async () => {
    const r = await api<{ version: number; channel: string }>('/v1/admin/message-templates', {
      method: 'POST',
      body: {
        airlineId: s(f, 'airlineId') || null,
        event: s(f, 'event'),
        channel: s(f, 'channel'),
        body: s(f, 'body'),
        providerName: s(f, 'providerName') || undefined,
      },
    });
    return r.channel === 'WHATSAPP'
      ? `Saved as version ${r.version}. Submit it to Meta, then mark it approved; until then it is used only inside the 24-hour window.`
      : `Saved as version ${r.version}. It is used from now on.`;
  });
}

export async function approveTemplate(
  id: string,
  _p: ActionState,
  f: FormData,
): Promise<ActionState> {
  return run('/messages', async () => {
    await api(`/v1/admin/message-templates/${id}/approve`, {
      method: 'POST',
      body: { providerName: s(f, 'providerName') },
    });
    return 'Marked approved by Meta.';
  });
}

export async function resolveAlert(id: string): Promise<ActionState> {
  return run('/support', async () => {
    await api(`/v1/admin/alerts/${id}/resolve`, { method: 'POST' });
    return 'Resolved.';
  });
}
