'use client';

import { formatNaira } from '@airwheels/types';
import { useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardTitle } from '@/components/ui/card';
import { API_URL } from '@/lib/utils';

/**
 * Stand-in for Paystack's checkout in local runs and CI only (the API refuses it anywhere else,
 * ACC-12). "Pay" makes the fake gateway send the same signed webhook Paystack would.
 */
function FakeCheckout() {
  const p = useSearchParams();
  const reference = p.get('reference') ?? '';
  const amount = Number(p.get('amount') ?? 0);
  const callback = p.get('callback') ?? '/';
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function finish(outcome: 'success' | 'failed') {
    setBusy(true);
    try {
      const r = await fetch(`${API_URL}/v1/dev/fake-paystack/${encodeURIComponent(reference)}/complete`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ outcome }),
      });
      if (!r.ok) throw new Error('The fake checkout is not available. Is the API running in development?');
      window.location.href = `${callback}${callback.includes('?') ? '&' : '?'}reference=${encodeURIComponent(reference)}`;
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <Card className="space-y-4">
      <p className="rounded bg-amber-100 p-2 text-xs text-amber-900">Test checkout for local development. No real money moves.</p>
      <CardTitle>Pay {formatNaira(amount)}</CardTitle>
      <p className="text-sm text-muted-foreground">Reference {reference}</p>
      <Button className="w-full" size="lg" onClick={() => finish('success')} disabled={busy}>
        Pay (test)
      </Button>
      <Button className="w-full" variant="outline" onClick={() => finish('failed')} disabled={busy}>
        Make the payment fail
      </Button>
      {error && <p className="text-sm text-coral">{error}</p>}
    </Card>
  );
}

export default function FakeCheckoutPage() {
  return (
    <Suspense>
      <FakeCheckout />
    </Suspense>
  );
}
