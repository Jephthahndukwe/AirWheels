'use client';

import { useState } from 'react';
import { ActionForm, Field, Select, Submit } from '@/components/form';
import { createOpsBooking, searchPlaces } from '../../money-actions';

type Place = { placeId: string; description: string; location: { lat: number; lng: number } };

function AddressSearch({ prefix }: { prefix: string }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<Place[]>([]);
  const [picked, setPicked] = useState<Place | null>(null);
  return (
    <div className="col-span-2">
      <label className="block text-sm">
        <span className="mb-1 block font-medium">Address (search and pick)</span>
        <input
          className="w-full rounded-md border border-border bg-white px-3 py-2"
          value={picked ? picked.description : q}
          onChange={async (e) => {
            setPicked(null);
            setQ(e.target.value);
            setResults(await searchPlaces(e.target.value).catch(() => []));
          }}
        />
      </label>
      {!picked && results.length > 0 && (
        <ul className="mt-1 rounded-md border border-border bg-white text-sm">
          {results.map((p) => (
            <li key={p.placeId}>
              <button type="button" className="block w-full px-3 py-1.5 text-left hover:bg-cloud" onClick={() => setPicked(p)}>
                {p.description}
              </button>
            </li>
          ))}
        </ul>
      )}
      <input type="hidden" name={`${prefix}.address`} value={picked?.description ?? ''} />
      <input type="hidden" name={`${prefix}.lat`} value={picked?.location.lat ?? ''} />
      <input type="hidden" name={`${prefix}.lng`} value={picked?.location.lng ?? ''} />
    </div>
  );
}

const tomorrow = () => new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);

/** Ops manual entry for phone and WhatsApp bookings (CHN-06). Leave a leg's flight empty to skip it. */
export function OpsBookingForm() {
  return (
    <ActionForm action={createOpsBooking} className="space-y-5">
      <div className="grid grid-cols-3 gap-3">
        <Field label="Airline booking reference" name="reference" required />
        <Field label="Traveller name (as on the airline booking)" name="name" required />
        <Field label="Mobile number" name="phone" required placeholder="0801 234 5678" />
        <Field label="Email (optional)" name="email" type="email" />
        <label className="flex items-end gap-2 pb-2 text-sm">
          <input type="checkbox" name="whatsapp" defaultChecked /> WhatsApp on this number
        </label>
      </div>
      {(['DEPARTURE', 'ARRIVAL'] as const).map((t) => (
        <fieldset key={t} className="grid grid-cols-4 gap-3 rounded-md border border-border p-3">
          <legend className="px-1 text-sm font-semibold">{t === 'DEPARTURE' ? 'To the airport' : 'From the airport'} (leave the flight empty to skip)</legend>
          <Field label="Flight number" name={`${t}.flight`} placeholder="P47121" />
          <Field label="Date" name={`${t}.date`} type="date" defaultValue={tomorrow()} />
          <AddressSearch prefix={t} />
          <div className="col-span-4">
            <Field label="Landmark (optional)" name={`${t}.landmark`} />
          </div>
        </fieldset>
      ))}
      <div className="grid grid-cols-5 gap-3">
        <Field label="Passengers" name="passengers" type="number" min={1} max={7} defaultValue={1} required />
        <Field label="Bags" name="bags" type="number" min={0} max={12} defaultValue={1} required />
        <Field label="Child seats" name="childSeats" type="number" min={0} max={3} defaultValue={0} />
        <Select label="Ride" name="rideType" options={[['PRIVATE', 'Private'], ['SHARED', 'Shared']]} />
        <Select label="Plan" name="plan" options={[['STANDARD', 'Standard'], ['FLEX', 'Flex']]} />
      </div>
      <Field label="Note for the audit log (optional)" name="note" />
      <Submit>Price it, create the booking and get a payment link</Submit>
    </ActionForm>
  );
}
