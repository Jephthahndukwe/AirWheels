'use client';

import { formatNaira } from '@airwheels/types';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardTitle } from '@/components/ui/card';
import { Input, Label } from '@/components/ui/input';
import { API_URL, cn } from '@/lib/utils';

/**
 * Our own booking page form (PRD 6.2, CHN-05). Field order follows the PRD.
 * This milestone covers the layout and a live quote. Places search and pin drop (CHN-07),
 * flight validation and Paystack checkout arrive in M2.
 */
const AREAS = [
  { label: 'Lekki Phase 1', lat: 6.4474, lng: 3.4723 },
  { label: 'Victoria Island', lat: 6.4281, lng: 3.4219 },
  { label: 'Ajah', lat: 6.4682, lng: 3.5852 },
  { label: 'Surulere', lat: 6.5, lng: 3.35 },
  { label: 'Ikeja GRA (Maryland)', lat: 6.573, lng: 3.367 },
];
const AIRPORT = { text: 'Murtala Muhammed Airport, Domestic Terminal', location: { lat: 6.5774, lng: 3.3212 } };

type Transfer = 'DEPARTURE' | 'ARRIVAL' | 'BOTH';

function Segmented<T extends string>(props: { value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <div className="grid grid-flow-col gap-2">
      {props.options.map(([v, label]) => (
        <button
          key={v}
          type="button"
          onClick={() => props.onChange(v)}
          className={cn(
            'rounded-md border px-3 py-2 text-sm font-medium',
            props.value === v ? 'border-primary bg-primary/10 text-ink' : 'border-border bg-background',
          )}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

export function BookingForm() {
  const [transfer, setTransfer] = useState<Transfer>('DEPARTURE');
  const [area, setArea] = useState(0);
  const [passengers, setPassengers] = useState(1);
  const [bags, setBags] = useState(1);
  const [rideType, setRideType] = useState<'PRIVATE' | 'SHARED'>('PRIVATE');
  const [plan, setPlan] = useState<'STANDARD' | 'FLEX'>('STANDARD');
  const [price, setPrice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function getQuote() {
    setError(null);
    const a = AREAS[area]!;
    const home = { text: a.label, location: { lat: a.lat, lng: a.lng } };
    const date = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    const flight = {
      flightNumber: 'MK101',
      date,
      origin: 'LOS',
      destination: 'ABV',
      scheduledDeparture: `${date}T08:30:00.000Z`,
      scheduledArrival: `${date}T09:40:00.000Z`,
    };
    const legs = [
      ...(transfer !== 'ARRIVAL' ? [{ type: 'DEPARTURE', pickup: home, dropoff: AIRPORT, flight }] : []),
      ...(transfer !== 'DEPARTURE' ? [{ type: 'ARRIVAL', pickup: AIRPORT, dropoff: home, flight }] : []),
    ];
    try {
      const res = await fetch(`${API_URL}/v1/quotes`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ legs, passengers, bags, rideType, plan }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.message ?? 'Could not get a price');
      setPrice(formatNaira(body.totalKobo));
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <Card className="space-y-5">
      <CardTitle>Add an airport transfer</CardTitle>

      <div>
        <Label>Transfer</Label>
        <Segmented
          value={transfer}
          onChange={setTransfer}
          options={[
            ['DEPARTURE', 'To airport'],
            ['ARRIVAL', 'From airport'],
            ['BOTH', 'Both'],
          ]}
        />
      </div>

      <div>
        <Label htmlFor="area">Home or destination</Label>
        <select
          id="area"
          className="h-11 w-full rounded-md border border-border bg-background px-3 text-sm"
          value={area}
          onChange={(e) => setArea(Number(e.target.value))}
        >
          {AREAS.map((a, i) => (
            <option key={a.label} value={i}>
              {a.label}
            </option>
          ))}
        </select>
      </div>

      <div>
        <Label htmlFor="phone">Phone number (WhatsApp)</Label>
        <Input id="phone" type="tel" placeholder="+234 801 234 5678" />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label htmlFor="pax">Passengers</Label>
          <Input id="pax" type="number" min={1} max={8} value={passengers} onChange={(e) => setPassengers(Number(e.target.value))} />
        </div>
        <div>
          <Label htmlFor="bags">Bags</Label>
          <Input id="bags" type="number" min={0} max={12} value={bags} onChange={(e) => setBags(Number(e.target.value))} />
        </div>
      </div>

      <div>
        <Label>Ride type</Label>
        <Segmented
          value={rideType}
          onChange={setRideType}
          options={[
            ['PRIVATE', 'Private car'],
            ['SHARED', 'Shared (up to 3)'],
          ]}
        />
      </div>

      <div>
        <Label>Plan</Label>
        <Segmented
          value={plan}
          onChange={setPlan}
          options={[
            ['STANDARD', 'Standard'],
            ['FLEX', 'Flex: free changes'],
          ]}
        />
      </div>

      <Button className="w-full" size="lg" onClick={getQuote}>
        See price
      </Button>
      {price && (
        <p className="text-center text-2xl font-bold" data-testid="price">
          {price}
        </p>
      )}
      {error && <p className="text-center text-sm text-coral">{error}</p>}
    </Card>
  );
}
