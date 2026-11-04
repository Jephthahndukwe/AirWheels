import { cancelBooking, changeBooking, flightAlert, getBooking, sendBooking } from './client';

/**
 * pnpm mock:booking                         -> quote + confirm a new booking
 * pnpm --filter @airwheels/mock-airline send get <REF>
 * pnpm --filter @airwheels/mock-airline send change <REF>
 * pnpm --filter @airwheels/mock-airline send cancel <REF>
 * pnpm --filter @airwheels/mock-airline send alert [TIME_SHIFTED|CANCELLED|DEPARTED|LANDED]
 */
const [cmd = 'booking', arg] = process.argv.slice(2);

const run = {
  booking: () => sendBooking(arg),
  get: () => getBooking(need(arg)),
  change: () => changeBooking(need(arg)),
  cancel: () => cancelBooking(need(arg)),
  alert: () => flightAlert((arg as 'TIME_SHIFTED') ?? 'TIME_SHIFTED'),
}[cmd];

function need(v?: string): string {
  if (!v) throw new Error(`Usage: send ${cmd} <AIRLINE_BOOKING_REFERENCE>`);
  return v;
}

if (!run) {
  console.error(`Unknown command "${cmd}". Use booking | get | change | cancel | alert.`);
  process.exit(1);
}

run()
  .then((r) => console.log(JSON.stringify(r, null, 2)))
  .catch((e: Error) => {
    console.error(e.message);
    process.exit(1);
  });
