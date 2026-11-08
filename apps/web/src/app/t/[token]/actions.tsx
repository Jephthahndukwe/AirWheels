'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { API_URL } from '@/lib/utils';

export async function travellerPost<T>(token: string, path: string, body: object): Promise<T> {
  const res = await fetch(`${API_URL}/v1/t/${encodeURIComponent(token)}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as T & { message?: string | string[] };
  if (!res.ok) {
    const m = json.message;
    throw new Error(
      Array.isArray(m) ? m.join(' ') : (m ?? 'Something went wrong. Please try again.'),
    );
  }
  return json;
}

const btn =
  'inline-flex h-11 w-full items-center justify-center rounded-md px-4 text-sm font-semibold';

/** Masked call (TRV-05): we ring the traveller and connect them; nobody sees a number. */
export function CallDriver({ token, legId }: { token: string; legId: string }) {
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <div>
      <button
        className={`${btn} border border-border bg-white`}
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            setMsg((await travellerPost<{ message: string }>(token, '/call', { legId })).message);
          } catch (e) {
            setMsg((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        Call driver
      </button>
      {msg && (
        <p className="mt-1 text-xs" role="status">
          {msg}
        </p>
      )}
    </div>
  );
}

/** Emergency during the ride (TRV-06): alerts ops at once with the phone's location if allowed. */
export function Emergency({ token, legId }: { token: string; legId: string }) {
  const [state, setState] = useState<'idle' | 'confirm' | 'sent' | string>('idle');
  const send = (lat?: number, lng?: number) =>
    travellerPost<{ message: string }>(token, '/emergency', { legId, lat, lng })
      .then((r) => setState(r.message))
      .catch((e: Error) => setState(e.message));
  if (state === 'idle')
    return (
      <button className={`${btn} bg-red-700 text-white`} onClick={() => setState('confirm')}>
        Emergency
      </button>
    );
  if (state === 'confirm')
    return (
      <div className="rounded-md border-2 border-red-700 p-3 text-sm">
        <p className="mb-2 font-semibold">Alert our team now?</p>
        <div className="grid grid-cols-2 gap-2">
          <button
            className={`${btn} bg-red-700 text-white`}
            onClick={() => {
              setState('sent');
              if (navigator.geolocation)
                navigator.geolocation.getCurrentPosition(
                  (p) => void send(p.coords.latitude, p.coords.longitude),
                  () => void send(),
                  { timeout: 5000 },
                );
              else void send();
            }}
          >
            Yes, alert
          </button>
          <button
            className={`${btn} border border-border bg-white`}
            onClick={() => setState('idle')}
          >
            No
          </button>
        </div>
      </div>
    );
  return (
    <p className="rounded-md bg-red-700 p-3 text-sm font-semibold text-white" role="alert">
      {state === 'sent' ? 'Alerting our team…' : state}
    </p>
  );
}

/** Rating after the trip (TRV-08). */
export function Rate({
  token,
  legId,
  current,
}: {
  token: string;
  legId: string;
  current: number | null;
}) {
  const router = useRouter();
  const [score, setScore] = useState(current ?? 0);
  const [comment, setComment] = useState('');
  const [msg, setMsg] = useState<string | null>(current ? 'Thanks for rating.' : null);
  return (
    <form
      className="space-y-2"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!score) return setMsg('Choose a number of stars.');
        try {
          await travellerPost(token, '/rating', { legId, score, comment: comment || undefined });
          setMsg('Thanks for rating.');
          router.refresh();
        } catch (err) {
          setMsg((err as Error).message);
        }
      }}
    >
      <div className="flex gap-1" role="radiogroup" aria-label="Rating">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={score === n}
            aria-label={`${n} star${n > 1 ? 's' : ''}`}
            className={`h-10 w-10 rounded-md text-xl ${n <= score ? 'bg-primary text-white' : 'bg-muted'}`}
            onClick={() => setScore(n)}
          >
            ★
          </button>
        ))}
      </div>
      <textarea
        className="w-full rounded-md border border-border p-2 text-sm"
        rows={2}
        maxLength={1000}
        placeholder="Anything to tell us? (optional)"
        value={comment}
        onChange={(e) => setComment(e.target.value)}
      />
      <button className={`${btn} bg-ink text-white`}>Send rating</button>
      {msg && (
        <p className="text-xs" role="status">
          {msg}
        </p>
      )}
    </form>
  );
}
