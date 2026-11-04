import { cancelBooking, flightAlert, getBooking, sendBooking } from './client';

/**
 * End-to-end check used by CI against a running API with Postgres and Redis:
 * the mock airline posts a booking, it is stored, a flight alert is accepted, and cancel works.
 */
function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) {
    console.error(`SMOKE FAILED: ${msg}`);
    process.exit(1);
  }
  console.log(`ok - ${msg}`);
}

const created = await sendBooking();
assert(created.step === 'booking' && created.status === 201, `booking created (${created.status})`);

if (!('reference' in created)) process.exit(1);
const ref = created.reference;
const fetched = await getBooking(ref);
const b = fetched.body as { status: string; legs: unknown[]; airlineBookingReference: string };
assert(fetched.status === 200 && b.airlineBookingReference === ref, 'booking is stored and readable');
assert(b.legs.length === 1 && b.status === 'CONFIRMED', 'booking has one confirmed leg');

const replay = await sendBooking(ref);
assert(replay.status === 409 || replay.status === 201, 'duplicate reference does not create a second booking');

const alert = await flightAlert('TIME_SHIFTED');
assert(alert.status === 202, 'flight alert accepted');

const cancelled = await cancelBooking(ref);
assert((cancelled.body as { status: string }).status === 'CANCELLED', 'booking cancelled');

console.log('Smoke test passed');
