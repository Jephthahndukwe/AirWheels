'use client';

import { formatNaira } from '@airwheels/types';
import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardTitle } from '@/components/ui/card';
import { API_URL } from '@/lib/utils';

interface Status {
  bookingId: string;
  reference: string;
  status: string;
  totalKobo: number;
  priceHeldUntil: string | null;
  payment: { status: string } | null;
  legs: { type: string; pickupAt: string | null; pickup: string; dropoff: string; amountKobo: number }[];
}

const FINAL = ['CONFIRMED', 'IN_PROGRESS', 'COMPLETED', 'PAYMENT_FAILED', 'CANCELLED', 'REFUNDED', 'REJECTED'];

/**
 * After Paystack sends the traveller back. The page never decides payment succeeded: it waits for
 * our API, which only confirms after Paystack's webhook or our own check with Paystack (14.2).
 */
export function BookingStatus({ id, token }: { id: string; token: string }) {
  const [s, setS] = useState<Status | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tries, setTries] = useState(0);
  const [trackingUrl, setTrackingUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(`aw:booking:${id}`);
      if (saved) setTrackingUrl((JSON.parse(saved) as { trackingUrl?: string }).trackingUrl ?? null);
    } catch {
      /* no storage */
    }
  }, [id]);

  const load = useCallback(async () => {
    try {
      const r = await fetch(`${API_URL}/v1/bookings/${id}?t=${encodeURIComponent(token)}`, { cache: 'no-store' });
      if (!r.ok) throw new Error(r.status === 403 ? 'This link is not valid.' : 'We could not load your booking.');
      setS((await r.json()) as Status);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [id, token]);

  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    if (s && FINAL.includes(s.status)) return;
    if (tries > 45) return;
    const t = setTimeout(() => {
      setTries((n) => n + 1);
      void load();
    }, 2_000);
    return () => clearTimeout(t);
  }, [s, tries, load]);

  async function retry() {
    setBusy(true);
    try {
      const r = await fetch(`${API_URL}/v1/bookings/${id}/pay`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ payToken: token }) });
      const b = (await r.json()) as { authorizationUrl?: string; message?: string };
      if (!r.ok || !b.authorizationUrl) throw new Error(b.message ?? 'Could not start the payment.');
      window.location.href = b.authorizationUrl;
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  const time = (iso: string | null) => (iso ? new Intl.DateTimeFormat('en-NG', { timeZone: 'Africa/Lagos', weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }).format(new Date(iso)) : '');

  if (error && !s) return <Card><p className="text-sm text-coral">{error}</p></Card>;
  if (!s) return <Card><p className="text-sm text-muted-foreground">Loading your booking…</p></Card>;

  const confirmed = ['CONFIRMED', 'IN_PROGRESS', 'COMPLETED'].includes(s.status);
  const failed = s.status === 'PAYMENT_FAILED';
  const waiting = s.status === 'PENDING_PAYMENT';

  return (
    <Card className="space-y-4" aria-live="polite">
      <CardTitle>{confirmed ? 'Your transfer is booked' : failed ? 'Payment did not go through' : waiting ? 'Confirming your payment…' : `Booking ${s.status.toLowerCase().replace('_', ' ')}`}</CardTitle>
      <p className="text-sm">
        Booking reference <span className="font-mono font-semibold">{s.reference}</span> · {formatNaira(s.totalKobo)}
      </p>
      {confirmed && <p className="text-sm">We have sent the details, your pickup code and a tracking link by WhatsApp or SMS. Your driver&apos;s details come before the trip.</p>}
      {waiting && tries > 45 && <p className="text-sm text-muted-foreground">This is taking longer than usual. If you paid, you will get a WhatsApp or SMS confirmation shortly. You can close this page.</p>}
      {failed && (
        <>
          <p className="text-sm">No money was taken for this attempt. You can try again while your price is held.</p>
          <Button className="w-full" onClick={retry} disabled={busy}>
            {busy ? 'Opening secure payment…' : 'Try paying again'}
          </Button>
        </>
      )}
      <ul className="space-y-2 text-sm">
        {s.legs.map((l) => (
          <li key={l.type} className="rounded-md bg-muted p-3">
            <p className="font-semibold">{l.type === 'DEPARTURE' ? 'To the airport' : 'From the airport'}</p>
            <p className="text-muted-foreground">{l.type === 'DEPARTURE' ? `Pickup about ${time(l.pickupAt)}` : `Driver waiting from ${time(l.pickupAt)}`}</p>
            <p>{l.pickup} → {l.dropoff}</p>
          </li>
        ))}
      </ul>
      {confirmed && trackingUrl && (
        <a className="block text-center font-semibold text-primary underline" href={trackingUrl}>
          Open your tracking page
        </a>
      )}
      {error && <p className="text-sm text-coral">{error}</p>}
    </Card>
  );
}
