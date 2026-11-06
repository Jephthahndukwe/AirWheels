'use client';

import { type QuoteResponse, formatNaira } from '@airwheels/types';
import { useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardTitle } from '@/components/ui/card';
import { Input, Label } from '@/components/ui/input';
import { API_URL, cn } from '@/lib/utils';
import { AddressPicker, type PickedAddress } from './address-picker';

/**
 * Our own booking page and the post-booking link (PRD 6.2, CHN-04 to CHN-09, SHR-01). Field order
 * follows the PRD. The traveller gives the airline booking reference and flight number; we look the
 * flight up. Price comes from the API with a full breakdown; payment is on Paystack's page.
 */
type Transfer = 'DEPARTURE' | 'ARRIVAL' | 'BOTH';
type VehicleClass = 'SEDAN' | 'SUV' | 'VAN';

const tomorrow = () => new Date(Date.now() + 86_400_000 + 3_600_000).toISOString().slice(0, 10);

/** Nigerian numbers as +234...; anything starting with + is kept (CHN-08). */
export function toE164(raw: string): string | null {
  const d = raw.replace(/[\s()-]/g, '');
  if (/^0[789][01]\d{8}$/.test(d)) return `+234${d.slice(1)}`;
  if (/^234[789][01]\d{8}$/.test(d)) return `+${d}`;
  if (/^\+[1-9]\d{7,14}$/.test(d)) return d;
  return null;
}

/** Vehicle suggested from passengers and bags (CHN-09). The API has the final say. */
const suggest = (pax: number, bags: number): VehicleClass => (pax <= 3 && bags <= 3 ? 'SEDAN' : pax <= 4 && bags <= 5 ? 'SUV' : 'VAN');

function Segmented<T extends string>(props: { value: T; options: [T, string, string?][]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="grid grid-flow-col gap-2" role="radiogroup" aria-label={props.label}>
      {props.options.map(([v, label, hint]) => (
        <button
          key={v}
          type="button"
          role="radio"
          aria-checked={props.value === v}
          onClick={() => props.onChange(v)}
          className={cn(
            'rounded-md border px-2 py-2 text-sm font-medium',
            props.value === v ? 'border-primary bg-primary/10 text-ink' : 'border-border bg-background',
          )}
        >
          {label}
          {hint && <span className="block text-xs font-normal text-muted-foreground">{hint}</span>}
        </button>
      ))}
    </div>
  );
}

function Stepper({ id, label, value, min, max, onChange }: { id: string; label: string; value: number; min: number; max: number; onChange: (n: number) => void }) {
  return (
    <div>
      <Label htmlFor={id}>{label}</Label>
      <div className="flex items-center gap-2">
        <Button type="button" variant="outline" size="sm" aria-label={`Fewer ${label.toLowerCase()}`} onClick={() => onChange(Math.max(min, value - 1))}>
          −
        </Button>
        <Input id={id} inputMode="numeric" className="w-14 text-center" value={value} onChange={(e) => onChange(Math.min(max, Math.max(min, Number(e.target.value) || min)))} />
        <Button type="button" variant="outline" size="sm" aria-label={`More ${label.toLowerCase()}`} onClick={() => onChange(Math.min(max, value + 1))}>
          +
        </Button>
      </div>
    </div>
  );
}

const newKey = () => `web-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

export function BookingForm() {
  const params = useSearchParams();
  // Post-booking link from the airline's email (CHN-04): ?airline=P4&ref=ABC123&flight=P47121&date=2026-11-20&leg=DEPARTURE
  const airlineCode = params.get('airline') ?? undefined;
  const linkLeg = params.get('leg') === 'ARRIVAL' ? 'ARRIVAL' : params.get('leg') === 'BOTH' ? 'BOTH' : 'DEPARTURE';

  const [transfer, setTransfer] = useState<Transfer>(params.get('flight') ? linkLeg : 'DEPARTURE');
  const [reference, setReference] = useState(params.get('ref') ?? '');
  const [depFlight, setDepFlight] = useState(params.get('flight') && linkLeg !== 'ARRIVAL' ? params.get('flight')! : '');
  const [depDate, setDepDate] = useState(params.get('date') ?? tomorrow());
  const [arrFlight, setArrFlight] = useState(params.get('flight') && linkLeg === 'ARRIVAL' ? params.get('flight')! : '');
  const [arrDate, setArrDate] = useState(params.get('date') ?? tomorrow());
  const [home, setHome] = useState<PickedAddress | null>(null);
  const [destination, setDestination] = useState<PickedAddress | null>(null);
  const [sameAddress, setSameAddress] = useState(true);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [whatsapp, setWhatsapp] = useState(true);
  const [email, setEmail] = useState('');
  const [passengers, setPassengers] = useState(1);
  const [bags, setBags] = useState(1);
  const [rideType, setRideType] = useState<'PRIVATE' | 'SHARED'>('PRIVATE');
  const [vehicle, setVehicle] = useState<VehicleClass | 'AUTO'>('AUTO');
  const [plan, setPlan] = useState<'STANDARD' | 'FLEX'>('STANDARD');
  const [childSeats, setChildSeats] = useState(0);
  const [promo, setPromo] = useState('');
  const [quote, setQuote] = useState<QuoteResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<'quote' | 'pay' | null>(null);
  const [now, setNow] = useState(Date.now());
  const [bookingKey] = useState(newKey);

  const suggested = suggest(passengers, bags);
  const sharedBlocked = passengers > 2 ? 'Shared is for 1 or 2 people' : bags > passengers * 2 ? 'Up to 2 bags each on shared' : null;
  useEffect(() => {
    if (sharedBlocked && rideType === 'SHARED') setRideType('PRIVATE');
  }, [sharedBlocked, rideType]);

  // Any change to the trip means the shown price no longer applies.
  const tripKey = JSON.stringify([transfer, depFlight, depDate, arrFlight, arrDate, home, destination, sameAddress, passengers, bags, rideType, vehicle, plan, childSeats, promo]);
  useEffect(() => setQuote(null), [tripKey]);
  useEffect(() => {
    if (!quote) return;
    const t = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(t);
  }, [quote]);
  const minutesLeft = quote ? Math.max(0, Math.floor((Date.parse(quote.expiresAt) - now) / 60_000)) : 0;
  const expired = !!quote && Date.parse(quote.expiresAt) <= now;

  const legs = useMemo(() => {
    const out: { type: 'DEPARTURE' | 'ARRIVAL'; flightNumber: string; date: string; address: PickedAddress | null }[] = [];
    if (transfer !== 'ARRIVAL') out.push({ type: 'DEPARTURE', flightNumber: depFlight, date: depDate, address: home });
    if (transfer !== 'DEPARTURE') out.push({ type: 'ARRIVAL', flightNumber: arrFlight, date: arrDate, address: transfer === 'BOTH' && sameAddress ? home : destination });
    return out;
  }, [transfer, depFlight, depDate, arrFlight, arrDate, home, destination, sameAddress]);

  async function api<T>(path: string, body: unknown, headers: Record<string, string> = {}): Promise<T> {
    const res = await fetch(`${API_URL}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
    const data = (await res.json().catch(() => ({}))) as { message?: string | string[]; issues?: { message: string }[] } & T;
    if (!res.ok) throw new Error(data.issues?.[0]?.message ?? (Array.isArray(data.message) ? data.message.join(', ') : data.message) ?? 'Something went wrong. Try again.');
    return data;
  }

  async function getQuote() {
    setError(null);
    const missing = legs.find((l) => !l.flightNumber.trim()) ? 'Enter your flight number.' : legs.find((l) => !l.address) ? 'Choose the address from the list, or drop a pin.' : null;
    if (missing) return setError(missing);
    setBusy('quote');
    try {
      setQuote(
        await api<QuoteResponse>('/v1/quotes', {
          airlineCode,
          legs: legs.map((l) => ({ type: l.type, flightNumber: l.flightNumber, date: l.date, address: l.address })),
          passengers,
          bags,
          rideType,
          vehicleClass: rideType === 'PRIVATE' && vehicle !== 'AUTO' ? vehicle : undefined,
          plan,
          extras: { childSeats, extraStops: 0 },
          promoCode: promo.trim() || undefined,
        }),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function bookAndPay() {
    if (!quote) return;
    setError(null);
    const e164 = toE164(phone);
    if (name.trim().length < 2) return setError('Enter your name as it is on the airline booking.');
    if (!e164) return setError('Enter a mobile number, e.g. 0801 234 5678.');
    if (!/^[A-Za-z0-9]{5,12}$/.test(reference.trim())) return setError('Enter your airline booking reference (5 to 12 letters and numbers).');
    setBusy('pay');
    try {
      const booking = await api<{ bookingId: string; payToken: string; trackingUrl: string }>(
        '/v1/bookings',
        {
          quoteId: quote.quoteId,
          airlineBookingReference: reference.trim(),
          traveller: { name: name.trim(), phone: e164, whatsapp, email: email.trim() || undefined },
          channel: airlineCode ? 'LINK' : 'OWN_PAGE',
        },
        { 'idempotency-key': `${bookingKey}-${quote.quoteId}` },
      );
      try {
        sessionStorage.setItem(`aw:booking:${booking.bookingId}`, JSON.stringify({ trackingUrl: booking.trackingUrl }));
      } catch {
        /* private mode: the status page still works from the link */
      }
      const pay = await api<{ status: string; authorizationUrl?: string }>(`/v1/bookings/${booking.bookingId}/pay`, { payToken: booking.payToken });
      window.location.href = pay.authorizationUrl ?? `/booking/${booking.bookingId}?t=${encodeURIComponent(booking.payToken)}`;
    } catch (e) {
      setError((e as Error).message);
      setBusy(null);
    }
  }

  const time = (iso: string) => new Intl.DateTimeFormat('en-NG', { timeZone: 'Africa/Lagos', weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }).format(new Date(iso));

  return (
    <Card className="space-y-5">
      <CardTitle>Add an airport transfer</CardTitle>

      <div>
        <Label>Transfer</Label>
        <Segmented label="Transfer" value={transfer} onChange={setTransfer} options={[['DEPARTURE', 'To airport'], ['ARRIVAL', 'From airport'], ['BOTH', 'Both']]} />
      </div>

      <div>
        <Label htmlFor="ref">Airline booking reference</Label>
        <Input id="ref" autoCapitalize="characters" placeholder="e.g. ABC123" value={reference} onChange={(e) => setReference(e.target.value.toUpperCase())} />
      </div>

      {transfer !== 'ARRIVAL' && (
        <fieldset className="space-y-3 rounded-md border border-border p-3">
          <legend className="px-1 text-sm font-semibold">To the airport</legend>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="dep-flight">Flight number</Label>
              <Input id="dep-flight" autoCapitalize="characters" placeholder="P47121" value={depFlight} onChange={(e) => setDepFlight(e.target.value.toUpperCase())} />
            </div>
            <div>
              <Label htmlFor="dep-date">Flight date</Label>
              <Input id="dep-date" type="date" value={depDate} min={tomorrow()} onChange={(e) => setDepDate(e.target.value)} />
            </div>
          </div>
          <AddressPicker id="home" label="Pickup address" value={home} onChange={setHome} />
        </fieldset>
      )}

      {transfer !== 'DEPARTURE' && (
        <fieldset className="space-y-3 rounded-md border border-border p-3">
          <legend className="px-1 text-sm font-semibold">From the airport</legend>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="arr-flight">Flight number</Label>
              <Input id="arr-flight" autoCapitalize="characters" placeholder="P47122" value={arrFlight} onChange={(e) => setArrFlight(e.target.value.toUpperCase())} />
            </div>
            <div>
              <Label htmlFor="arr-date">Landing date</Label>
              <Input id="arr-date" type="date" value={arrDate} min={tomorrow()} onChange={(e) => setArrDate(e.target.value)} />
            </div>
          </div>
          {transfer === 'BOTH' && (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={sameAddress} onChange={(e) => setSameAddress(e.target.checked)} />
              Drop me at the same address
            </label>
          )}
          {(transfer === 'ARRIVAL' || !sameAddress) && <AddressPicker id="destination" label="Destination address" value={destination} onChange={setDestination} />}
        </fieldset>
      )}

      <div>
        <Label htmlFor="name">Name on the airline booking</Label>
        <Input id="name" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div>
        <Label htmlFor="phone">Mobile number</Label>
        <Input id="phone" type="tel" inputMode="tel" autoComplete="tel" placeholder="0801 234 5678" value={phone} onChange={(e) => setPhone(e.target.value)} />
        <label className="mt-2 flex items-center gap-2 text-sm">
          <input type="checkbox" checked={whatsapp} onChange={(e) => setWhatsapp(e.target.checked)} />
          This is my WhatsApp number
        </label>
      </div>
      <div>
        <Label htmlFor="email">Email for the receipt (optional)</Label>
        <Input id="email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Stepper id="pax" label="Passengers" value={passengers} min={1} max={7} onChange={setPassengers} />
        <Stepper id="bags" label="Bags" value={bags} min={0} max={12} onChange={setBags} />
      </div>

      <div>
        <Label>Ride type</Label>
        <Segmented
          label="Ride type"
          value={rideType}
          onChange={(v) => (v === 'SHARED' && sharedBlocked ? setError(`${sharedBlocked}. Choose Private.`) : setRideType(v))}
          options={[
            ['PRIVATE', 'Private car', 'The car is yours'],
            ['SHARED', 'Shared', sharedBlocked ?? 'Up to 3 travellers, lower fare'],
          ]}
        />
        {rideType === 'SHARED' && (
          <p className="mt-2 text-xs text-muted-foreground">We match you with up to 2 travellers going your way, adding no more than 20 minutes. No match means a private car at the shared price.</p>
        )}
      </div>

      {rideType === 'PRIVATE' && (
        <div>
          <Label>Vehicle</Label>
          <Segmented
            label="Vehicle"
            value={vehicle}
            onChange={setVehicle}
            options={[
              ['AUTO', `Suggested: ${suggested.toLowerCase()}`],
              ['SEDAN', 'Sedan'],
              ['SUV', 'SUV'],
              ['VAN', 'Van'],
            ]}
          />
        </div>
      )}

      <div>
        <Label>Plan</Label>
        <Segmented
          label="Plan"
          value={plan}
          onChange={setPlan}
          options={[
            ['STANDARD', 'Standard', 'Free change if announced early'],
            ['FLEX', 'Flex', 'Free changes any time'],
          ]}
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Stepper id="seats" label="Child seats" value={childSeats} min={0} max={3} onChange={setChildSeats} />
        <div>
          <Label htmlFor="promo">Promo code</Label>
          <Input id="promo" autoCapitalize="characters" value={promo} onChange={(e) => setPromo(e.target.value.toUpperCase())} />
        </div>
      </div>

      {!quote && (
        <Button className="w-full" size="lg" onClick={getQuote} disabled={busy === 'quote'}>
          {busy === 'quote' ? 'Getting your price…' : 'See price'}
        </Button>
      )}

      {quote && (
        <section className="space-y-3 rounded-md bg-muted p-3" aria-live="polite">
          {quote.legs.map((l) => (
            <div key={l.type}>
              <p className="text-sm font-semibold">
                {l.type === 'DEPARTURE' ? 'To the airport' : 'From the airport'} · flight {l.flight.number}
              </p>
              <p className="text-xs text-muted-foreground">{l.type === 'DEPARTURE' ? `Pickup about ${time(l.pickupAt)}` : `Driver waiting from ${time(l.pickupAt)}`}</p>
              <dl className="mt-1 space-y-0.5 text-sm">
                {l.lines.map((x) => (
                  <div key={x.code} className="flex justify-between gap-3">
                    <dt className="text-muted-foreground">{x.label}</dt>
                    <dd className="tabular-nums">{x.amountKobo < 0 ? `−${formatNaira(-x.amountKobo)}` : formatNaira(x.amountKobo)}</dd>
                  </div>
                ))}
              </dl>
            </div>
          ))}
          <div className="flex items-baseline justify-between border-t border-border pt-2">
            <span className="font-semibold">Total</span>
            <span className="text-2xl font-bold" data-testid="price">
              {formatNaira(quote.totalKobo)}
            </span>
          </div>
          <p className="text-xs text-muted-foreground">
            {quote.vehicleClass.toLowerCase()} · {quote.plan === 'FLEX' ? 'Flex' : 'Standard'} plan · includes the driver, fuel, airport fee and free waiting.{' '}
            {expired ? 'This price has expired.' : `Price held for ${minutesLeft} more minute${minutesLeft === 1 ? '' : 's'}.`}{' '}
            <a className="underline" href="/terms">
              Terms
            </a>
          </p>
          {expired ? (
            <Button className="w-full" size="lg" onClick={getQuote}>
              Get a new price
            </Button>
          ) : (
            <Button className="w-full" size="lg" onClick={bookAndPay} disabled={busy === 'pay'}>
              {busy === 'pay' ? 'Opening secure payment…' : `Pay ${formatNaira(quote.totalKobo)} with Paystack`}
            </Button>
          )}
        </section>
      )}

      {error && (
        <p className="text-center text-sm text-coral" role="alert">
          {error}
        </p>
      )}
    </Card>
  );
}
