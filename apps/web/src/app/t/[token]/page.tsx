import { notFound } from 'next/navigation';
import { formatNaira } from '@airwheels/types';
import { Footer } from '@/components/footer';
import { API_URL } from '@/lib/utils';
import { CallDriver, Emergency, Rate } from './actions';
import { LiveMap, LiveUpdates } from './live';

/**
 * Tracking page (PRD 7.2, TRV-03 to TRV-09). Server-rendered with plain HTML and a few small client
 * islands, so the first load stays well under 200 KB on a low-end phone on a slow network. Live
 * updates come over a WebSocket, with polling when that is not available.
 */
export const dynamic = 'force-dynamic';

type Point = { lat: number; lng: number };
type Leg = {
  id: string;
  type: 'DEPARTURE' | 'ARRIVAL';
  status: string;
  rideType: 'PRIVATE' | 'SHARED';
  pickup: string;
  pickupLandmark: string | null;
  dropoff: string;
  dropoffLandmark: string | null;
  pickupPoint: Point;
  dropoffPoint: Point;
  scheduledAt: string | null;
  amountKobo: number;
  pickupCode: string | null;
  pickupCodeLocked: boolean;
  driver: {
    firstName: string;
    photoUrl: string | null;
    rating: number | null;
    car: string | null;
    colour: string | null;
    plate: string | null;
  } | null;
  live: { location: (Point & { at: string }) | null; etaMinutes: number | null } | null;
  shared: {
    stopNumber: number | null;
    stopCount: number | null;
    stopsDone: number;
    plannedTime: string | null;
  } | null;
  flight: {
    number: string;
    status: string;
    estimatedDeparture: string | null;
    estimatedArrival: string | null;
  } | null;
  rating: { score: number } | null;
};
type View = {
  bookingId: string;
  reference: string;
  status: string;
  receiptOnly: boolean;
  serviceName: string;
  theme: { primary: string | null } | null;
  operator: string;
  travellerFirstName: string;
  plan: string;
  rideType: string;
  amountKobo: number;
  refundedKobo: number;
  bookedAt: string;
  support: { phone: string; whatsapp: string };
  lastReply: { intent: string; at: string } | null;
  legs: Leg[];
};

const STEPS = ['SCHEDULED', 'ASSIGNED', 'EN_ROUTE', 'ARRIVED', 'PICKED_UP', 'COMPLETED'] as const;
const STEP_LABEL: Record<(typeof STEPS)[number], string> = {
  SCHEDULED: 'Confirmed',
  ASSIGNED: 'Driver assigned',
  EN_ROUTE: 'On the way',
  ARRIVED: 'Outside',
  PICKED_UP: 'On the trip',
  COMPLETED: 'Completed',
};
const REPLY_LABEL: Record<string, string> = {
  CONFIRM: 'You confirmed your driver',
  COMING_OUT: "You told your driver you're coming out",
  FIVE_MINUTES: 'You asked your driver for 5 minutes',
  GETTING_BAGS: "You told your driver you're getting your bags",
  AT_MEETING_POINT: "You told your driver you're at the meeting point",
  LANDED: 'You told us you have landed',
  RATE_5: 'You rated your ride 5 stars',
  REPORT_PROBLEM: 'You reported a problem. Support will contact you',
  CHANGE_TIME: 'You asked to change your time',
  CANCEL: 'You asked to cancel',
  CALL_DRIVER: 'You asked to call your driver',
  UNMATCHED: 'Your message went to our support team',
};

const lagos = (iso: string | null | undefined, withDay = true) =>
  iso
    ? new Intl.DateTimeFormat('en-NG', {
        timeZone: 'Africa/Lagos',
        ...(withDay ? { weekday: 'short', day: 'numeric', month: 'short' } : {}),
        hour: 'numeric',
        minute: '2-digit',
      }).format(new Date(iso))
    : 'To be confirmed';

const RIDING = ['EN_ROUTE', 'ARRIVED', 'PICKED_UP'];

export default async function TrackingPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const res = await fetch(`${API_URL}/v1/t/${encodeURIComponent(token)}`, {
    cache: 'no-store',
  }).catch(() => null);
  if (!res || res.status === 404) notFound();
  if (!res.ok) throw new Error('Could not load your booking');
  const v = (await res.json()) as View;
  const cancelled = ['CANCELLED', 'REFUNDING', 'REFUNDED'].includes(v.status);
  const canChange = !v.receiptOnly && ['CONFIRMED', 'PENDING_PAYMENT'].includes(v.status);
  const accent =
    v.theme?.primary && /^#[0-9a-fA-F]{3,8}$/.test(v.theme.primary) ? v.theme.primary : undefined;

  return (
    <div style={accent ? ({ '--aw-primary': accent } as React.CSSProperties) : undefined}>
      {!v.receiptOnly && !cancelled && (
        <LiveUpdates bookingId={v.bookingId} token={token} pollSeconds={20} />
      )}
      <p className="text-sm font-bold text-primary">{v.serviceName}</p>
      <h1 className="mb-1 text-2xl font-bold">Hi {v.travellerFirstName}, here is your transfer</h1>
      <p className="mb-4 text-xs text-muted-foreground">Booking {v.reference}</p>

      {cancelled && (
        <p className="mb-4 rounded-md bg-muted p-3 text-sm font-semibold">
          This booking is cancelled.
        </p>
      )}
      {v.lastReply && REPLY_LABEL[v.lastReply.intent] && (
        <p className="mb-4 rounded-md bg-white p-3 text-sm" data-testid="last-reply">
          ✓ {REPLY_LABEL[v.lastReply.intent]} ({lagos(v.lastReply.at, false)})
        </p>
      )}

      {v.legs.map((leg) => {
        const status = leg.status === 'DRIVER_CONFIRMED' ? 'ASSIGNED' : leg.status;
        const current = Math.max(0, STEPS.indexOf(status as (typeof STEPS)[number]));
        const riding = RIDING.includes(leg.status);
        const done = leg.status === 'COMPLETED';
        return (
          <section
            key={leg.id}
            className="mb-4 space-y-3 rounded-lg border border-border bg-white p-4"
            aria-label={leg.type === 'DEPARTURE' ? 'To the airport' : 'From the airport'}
          >
            <div className="flex items-center justify-between gap-2">
              <h2 className="font-semibold">
                {leg.type === 'DEPARTURE' ? 'To the airport' : 'From the airport'}
              </h2>
              {leg.flight && (
                <span className="rounded-sm bg-muted px-2 py-1 text-xs font-medium">
                  {leg.flight.number} · {leg.flight.status.toLowerCase()}
                </span>
              )}
            </div>

            {leg.status !== 'CANCELLED' && (
              <ol
                className="grid grid-cols-6 gap-1 text-[10px] leading-tight"
                aria-label="Progress"
              >
                {STEPS.map((s, i) => (
                  <li key={s} aria-current={i === current ? 'step' : undefined}>
                    <span
                      className={`mb-1 block h-1.5 rounded-full ${i <= current ? 'bg-primary' : 'bg-muted'}`}
                    />
                    <span className={i === current ? 'font-semibold' : 'text-muted-foreground'}>
                      {STEP_LABEL[s]}
                    </span>
                  </li>
                ))}
              </ol>
            )}

            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
              <dt className="text-muted-foreground">Pickup</dt>
              <dd>
                {leg.pickup}
                {leg.pickupLandmark && (
                  <span className="block text-xs text-muted-foreground">{leg.pickupLandmark}</span>
                )}
              </dd>
              <dt className="text-muted-foreground">Drop-off</dt>
              <dd>{leg.dropoff}</dd>
              <dt className="text-muted-foreground">Pickup time</dt>
              <dd className="font-semibold">{lagos(leg.shared?.plannedTime ?? leg.scheduledAt)}</dd>
              {leg.flight && (
                <>
                  <dt className="text-muted-foreground">Flight</dt>
                  <dd>
                    {leg.type === 'DEPARTURE'
                      ? `Departs ${lagos(leg.flight.estimatedDeparture, false)}`
                      : `Lands ${lagos(leg.flight.estimatedArrival, false)}`}
                  </dd>
                </>
              )}
            </dl>

            {leg.shared && (
              <p className="rounded-md bg-muted p-3 text-sm">
                Shared ride
                {leg.shared.stopNumber
                  ? `: you are stop ${leg.shared.stopNumber}${leg.shared.stopCount ? ` of ${leg.shared.stopCount}` : ''}. ${leg.shared.stopsDone ? `${leg.shared.stopsDone} earlier stop${leg.shared.stopsDone > 1 ? 's' : ''} done.` : ''}`
                  : '. We are matching you with up to 2 travellers going your way. No match means a private car at the same price.'}
              </p>
            )}

            {leg.driver && (
              <div
                className="flex items-center gap-3 rounded-md bg-cloud p-3"
                data-testid="driver-card"
              >
                {leg.driver.photoUrl ? (
                  <img
                    src={leg.driver.photoUrl}
                    alt=""
                    width={56}
                    height={56}
                    loading="lazy"
                    className="h-14 w-14 rounded-full object-cover"
                  />
                ) : (
                  <span className="flex h-14 w-14 items-center justify-center rounded-full bg-ink text-xl font-bold text-white">
                    {leg.driver.firstName[0]}
                  </span>
                )}
                <div className="text-sm">
                  <p className="font-semibold">
                    {leg.driver.firstName}
                    {leg.driver.rating ? ` · ★ ${leg.driver.rating.toFixed(1)}` : ''}
                  </p>
                  <p>{[leg.driver.colour, leg.driver.car].filter(Boolean).join(' ')}</p>
                  {leg.driver.plate && (
                    <p className="font-mono font-bold tracking-wider">{leg.driver.plate}</p>
                  )}
                </div>
              </div>
            )}

            {leg.live && leg.status !== 'PICKED_UP' && (
              <LiveMap
                legId={leg.id}
                initial={leg.live.location}
                target={leg.pickupPoint}
                etaMinutes={leg.live.etaMinutes}
              />
            )}

            {leg.pickupCode && !done && (
              <div
                className="rounded-md bg-ink p-3 text-center text-white"
                data-testid="pickup-code"
              >
                <p className="text-xs">Pickup code. Give it to your driver only.</p>
                <p className="text-3xl font-bold tracking-[0.4em]">{leg.pickupCode}</p>
                {leg.pickupCodeLocked && (
                  <p className="mt-1 text-xs">
                    Too many wrong tries. Support will call you with a new code.
                  </p>
                )}
              </div>
            )}

            {!v.receiptOnly && !done && leg.status !== 'CANCELLED' && (
              <div className="grid grid-cols-2 gap-2">
                <CallDriver token={token} legId={leg.id} />
                <a
                  className="inline-flex h-11 items-center justify-center rounded-md border border-border bg-white text-sm font-semibold"
                  href={`tel:${v.support.phone}`}
                >
                  Call support
                </a>
                <a
                  className="col-span-2 inline-flex h-11 items-center justify-center rounded-md border border-border bg-white text-sm font-semibold"
                  href={`https://wa.me/${v.support.whatsapp}?text=${encodeURIComponent(`Booking ${v.reference}`)}`}
                >
                  WhatsApp support
                </a>
                {riding && (
                  <div className="col-span-2">
                    <Emergency token={token} legId={leg.id} />
                  </div>
                )}
              </div>
            )}

            {done && (
              <div className="space-y-3 border-t border-border pt-3">
                <h3 className="text-sm font-semibold">How was your ride?</h3>
                <Rate token={token} legId={leg.id} current={leg.rating?.score ?? null} />
              </div>
            )}
          </section>
        );
      })}

      {canChange && (
        <div className="grid grid-cols-2 gap-3">
          <a
            className="inline-flex h-11 items-center justify-center rounded-md border border-border bg-white text-sm font-semibold"
            href={`/t/${token}/change`}
          >
            Change
          </a>
          <a
            className="inline-flex h-11 items-center justify-center rounded-md border border-border bg-white text-sm font-semibold"
            href={`/t/${token}/cancel`}
          >
            Cancel
          </a>
        </div>
      )}

      <section
        className="mt-4 rounded-lg border border-border bg-white p-4 text-sm"
        aria-label="Receipt"
      >
        <h2 className="mb-2 font-semibold">Receipt</h2>
        <dl className="grid grid-cols-[1fr_auto] gap-y-1">
          {v.legs.map((l) => (
            <div key={l.id} className="contents">
              <dt>{l.type === 'DEPARTURE' ? 'To the airport' : 'From the airport'}</dt>
              <dd>{formatNaira(l.amountKobo)}</dd>
            </div>
          ))}
          <dt className="font-semibold">Total</dt>
          <dd className="font-semibold">{formatNaira(v.amountKobo)}</dd>
          {v.refundedKobo > 0 && (
            <>
              <dt>Refunded</dt>
              <dd>−{formatNaira(v.refundedKobo)}</dd>
            </>
          )}
        </dl>
        <p className="mt-2 text-xs text-muted-foreground">
          {v.plan === 'FLEX' ? 'Flex plan' : 'Standard plan'} ·{' '}
          {v.rideType === 'SHARED' ? 'Shared ride' : 'Private car'} · booked {lagos(v.bookedAt)}
        </p>
        {v.receiptOnly && <p className="mt-2 text-xs">This link now shows your receipt only.</p>}
      </section>
      <Footer />
    </div>
  );
}
