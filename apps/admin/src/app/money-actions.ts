'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import type { ActionState } from '@/components/form';
import { ApiError, api, errorMessage } from '@/lib/api';

const s = (f: FormData, k: string) => String(f.get(k) ?? '').trim();

/** Naira typed by ops (e.g. "5,000" or "5000.50") to integer kobo. Never floats in storage. */
function nairaToKobo(input: string): number {
  const clean = input.replace(/[,\s₦]/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(clean)) throw new ApiError(400, 'AMOUNT_INVALID', 'Enter an amount in naira, like 5000 or 5000.50.');
  const [whole, frac = ''] = clean.split('.');
  return Number(whole) * 100 + Number(frac.padEnd(2, '0'));
}

async function run(path: string, fn: () => Promise<string | void>): Promise<ActionState> {
  try {
    const ok = await fn();
    revalidatePath(path);
    return { ok: ok || 'Saved.' };
  } catch (e) {
    return { error: errorMessage(e) };
  }
}

export async function refundBooking(bookingId: string, _p: ActionState, f: FormData): Promise<ActionState> {
  return run(`/bookings/${bookingId}`, async () => {
    const r = await api<{ amountKobo: number; route: string; status: string }>(`/v1/admin/bookings/${bookingId}/refunds`, {
      method: 'POST',
      body: { amountKobo: nairaToKobo(s(f, 'amount')), reason: s(f, 'reason'), legId: s(f, 'legId') || undefined },
    });
    return `Refund of ₦${(r.amountKobo / 100).toLocaleString('en-NG')} ${r.route === 'PAYSTACK' ? 'sent through Paystack' : 'added to the airline statement'} (${r.status.toLowerCase()}).`;
  });
}

export async function cancelBooking(bookingId: string, _p: ActionState, f: FormData): Promise<ActionState> {
  return run(`/bookings/${bookingId}`, async () => {
    await api(`/v1/admin/bookings/${bookingId}/cancel`, { method: 'POST', body: { reason: s(f, 'reason') } });
    return 'Booking cancelled. Refund separately if money is owed.';
  });
}

export async function retryBooking(bookingId: string): Promise<ActionState> {
  return run(`/bookings/${bookingId}`, async () => {
    await api(`/v1/admin/bookings/${bookingId}/retry`, { method: 'POST' });
    return 'Steps queued again. Finished steps are skipped.';
  });
}

/** Ops manual entry (CHN-06): quote, create the booking and get a Paystack link to send. */
export async function createOpsBooking(_p: ActionState, f: FormData): Promise<ActionState> {
  let id: string;
  try {
    const legs = (['DEPARTURE', 'ARRIVAL'] as const)
      .filter((t) => s(f, `${t}.flight`))
      .map((t) => ({
        type: t,
        flightNumber: s(f, `${t}.flight`),
        date: s(f, `${t}.date`),
        address: { text: s(f, `${t}.address`), location: { lat: Number(s(f, `${t}.lat`)), lng: Number(s(f, `${t}.lng`)) }, landmark: s(f, `${t}.landmark`) || undefined },
      }));
    if (!legs.length) throw new ApiError(400, 'NO_LEGS', 'Fill in at least one leg.');
    for (const l of legs) {
      if (!Number.isFinite(l.address.location.lat) || !Number.isFinite(l.address.location.lng) || !l.address.text) {
        throw new ApiError(400, 'ADDRESS', 'Choose an address from the search results for each leg.');
      }
    }
    const phone = s(f, 'phone').replace(/\s/g, '');
    const r = await api<{ bookingId: string }>('/v1/admin/bookings', {
      method: 'POST',
      body: {
        legs,
        passengers: Number(s(f, 'passengers')),
        bags: Number(s(f, 'bags')),
        rideType: s(f, 'rideType') || 'PRIVATE',
        plan: s(f, 'plan') || 'STANDARD',
        extras: { childSeats: Number(s(f, 'childSeats') || 0), extraStops: 0 },
        airlineBookingReference: s(f, 'reference'),
        traveller: { name: s(f, 'name'), phone: phone.startsWith('0') ? `+234${phone.slice(1)}` : phone, whatsapp: f.get('whatsapp') === 'on', email: s(f, 'email') || undefined },
        note: s(f, 'note') || undefined,
      },
    });
    id = r.bookingId;
  } catch (e) {
    return { error: errorMessage(e) };
  }
  redirect(`/bookings/${id}?created=1`);
}

export async function addPricingRule(_p: ActionState, f: FormData): Promise<ActionState> {
  return run('/pricing', async () => {
    let values: unknown;
    try {
      values = JSON.parse(s(f, 'values'));
    } catch {
      throw new ApiError(400, 'JSON', 'Values must be valid JSON.');
    }
    const from = s(f, 'effectiveFrom');
    const to = s(f, 'effectiveTo');
    const r = await api<{ version: number; type: string; key: string }>('/v1/admin/pricing/rules', {
      method: 'POST',
      body: { type: s(f, 'type'), key: s(f, 'key'), values, effectiveFrom: from ? new Date(`${from}:00+01:00`).toISOString() : undefined, effectiveTo: to ? new Date(`${to}:00+01:00`).toISOString() : undefined },
    });
    return `${r.type} ${r.key} version ${r.version} saved.`;
  });
}

export async function endPricingRule(id: string): Promise<ActionState> {
  return run('/pricing', async () => {
    await api(`/v1/admin/pricing/rules/${id}/end`, { method: 'POST', body: {} });
    return 'Rule ended. Quotes from now on no longer use it.';
  });
}

export async function reconcileNow(_p: ActionState, f: FormData): Promise<ActionState> {
  return run('/payments', async () => {
    const r = await api<{ day: string; checked: number; settled: number; mismatches: unknown[] }>('/v1/admin/payments/reconcile', { method: 'POST', body: { day: s(f, 'day') || undefined } });
    return `Reconciled ${r.day}: ${r.checked} checked, ${r.settled} settled, ${r.mismatches.length} mismatch${r.mismatches.length === 1 ? '' : 'es'}.`;
  });
}

/** Places search for the ops booking form (server-side, so the form stays simple). */
export async function searchPlaces(q: string) {
  if (q.trim().length < 2) return [];
  return api<{ placeId: string; description: string; location: { lat: number; lng: number } }[]>(`/v1/places/search?q=${encodeURIComponent(q)}`);
}
