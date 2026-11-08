import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { FAKE_TERMII_KEY, FAKE_WHATSAPP_APP_SECRET } from '../src/adapters/fakes';
import { termiiSignature } from '../src/adapters/termii';
import { metaSignature } from '../src/adapters/whatsapp-cloud';
import { totpCode, totpStep } from '../src/common/auth/totp';
import { pickupCodeFor } from '../src/modules/traveller-access/codes';

/**
 * M3 end-to-end check of everything the traveller sees after booking, on the fake providers, against
 * a running API in development mode (CI smoke job and local runs). Needs the M1 flow first.
 *
 *   pnpm --filter @airwheels/api flow:m3
 *
 * Covers: the confirmation on WhatsApp (delivered), SMS when WhatsApp fails or is not delivered in
 * time, the 24-hour rule (template outside, free-form inside), the tracking page data, every PRD 7.1
 * message, every PRD 7.3 button and SMS number reply (including repeated and old taps), typed intents
 * and the ops fallback, masked calls with their log, live location, emergency, rating, the six-digit
 * code (cooldown, 5 tries), change and cancel with the cost shown first, and template privacy rules.
 */
const API = process.env.API_PUBLIC_URL ?? 'http://localhost:4000';
const SUPER_FILE = resolve(__dirname, '../../../.storage/flow-super-admin.json');
const prisma = new PrismaClient();

let failures = 0;
function check(cond: unknown, msg: string) {
  if (cond) console.log(`ok - ${msg}`);
  else {
    failures++;
    console.error(`FAIL - ${msg}`);
  }
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = Record<string, any>;
async function call(
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
  raw?: Buffer,
) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    body: raw ? new Uint8Array(raw) : body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json: Json = {};
  try {
    json = JSON.parse(text) as Json;
  } catch {
    /* not json */
  }
  return { status: res.status, body: json };
}

async function until<T>(fn: () => Promise<T>, ok: (v: T) => boolean, ms = 15_000): Promise<T> {
  const end = Date.now() + ms;
  let v = await fn();
  while (!ok(v) && Date.now() < end) {
    await sleep(300);
    v = await fn();
  }
  return v;
}

async function adminToken(): Promise<string> {
  if (!existsSync(SUPER_FILE))
    throw new Error('Run the M1 flow first (pnpm --filter @airwheels/api flow:m1).');
  const sa = JSON.parse(readFileSync(SUPER_FILE, 'utf8')) as {
    email: string;
    password: string;
    secret: string;
  };
  const start = totpStep();
  while (totpStep() === start) await sleep(1000);
  const r = await call('POST', '/v1/admin/auth/login', {
    email: sa.email,
    password: sa.password,
    totp: totpCode(sa.secret),
  });
  if (r.status !== 200) throw new Error(`super admin sign-in failed: ${r.status}`);
  return r.body.token as string;
}

const day = (offset: number) =>
  new Date(Date.now() + offset * 86_400_000 + 3_600_000).toISOString().slice(0, 10);
const lekki = {
  text: '12 Admiralty Way, Lekki Phase 1',
  location: { lat: 6.4452, lng: 3.4741 },
  landmark: 'Blue gate',
};
const phone = (ending: string) =>
  `+23480${String(Math.floor(Math.random() * 1e5)).padStart(5, '0')}${ending}`;

/** Quotes, books and pays on our channel; returns the booking and its tracking token. */
async function bookAndPay(
  tel: string,
  opts: { both?: boolean; days?: number; flight?: string } = {},
) {
  const legs = [
    {
      type: 'DEPARTURE',
      flightNumber: opts.flight ?? 'P47122',
      date: day(opts.days ?? 3),
      address: lekki,
    },
  ];
  if (opts.both)
    legs.push({
      type: 'ARRIVAL',
      flightNumber: 'P47123',
      date: day((opts.days ?? 3) + 2),
      address: lekki,
    });
  const q = await call('POST', '/v1/quotes', {
    legs,
    passengers: 1,
    bags: 1,
    rideType: 'PRIVATE',
    plan: 'STANDARD',
  });
  if (q.status !== 201) throw new Error(`quote failed ${q.status} ${JSON.stringify(q.body)}`);
  const ref = `M3${randomUUID().slice(0, 6).toUpperCase()}`;
  const b = await call(
    'POST',
    '/v1/bookings',
    {
      quoteId: q.body.quoteId,
      airlineBookingReference: ref,
      traveller: { name: 'Ada Nwosu Obi', phone: tel, whatsapp: true },
    },
    { 'idempotency-key': randomUUID() },
  );
  if (b.status !== 201) throw new Error(`booking failed ${b.status} ${JSON.stringify(b.body)}`);
  const pay = await call('POST', `/v1/bookings/${b.body.bookingId}/pay`, {
    payToken: b.body.payToken,
  });
  await call('POST', `/v1/dev/fake-paystack/${pay.body.reference}/complete`, {
    outcome: 'success',
  });
  const token = String(b.body.trackingUrl).split('/t/')[1]!;
  await until(
    () => prisma.transferBooking.findUniqueOrThrow({ where: { id: b.body.bookingId } }),
    (x) => x.status === 'CONFIRMED',
  );
  return { bookingId: b.body.bookingId as string, token, ref };
}

const notes = (bookingId: string, template?: string) =>
  prisma.notification.findMany({
    where: { bookingId, ...(template ? { template } : {}) },
    orderBy: { time: 'asc' },
  });

async function waNote(
  bookingId: string,
  template: string,
  status: string[] = ['DELIVERED', 'READ'],
) {
  return until(
    async () => (await notes(bookingId, template)).find((n) => n.channel === 'WHATSAPP'),
    (n) => !!n && status.includes(n.status),
  );
}

/** Posts a WhatsApp inbound message through the real signed webhook (as Meta would). */
async function waInbound(
  from: string,
  m: { payload?: string; text?: string; contextId?: string; id?: string },
) {
  const message: Json = {
    from: from.slice(1),
    id: m.id ?? `wamid.flow_${randomUUID()}`,
    timestamp: String(Math.floor(Date.now() / 1000)),
  };
  if (m.payload)
    Object.assign(message, { type: 'button', button: { payload: m.payload, text: m.text ?? '' } });
  else Object.assign(message, { type: 'text', text: { body: m.text ?? '' } });
  if (m.contextId) message.context = { id: m.contextId };
  const raw = Buffer.from(
    JSON.stringify({ entry: [{ changes: [{ value: { messages: [message] } }] }] }),
  );
  return call(
    'POST',
    '/v1/webhooks/messaging',
    undefined,
    { 'x-hub-signature-256': metaSignature(raw, FAKE_WHATSAPP_APP_SECRET) },
    raw,
  );
}

async function smsInbound(from: string, text: string) {
  const raw = Buffer.from(
    JSON.stringify({ type: 'inbound', id: randomUUID(), sender: from.slice(1), message: text }),
  );
  return call(
    'POST',
    '/v1/webhooks/sms',
    undefined,
    { 'x-termii-signature': termiiSignature(raw, FAKE_TERMII_KEY) },
    raw,
  );
}

const payloadFor = (n: { id: string; buttons: unknown }, intent: string) =>
  ((n.buttons as { intent: string }[]) ?? []).some((b) => b.intent === intent)
    ? `${intent}|${n.id}`
    : null;

async function activeDriverWithCar() {
  const existing = await prisma.driverProfile.findFirst({
    where: {
      status: 'ACTIVE',
      user: { phone: { not: null } },
      vehicleAssignments: { some: { to: null } },
    },
  });
  if (existing) return existing.id;
  // Test fixture: an active driver with a car (onboarding itself is covered by the M1 flow).
  const tel = phone('77');
  const user = await prisma.user.create({ data: { phone: tel, phoneVerified: true } });
  const d = await prisma.driverProfile.create({
    data: { userId: user.id, firstName: 'Tunde', lastName: 'Bello', status: 'ACTIVE' },
  });
  const v = await prisma.vehicle.create({
    data: {
      plate: `M3-${randomUUID().slice(0, 5).toUpperCase()}`,
      brand: 'Chery',
      model: 'Tiggo 8',
      colour: 'White',
      class: 'SUV',
      seats: 6,
      bagCapacity: 4,
      powerType: 'PETROL',
    },
  });
  await prisma.vehicleAssignment.create({
    data: { vehicleId: v.id, driverId: d.id, from: new Date() },
  });
  return d.id;
}

async function main() {
  const admin = await adminToken();
  const A = { authorization: `Bearer ${admin}` };
  // Short timings for the run (restored at the end): delivery timeout and code resend cooldown.
  const delivery = (await call('GET', '/v1/admin/config', undefined, A)).body as Json;
  const cfg = (k: string) =>
    (Array.isArray(delivery) ? delivery : (delivery.entries ?? [])).find((e: Json) => e.key === k)
      ?.value;
  const originalDelivery = cfg('messaging.delivery') ?? {
    whatsappDeliveryTimeoutSeconds: 120,
    whatsappWindowHours: 24,
    smsAttempts: 3,
  };
  const originalCode = cfg('traveller.changeCode') ?? {
    digits: 6,
    ttlMinutes: 5,
    maxAttempts: 5,
    resendCooldownSeconds: 60,
    grantMinutes: 15,
  };
  await call(
    'PUT',
    '/v1/admin/config/messaging.delivery',
    { value: { ...originalDelivery, whatsappDeliveryTimeoutSeconds: 3 } },
    A,
  );
  await call(
    'PUT',
    '/v1/admin/config/traveller.changeCode',
    { value: { ...originalCode, resendCooldownSeconds: 2 } },
    A,
  );
  // Reruns from one machine would hit the per-IP code request limit (ACC-09); lift it for the run.
  const originalLimits = cfg('rateLimits') as Json;
  if (originalLimits)
    await call(
      'PUT',
      '/v1/admin/config/rateLimits',
      {
        value: {
          ...originalLimits,
          changeCodeRequest: { limit: 100, windowSeconds: 60 },
          changeCodeVerify: { limit: 100, windowSeconds: 60 },
          travellerActions: { limit: 300, windowSeconds: 60 },
        },
      },
      A,
    );

  try {
    // ---------- 1. Confirmation on WhatsApp, delivered (TRV-01, NTF-02) ----------
    const tel = phone('23');
    const a = await bookAndPay(tel, { both: true });
    const conf = await waNote(a.bookingId, 'booking.confirmed');
    check(
      conf?.status === 'DELIVERED' && conf.kind === 'TEMPLATE',
      'confirmation sent by WhatsApp as an approved template and marked delivered',
    );
    check(
      !(await notes(a.bookingId, 'booking.confirmed')).some((n) => n.channel === 'SMS'),
      'no SMS when WhatsApp is delivered',
    );
    const legs = await prisma.rideLeg.findMany({
      where: { bookingId: a.bookingId },
      orderBy: { type: 'asc' },
    });
    const dep = legs.find((l) => l.type === 'DEPARTURE')!;
    const arr = legs.find((l) => l.type === 'ARRIVAL')!;
    const code = pickupCodeFor(dep.id, dep.pickupCodeVersion);
    const out = await call('GET', `/v1/dev/phone/outbox?to=${encodeURIComponent(tel)}`);
    const sentText = (out.body.messages as Json[]).map((m) => m.body).join(' ');
    check(
      sentText.includes(`/t/${a.token}`) && sentText.includes(code),
      'the traveller’s own message carries the tracking link and pickup code',
    );
    check(
      !sentText.includes('Admiralty') && !sentText.includes('Nwosu'),
      'no full address or full name in the message text',
    );
    check(!(conf?.preview ?? '').includes(code), 'the stored preview hides the pickup code');

    // ---------- 2. Tracking page data (TRV-03, ACC-01, ACC-03) ----------
    const view = await call('GET', `/v1/t/${a.token}`);
    check(view.status === 200 && view.body.legs.length === 2, 'tracking link opens the booking');
    check(
      view.body.legs.find((l: Json) => l.id === dep.id)?.pickupCode === code,
      'pickup code shown from its leg',
    );
    check(
      view.body.travellerFirstName === 'Ada' && !JSON.stringify(view.body).includes('Nwosu'),
      'only the first name is on the page',
    );
    check(
      (await call('GET', `/v1/t/${'x'.repeat(32)}`)).status === 404,
      'a wrong token opens nothing',
    );

    // ---------- 3. SMS fallback: WhatsApp fails, or is not delivered in time (NTF-01) ----------
    const failing = await bookAndPay(phone('0000'));
    const fs = await until(
      () => notes(failing.bookingId, 'booking.confirmed'),
      (n) => n.some((x) => x.channel === 'SMS' && x.status !== 'QUEUED'),
    );
    check(
      fs.find((n) => n.channel === 'WHATSAPP')?.status === 'FAILED' &&
        fs.some((n) => n.channel === 'SMS' && ['SENT', 'DELIVERED'].includes(n.status)),
      'WhatsApp failure falls back to SMS',
    );
    const silent = await bookAndPay(phone('0001'));
    const ss = await until(
      () => notes(silent.bookingId, 'booking.confirmed'),
      (n) => n.some((x) => x.channel === 'SMS' && x.status !== 'QUEUED'),
      20_000,
    );
    check(
      ss.find((n) => n.channel === 'WHATSAPP')?.status === 'SENT' &&
        ss.some((n) => n.channel === 'SMS' && !!n.fallbackForId),
      'WhatsApp not delivered in time falls back to SMS',
    );

    // ---------- 4. Driver assigned, confirmed: buttons (TRV-12, TRV-13) ----------
    const driverId = await activeDriverWithCar();
    const as = await call('POST', `/v1/admin/legs/${dep.id}/assign`, { driverId }, A);
    check(as.status === 200, `ops assigns a driver (${as.status})`);
    await call(
      'POST',
      `/v1/admin/legs/${dep.id}/status`,
      { status: 'DRIVER_CONFIRMED', reason: 'driver confirmed by phone' },
      A,
    );
    const assigned = await waNote(a.bookingId, 'driver.assigned');
    check(
      assigned?.kind === 'TEMPLATE',
      'driver message goes as an approved template outside the 24-hour window',
    );
    const confirmPayload = payloadFor(assigned!, 'CONFIRM');
    check(!!confirmPayload, 'driver message has the Confirm button');
    const tapId = `wamid.flow_${randomUUID()}`;
    const tap = await waInbound(tel, {
      payload: confirmPayload!,
      text: 'Confirm',
      id: tapId,
      contextId: assigned!.providerMessageId!,
    });
    check(
      tap.status === 200 &&
        tap.body.replies[0].intent === 'CONFIRM' &&
        tap.body.replies[0].action === 'confirmed',
      'Confirm tap recorded',
    );
    const again = await waInbound(tel, { payload: confirmPayload!, text: 'Confirm', id: tapId });
    check(
      again.body.replies[0].duplicate === true,
      'the same tap delivered twice is recorded once',
    );
    check(
      (await prisma.bookingEvent.count({
        where: { bookingId: a.bookingId, type: 'traveller.confirmed' },
      })) === 1,
      'one Confirm event',
    );
    const page = await call('GET', `/v1/t/${a.token}`);
    check(
      page.body.lastReply?.intent === 'CONFIRM',
      'the tracking page shows the reply was recorded',
    );
    const tamper = await call(
      'POST',
      '/v1/webhooks/messaging',
      undefined,
      { 'x-hub-signature-256': 'sha256=00' },
      Buffer.from('{}'),
    );
    check(tamper.status === 403, 'an unsigned webhook is refused');

    // Change time button sends the link inside the (now open) 24-hour window.
    await waInbound(tel, { payload: payloadFor(assigned!, 'CHANGE_TIME')!, text: 'Change time' });
    const link = await waNote(a.bookingId, 'reply.link', ['SENT', 'DELIVERED', 'READ']);
    check(link?.kind === 'SESSION', 'inside the window a free-form reply is sent');

    // ---------- 5. On the way, live location, arrived (TRV-04, both channels) ----------
    await call(
      'POST',
      `/v1/admin/legs/${dep.id}/status`,
      { status: 'EN_ROUTE', minutesAway: 15, reason: 'test' },
      A,
    );
    check(!!(await waNote(a.bookingId, 'driver.en_route')), 'driver on the way message delivered');
    await prisma.locationPing.create({
      data: { driverId, legId: dep.id, lat: 6.46, lng: 3.5, time: new Date() },
    });
    const live = await call('GET', `/v1/t/${a.token}`);
    const liveLeg = live.body.legs.find((l: Json) => l.id === dep.id);
    check(
      liveLeg.live?.location?.lat === 6.46 && Number.isInteger(liveLeg.live?.etaMinutes),
      'tracking page has the live location and ETA',
    );
    check(
      liveLeg.driver?.firstName && liveLeg.driver?.plate,
      'driver card shows first name, car and plate',
    );

    await call('POST', `/v1/admin/legs/${dep.id}/status`, { status: 'ARRIVED', reason: 'test' }, A);
    const arrived = await until(
      () => notes(a.bookingId, 'driver.arrived'),
      (n) => n.filter((x) => x.status !== 'QUEUED').length >= 2,
    );
    check(
      arrived.some((n) => n.channel === 'WHATSAPP') && arrived.some((n) => n.channel === 'SMS'),
      'driver outside goes by WhatsApp and SMS',
    );
    const arrivedWa = arrived.find((n) => n.channel === 'WHATSAPP')!;
    check(arrivedWa.kind === 'SESSION', 'after the traveller wrote, messages use the open window');
    const out2 = await call('GET', `/v1/dev/phone/outbox?to=${encodeURIComponent(tel)}`);
    const sms = (out2.body.messages as Json[]).find((m) => m.channel === 'SMS');
    check(String(sms?.body).includes("Reply 1 for I'm coming out"), 'SMS says "Reply 1 for ..."');

    const comingOut = await waInbound(tel, {
      payload: payloadFor(arrivedWa, 'COMING_OUT')!,
      text: "I'm coming out",
    });
    check(
      comingOut.body.replies[0].action === 'signal',
      "I'm coming out recorded as a driver signal",
    );
    const smsTwo = await smsInbound(tel, '2');
    check(
      smsTwo.body.replies[0].intent === 'FIVE_MINUTES',
      'SMS reply 2 maps to Give me 5 minutes',
    );
    const typed = await waInbound(tel, { text: 'coming now' });
    check(typed.body.replies[0].intent === 'COMING_OUT', 'typed "coming" matched');
    const unclear = await waInbound(tel, { text: 'Please can the driver buy me suya' });
    check(unclear.body.replies[0].action === 'routed_to_ops', 'anything unclear goes to ops');
    check(
      (await prisma.opsAlert.count({
        where: { bookingId: a.bookingId, type: 'TRAVELLER_MESSAGE' },
      })) >= 1,
      'ops has the message',
    );

    const callTap = await waInbound(tel, {
      payload: payloadFor(arrivedWa, 'CALL_DRIVER')!,
      text: 'Call driver',
    });
    check(callTap.body.replies[0].action === 'call_started', 'Call driver starts a masked call');
    const log = await until(
      () => prisma.callLog.findFirst({ where: { legId: dep.id }, orderBy: { time: 'desc' } }),
      (c) => c?.durationSeconds === 42,
    );
    check(
      log?.outcome === 'SUCCESS' && log.durationSeconds === 42,
      'the call attempt is logged with its outcome (TRV-05)',
    );
    const pageCall = await call('POST', `/v1/t/${a.token}/call`, { legId: dep.id });
    check(
      pageCall.status === 200 && pageCall.body.status === 'RINGING',
      'the tracking page can start a masked call',
    );

    await call(
      'POST',
      `/v1/admin/legs/${dep.id}/status`,
      { status: 'PICKED_UP', reason: 'pickup code entered' },
      A,
    );
    const sos = await call('POST', `/v1/t/${a.token}/emergency`, {
      legId: dep.id,
      lat: 6.45,
      lng: 3.47,
    });
    check(
      sos.status === 200 &&
        (await prisma.opsAlert.count({ where: { bookingId: a.bookingId, type: 'EMERGENCY' } })) ===
          1,
      'emergency alerts ops with location (TRV-06)',
    );

    // ---------- 6. Trip complete: rating, report, old taps (TRV-08) ----------
    await call(
      'POST',
      `/v1/admin/legs/${dep.id}/status`,
      { status: 'COMPLETED', reason: 'dropped off' },
      A,
    );
    const thanks = await waNote(a.bookingId, 'trip.completed');
    await waInbound(tel, { payload: payloadFor(thanks!, 'RATE_5')!, text: 'Rate 5 stars' });
    check(
      (await prisma.rating.findUnique({ where: { legId: dep.id } }))?.score === 5,
      'Rate 5 stars stored',
    );
    const old = await waInbound(tel, {
      payload: payloadFor(arrivedWa, 'COMING_OUT')!,
      text: "I'm coming out",
    });
    check(
      old.body.replies[0].action === 'ignored_closed_leg',
      'a tap on an old message after the trip changes nothing',
    );
    const rate = await call('POST', `/v1/t/${a.token}/rating`, {
      legId: dep.id,
      score: 4,
      comment: 'Good',
    });
    check(
      rate.status === 200 &&
        (await prisma.rating.findUnique({ where: { legId: dep.id } }))?.score === 4,
      'rating from the tracking page',
    );
    await waInbound(tel, {
      payload: payloadFor(thanks!, 'REPORT_PROBLEM')!,
      text: 'Report a problem',
    });
    check(
      (await prisma.opsAlert.count({
        where: { bookingId: a.bookingId, type: 'SUPPORT_REQUEST' },
      })) === 1,
      'Report a problem opens a support case',
    );

    // ---------- 7. Arrival leg: before boarding, landed signal, driver details ----------
    await call(
      'POST',
      `/v1/admin/bookings/${a.bookingId}/messages`,
      { event: 'arrival.confirmed', legId: arr.id },
      A,
    );
    const arrConf = await waNote(a.bookingId, 'arrival.confirmed');
    await call('POST', `/v1/admin/legs/${arr.id}/assign`, { driverId }, A);
    const arrDriver = await waNote(a.bookingId, 'arrival.driver_assigned');
    check(
      !!arrDriver && payloadFor(arrDriver, 'GETTING_BAGS') !== null,
      'arrival driver message with its buttons',
    );
    const landed = await waInbound(tel, {
      payload: payloadFor(arrConf!, 'LANDED')!,
      text: "I've landed",
    });
    check(
      landed.body.replies[0].action === 'signal',
      "I've landed recorded as a backup landing signal",
    );
    const bags = await waInbound(tel, {
      payload: payloadFor(arrDriver!, 'GETTING_BAGS')!,
      text: 'Getting my bags',
    });
    const meet = await waInbound(tel, {
      payload: payloadFor(arrDriver!, 'AT_MEETING_POINT')!,
      text: "I'm at meeting point",
    });
    check(
      bags.body.replies[0].action === 'signal' && meet.body.replies[0].action === 'signal',
      'arrival buttons recorded as driver signals',
    );

    // ---------- 8. Every PRD 7.1 message is sendable (ops sends the rest) ----------
    const rest = [
      'pickup_time.set',
      'flight.landed',
      'flight.changed',
      'driver.replaced',
      'shared.confirmed',
      'shared.locked',
      'shared.no_match',
      'shared.group_changed',
      'pickup_time.changed',
    ];
    for (const event of rest)
      await call(
        'POST',
        `/v1/admin/bookings/${a.bookingId}/messages`,
        { event, legId: arr.id, reason: 'test' },
        A,
      );
    const all = await until(
      () => notes(a.bookingId),
      (n) => rest.every((e) => n.some((x) => x.template === e && x.status !== 'QUEUED')),
    );
    check(
      rest.every((e) => all.some((x) => x.template === e && x.status !== 'QUEUED')),
      'every PRD 7.1 message (including shared rides) is sent',
    );
    const leaked = all.filter(
      (n) =>
        n.preview?.includes(code) ||
        n.preview?.includes(pickupCodeFor(arr.id, arr.pickupCodeVersion)),
    );
    check(leaked.length === 0, 'no stored preview contains a pickup code');
    const msgs = await call('GET', `/v1/admin/bookings/${a.bookingId}/messages`, undefined, A);
    check(
      msgs.body.notifications.length >= 10 && msgs.body.replies.length >= 8,
      'ops sees messages with status, and replies',
    );

    // ---------- 9. Six-digit code, change and cancel (ACC-02, TRV-07) ----------
    const b = await bookAndPay(phone('45'), { days: 4 });
    const bLeg = await prisma.rideLeg.findFirstOrThrow({ where: { bookingId: b.bookingId } });
    const c1 = await call('POST', `/v1/t/${b.token}/code`);
    if (c1.status !== 200) console.error(c1.status, c1.body);
    check(c1.status === 200 && /^\d{6}$/.test(c1.body.devCode), 'code sent to the booking phone');
    const c2 = await call('POST', `/v1/t/${b.token}/code`);
    check(c2.status === 429, 'resend is held back by the cooldown');
    check(
      (await waNote(b.bookingId, 'change.code', ['SENT', 'DELIVERED', 'READ'])) !== undefined,
      'the code went to the phone',
    );
    const noGrant = await call('POST', `/v1/t/${b.token}/cancel`, { grant: 'x'.repeat(32) });
    check(noGrant.status === 403, 'change and cancel need the code first');
    const wrong = c1.body.devCode === '000000' ? '111111' : '000000';
    let last: Json = {};
    for (let i = 0; i < 5; i++)
      last = (await call('POST', `/v1/t/${b.token}/code/verify`, { code: wrong })).body;
    check(last.code === 'CODE_LOCKED', 'five wrong tries lock the code');
    const lockedRight = await call('POST', `/v1/t/${b.token}/code/verify`, {
      code: c1.body.devCode,
    });
    check(lockedRight.status === 400, 'even the right code fails once locked');
    await sleep(2100);
    const c3 = await call('POST', `/v1/t/${b.token}/code`);
    const ok = await call('POST', `/v1/t/${b.token}/code/verify`, { code: c3.body.devCode });
    check(ok.status === 200 && typeof ok.body.grant === 'string', 'a new code works');
    const grant = ok.body.grant as string;

    const newTime = new Date(new Date(bLeg.scheduledAt!).getTime() - 30 * 60_000).toISOString();
    const prev = await call('POST', `/v1/t/${b.token}/changes`, {
      grant,
      legId: bLeg.id,
      kind: 'CHANGE_TIME',
      pickupAt: newTime,
    });
    check(
      prev.status === 200 &&
        prev.body.preview &&
        prev.body.decision.allowed &&
        prev.body.decision.feeKobo === 0,
      'the cost of a change is shown first (free well ahead)',
    );
    const unchanged = await prisma.rideLeg.findUniqueOrThrow({ where: { id: bLeg.id } });
    check(
      unchanged.scheduledAt?.getTime() === bLeg.scheduledAt?.getTime(),
      'a preview changes nothing',
    );
    const applied = await call('POST', `/v1/t/${b.token}/changes`, {
      grant,
      legId: bLeg.id,
      kind: 'CHANGE_TIME',
      pickupAt: newTime,
      apply: true,
      acceptFeeKobo: 0,
    });
    check(
      applied.status === 200 &&
        (
          await prisma.rideLeg.findUniqueOrThrow({ where: { id: bLeg.id } })
        ).scheduledAt?.toISOString() === newTime,
      'the pickup time changed',
    );
    check(
      !!(await waNote(b.bookingId, 'pickup_time.changed', ['SENT', 'DELIVERED', 'READ'])),
      'the traveller is told the new time',
    );
    check(
      (await prisma.policyDecision.count({ where: { bookingId: b.bookingId } })) >= 1,
      'the decision is logged with its rule version',
    );

    const cprev = await call('POST', `/v1/t/${b.token}/cancel`, { grant });
    check(
      cprev.status === 200 && cprev.body.allowed && cprev.body.refundKobo === cprev.body.paidKobo,
      'cancel shows a full refund well ahead',
    );
    const stale = await call('POST', `/v1/t/${b.token}/cancel`, {
      grant,
      apply: true,
      acceptRefundKobo: 1,
    });
    check(
      stale.status === 400 && stale.body.code === 'COST_CHANGED',
      'confirming a different amount than the current one is refused',
    );
    const cancel = await call('POST', `/v1/t/${b.token}/cancel`, {
      grant,
      apply: true,
      acceptRefundKobo: cprev.body.refundKobo,
    });
    check(
      cancel.status === 200 && cancel.body.refundKobo === cprev.body.refundKobo,
      'cancelled with the refund shown',
    );
    const bk = await prisma.transferBooking.findUniqueOrThrow({
      where: { id: b.bookingId },
      include: { refunds: true },
    });
    check(
      ['REFUNDING', 'REFUNDED'].includes(bk.status) && bk.refunds[0]?.issuedByRole === 'SYSTEM',
      `booking refunded by the policy (${bk.status})`,
    );
    check(
      !!(await waNote(b.bookingId, 'booking.cancelled', ['SENT', 'DELIVERED', 'READ'])),
      'cancellation message sent',
    );
    check(
      (await call('GET', `/v1/t/${b.token}`)).body.status !== 'CONFIRMED',
      'the page shows the cancellation',
    );

    // ---------- 10. Template rules ----------
    const unsafe = await call(
      'POST',
      '/v1/admin/message-templates',
      {
        airlineId: null,
        event: 'booking.confirmed',
        channel: 'SMS',
        body: 'Hi {{fullName}} at {{pickupAddress}}',
      },
      A,
    );
    check(
      unsafe.status === 400 && unsafe.body.code === 'TEMPLATE_UNSAFE',
      'a template with a full name or address is refused',
    );
    const codeLeak = await call(
      'POST',
      '/v1/admin/message-templates',
      { airlineId: null, event: 'driver.en_route', channel: 'SMS', body: 'Code {{pickupCode}}' },
      A,
    );
    check(codeLeak.status === 400, 'a pickup code is refused outside the traveller’s own messages');
    const wa = await call(
      'POST',
      '/v1/admin/message-templates',
      {
        airlineId: null,
        event: 'flight.landed',
        channel: 'WHATSAPP',
        body: '{{serviceName}}: welcome, {{firstName}}. Meet at {{meetingPoint}}. {{trackingUrl}}',
      },
      A,
    );
    check(
      wa.status === 201 && wa.body.approved === false,
      'a new WhatsApp version waits for Meta approval',
    );
  } finally {
    await call('PUT', '/v1/admin/config/messaging.delivery', { value: originalDelivery }, A);
    await call('PUT', '/v1/admin/config/traveller.changeCode', { value: originalCode }, A);
    if (originalLimits)
      await call('PUT', '/v1/admin/config/rateLimits', { value: originalLimits }, A);
  }

  console.log(failures === 0 ? '\nM3 flow passed' : `\nM3 flow: ${failures} failed`);
  await prisma.$disconnect();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
