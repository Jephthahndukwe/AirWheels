import Link from 'next/link';
import { notFound } from 'next/navigation';
import { formatNaira } from '@airwheels/types';
import { Footer } from '@/components/footer';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { API_URL } from '@/lib/utils';

/**
 * Tracking page (PRD 7.2, TRV-03). Server-rendered so first load stays small on weak networks.
 * Live map, driver card and WebSocket updates arrive with dispatch (M3/M4).
 */
type TrackingView = {
  status: string;
  receiptOnly: boolean;
  serviceName: string;
  travellerFirstName: string;
  plan: string;
  rideType: string;
  amountKobo: number;
  legs: {
    id: string;
    type: 'DEPARTURE' | 'ARRIVAL';
    status: string;
    pickup: string;
    dropoff: string;
    scheduledAt: string | null;
    pickupCode: string | null;
    flight: { number: string; status: string; estimatedDeparture?: string; estimatedArrival?: string } | null;
  }[];
};

const STEPS = ['SCHEDULED', 'ASSIGNED', 'EN_ROUTE', 'ARRIVED', 'PICKED_UP', 'COMPLETED'];
const STEP_LABEL: Record<string, string> = {
  SCHEDULED: 'Confirmed',
  ASSIGNED: 'Driver assigned',
  EN_ROUTE: 'On the way',
  ARRIVED: 'Outside',
  PICKED_UP: 'On the trip',
  COMPLETED: 'Completed',
};

const lagosTime = (iso: string | null | undefined) =>
  iso
    ? new Intl.DateTimeFormat('en-NG', {
        timeZone: 'Africa/Lagos',
        weekday: 'short',
        hour: 'numeric',
        minute: '2-digit',
      }).format(new Date(iso))
    : 'To be confirmed';

export default async function TrackingPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const res = await fetch(`${API_URL}/v1/t/${encodeURIComponent(token)}`, { cache: 'no-store' }).catch(() => null);
  if (!res || res.status === 404) notFound();
  if (!res.ok) throw new Error('Could not load your booking');
  const view = (await res.json()) as TrackingView;

  return (
    <>
      <p className="text-sm font-bold text-primary">{view.serviceName}</p>
      <h1 className="mb-4 text-2xl font-bold">Hi {view.travellerFirstName}, here is your transfer</h1>

      {view.legs.map((leg) => {
        const current = Math.max(0, STEPS.indexOf(leg.status === 'DRIVER_CONFIRMED' ? 'ASSIGNED' : leg.status));
        return (
          <Card key={leg.id} className="mb-4 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold">{leg.type === 'DEPARTURE' ? 'To the airport' : 'From the airport'}</h2>
              {leg.flight && (
                <span className="rounded-sm bg-muted px-2 py-1 text-xs font-medium">
                  {leg.flight.number} · {leg.flight.status.toLowerCase()}
                </span>
              )}
            </div>
            <p className="text-sm">
              <span className="text-muted-foreground">Pickup:</span> {leg.pickup}
              <br />
              <span className="text-muted-foreground">Drop-off:</span> {leg.dropoff}
            </p>
            <p className="text-sm">
              <span className="text-muted-foreground">Pickup time:</span> <strong>{lagosTime(leg.scheduledAt)}</strong>
            </p>
            {leg.pickupCode && (
              <p className="rounded-md bg-ink p-3 text-center text-white">
                Pickup code <span className="ml-2 text-2xl font-bold tracking-[0.3em]">{leg.pickupCode}</span>
              </p>
            )}
            <ol className="flex flex-wrap gap-2 text-xs">
              {STEPS.map((s, i) => (
                <li
                  key={s}
                  className={i <= current ? 'rounded-sm bg-primary px-2 py-1 text-primary-foreground' : 'rounded-sm bg-muted px-2 py-1'}
                >
                  {STEP_LABEL[s]}
                </li>
              ))}
            </ol>
          </Card>
        );
      })}

      {!view.receiptOnly && view.status !== 'CANCELLED' && (
        <div className="grid grid-cols-2 gap-3">
          <Button variant="outline" asChild>
            <Link href={`/t/${token}/change`}>Change</Link>
          </Button>
          <Button variant="outline" asChild>
            <Link href={`/t/${token}/cancel`}>Cancel</Link>
          </Button>
        </div>
      )}
      <p className="mt-4 text-center text-sm text-muted-foreground">
        {view.plan === 'FLEX' ? 'Flex plan' : 'Standard plan'} · {view.rideType === 'SHARED' ? 'Shared ride' : 'Private car'} ·{' '}
        {formatNaira(view.amountKobo)} · status {view.status.toLowerCase()}
      </p>
      <Footer />
    </>
  );
}
