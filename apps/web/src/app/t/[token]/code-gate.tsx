'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { formatNaira } from '@airwheels/types';
import { Footer } from '@/components/footer';
import { Button } from '@/components/ui/button';
import { Card, CardTitle } from '@/components/ui/card';
import { Input, Label } from '@/components/ui/input';
import { AddressPicker, type PickedAddress } from '../../address-picker';
import { travellerPost } from './actions';

/**
 * Change and cancel sit behind a six-digit code sent to the booking's phone (ACC-02): valid 5
 * minutes, 5 tries, with a resend cooldown. The cost under the plan is shown before the traveller
 * confirms (TRV-07, POL-07).
 */
function useCodeGate(token: string) {
  const [grant, setGrant] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [code, setCode] = useState('');
  const [devCode, setDevCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const send = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await travellerPost<{ resendInSeconds: number; devCode?: string }>(
        token,
        '/code',
        {},
      );
      setSent(true);
      setCooldown(r.resendInSeconds);
      setDevCode(r.devCode ?? null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const verify = async () => {
    setBusy(true);
    setError(null);
    try {
      setGrant((await travellerPost<{ grant: string }>(token, '/code/verify', { code })).grant);
    } catch (e) {
      setError((e as Error).message);
      setCode('');
    } finally {
      setBusy(false);
    }
  };

  const gate = (
    <div className="space-y-4">
      <Button
        className="w-full"
        variant={sent ? 'outline' : 'default'}
        onClick={send}
        disabled={busy || cooldown > 0}
      >
        {sent
          ? cooldown > 0
            ? `Send again in ${cooldown}s`
            : 'Send a new code'
          : 'Text me a code'}
      </Button>
      {sent && (
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            void verify();
          }}
        >
          <p className="text-sm text-muted-foreground">
            We sent a six-digit code to the phone on this booking. It works for 5 minutes.
          </p>
          {devCode && (
            <p className="rounded-md bg-muted p-2 text-xs">
              Development only: your code is {devCode}
            </p>
          )}
          <div>
            <Label htmlFor="code">Six-digit code</Label>
            <Input
              id="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="\d{6}"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              placeholder="••••••"
            />
          </div>
          <Button className="w-full" disabled={busy || code.length !== 6}>
            Continue
          </Button>
        </form>
      )}
      {error && (
        <p className="text-sm text-red-700" role="alert">
          {error}
        </p>
      )}
    </div>
  );
  return { grant, gate };
}

type LegSummary = {
  id: string;
  type: 'DEPARTURE' | 'ARRIVAL';
  scheduledAt: string | null;
  pickup: string;
  dropoff: string;
  status: string;
};
type Decision = { allowed: boolean; message: string; feeKobo: number; refundKobo: number };

function Shell({
  token,
  title,
  intro,
  children,
}: {
  token: string;
  title: string;
  intro: string;
  children: React.ReactNode;
}) {
  return (
    <>
      <Card className="space-y-4">
        <CardTitle>{title}</CardTitle>
        <p className="text-sm text-muted-foreground">{intro}</p>
        {children}
        <Button variant="ghost" asChild className="w-full">
          <Link href={`/t/${token}`}>Back to my booking</Link>
        </Button>
      </Card>
      <Footer />
    </>
  );
}

const toLocalInput = (iso: string | null) => {
  if (!iso) return '';
  const d = new Date(new Date(iso).getTime() + 60 * 60_000); // Lagos is UTC+1 all year
  return d.toISOString().slice(0, 16);
};

export function ChangeFlow({ token, legs }: { token: string; legs: LegSummary[] }) {
  const { grant, gate } = useCodeGate(token);
  const [legId, setLegId] = useState(legs[0]?.id ?? '');
  const leg = legs.find((l) => l.id === legId);
  const [kind, setKind] = useState<'CHANGE_TIME' | 'CHANGE_ADDRESS'>(
    leg?.type === 'DEPARTURE' ? 'CHANGE_TIME' : 'CHANGE_ADDRESS',
  );
  const [time, setTime] = useState(toLocalInput(leg?.scheduledAt ?? null));
  const [address, setAddress] = useState<PickedAddress | null>(null);
  const [decision, setDecision] = useState<Decision | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const body = () => ({
    grant,
    legId,
    kind,
    ...(kind === 'CHANGE_TIME'
      ? { pickupAt: `${time}:00+01:00` }
      : {
          address: address && {
            text: address.text,
            lat: address.location.lat,
            lng: address.location.lng,
            landmark: address.landmark,
          },
        }),
  });
  const run = async (apply: boolean) => {
    setError(null);
    try {
      const r = await travellerPost<{ decision: Decision }>(token, '/changes', {
        ...body(),
        apply,
        acceptFeeKobo: apply ? decision?.feeKobo : undefined,
      });
      if (apply) setDone('Done. We have sent you a confirmation.');
      else setDecision(r.decision);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <Shell
      token={token}
      title="Change your transfer"
      intro="Change your pickup time or address. We show any cost under your plan before you confirm."
    >
      {!grant ? (
        gate
      ) : done ? (
        <p className="rounded-md bg-muted p-3 text-sm font-semibold" role="status">
          {done}
        </p>
      ) : (
        <div className="space-y-4">
          {legs.length > 1 && (
            <div>
              <Label htmlFor="leg">Which ride</Label>
              <select
                id="leg"
                className="h-11 w-full rounded-md border border-border bg-white px-3 text-sm"
                value={legId}
                onChange={(e) => (setLegId(e.target.value), setDecision(null))}
              >
                {legs.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.type === 'DEPARTURE' ? 'To the airport' : 'From the airport'}
                  </option>
                ))}
              </select>
            </div>
          )}
          {leg?.type === 'DEPARTURE' && (
            <div className="grid grid-cols-2 gap-2 text-sm">
              {(['CHANGE_TIME', 'CHANGE_ADDRESS'] as const).map((k) => (
                <label
                  key={k}
                  className={`rounded-md border p-3 ${kind === k ? 'border-primary' : 'border-border'}`}
                >
                  <input
                    type="radio"
                    className="mr-2"
                    checked={kind === k}
                    onChange={() => (setKind(k), setDecision(null))}
                  />
                  {k === 'CHANGE_TIME' ? 'Pickup time' : 'Pickup address'}
                </label>
              ))}
            </div>
          )}
          {kind === 'CHANGE_TIME' ? (
            <div>
              <Label htmlFor="time">New pickup time (Lagos)</Label>
              <Input
                id="time"
                type="datetime-local"
                value={time}
                onChange={(e) => (setTime(e.target.value), setDecision(null))}
              />
            </div>
          ) : (
            <AddressPicker
              id="new-address"
              label={leg?.type === 'DEPARTURE' ? 'New pickup address' : 'New destination'}
              value={address}
              onChange={(a) => (setAddress(a), setDecision(null))}
            />
          )}
          {!decision ? (
            <Button
              className="w-full"
              onClick={() => run(false)}
              disabled={kind === 'CHANGE_ADDRESS' && !address}
            >
              See the cost
            </Button>
          ) : decision.allowed ? (
            <div className="space-y-3">
              <p className="rounded-md bg-muted p-3 text-sm" data-testid="change-cost">
                {decision.feeKobo > 0
                  ? `This change costs ${formatNaira(decision.feeKobo)}.`
                  : 'This change is free.'}{' '}
                {decision.message}
              </p>
              <Button className="w-full" onClick={() => run(true)}>
                {decision.feeKobo > 0
                  ? `Confirm and pay ${formatNaira(decision.feeKobo)}`
                  : 'Confirm change'}
              </Button>
            </div>
          ) : (
            <p className="rounded-md bg-muted p-3 text-sm">{decision.message}</p>
          )}
          {error && (
            <p className="text-sm text-red-700" role="alert">
              {error}
            </p>
          )}
        </div>
      )}
    </Shell>
  );
}

export function CancelFlow({ token }: { token: string }) {
  const { grant, gate } = useCodeGate(token);
  const [preview, setPreview] = useState<{
    allowed: boolean;
    message?: string;
    refundKobo: number;
    paidKobo: number;
  } | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!grant) return;
    travellerPost<{ allowed: boolean; message?: string; refundKobo: number; paidKobo: number }>(
      token,
      '/cancel',
      { grant, apply: false },
    )
      .then(setPreview)
      .catch((e: Error) => setError(e.message));
  }, [grant, token]);

  return (
    <Shell
      token={token}
      title="Cancel your transfer"
      intro="We show what you get back under your plan before you confirm."
    >
      {!grant ? (
        gate
      ) : done ? (
        <p className="rounded-md bg-muted p-3 text-sm font-semibold" role="status">
          {done}
        </p>
      ) : preview ? (
        preview.allowed ? (
          <div className="space-y-3">
            <p className="rounded-md bg-muted p-3 text-sm" data-testid="cancel-refund">
              {preview.paidKobo === 0
                ? 'Nothing has been paid, so nothing is refunded.'
                : `You get back ${formatNaira(preview.refundKobo)} of ${formatNaira(preview.paidKobo)}.`}
            </p>
            <Button
              variant="destructive"
              className="w-full"
              onClick={async () => {
                try {
                  await travellerPost(token, '/cancel', {
                    grant,
                    apply: true,
                    acceptRefundKobo: preview.refundKobo,
                  });
                  setDone('Your transfer is cancelled. We have sent you a confirmation.');
                } catch (e) {
                  setError((e as Error).message);
                }
              }}
            >
              Cancel my transfer
            </Button>
          </div>
        ) : (
          <p className="rounded-md bg-muted p-3 text-sm">{preview.message}</p>
        )
      ) : (
        <p className="text-sm">Checking your plan…</p>
      )}
      {error && (
        <p className="text-sm text-red-700" role="alert">
          {error}
        </p>
      )}
    </Shell>
  );
}
