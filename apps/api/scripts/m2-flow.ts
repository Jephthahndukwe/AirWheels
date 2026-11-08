import { PrismaClient } from '@prisma/client';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { FakePayments } from '../src/adapters/fakes';
import { totpCode, totpStep } from '../src/common/auth/totp';

/**
 * M2 end-to-end check against a running API in development mode (CI smoke job and local runs).
 * Needs the M1 flow to have run first (it creates the super admin this script signs in with).
 *
 *   pnpm --filter @airwheels/api flow:m2
 *
 * A traveller quotes, books and pays on our channel (fake Paystack, real webhook path); the
 * booking, legs, quote snapshot and balanced ledger lines are stored; duplicate and out-of-order
 * webhooks change nothing; an expired quote cannot be booked or paid; a refund within the ops
 * limit posts the right ledger lines, one over the limit is refused, a super admin can do it.
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
  let json: Record<string, unknown> = {};
  try {
    json = JSON.parse(text) as Record<string, unknown>;
  } catch {
    /* text */
  }
  return { status: res.status, body: json as Record<string, any> }; // eslint-disable-line @typescript-eslint/no-explicit-any
}

const day = (offset: number) =>
  new Date(Date.now() + offset * 86_400_000 + 3_600_000).toISOString().slice(0, 10);
const lekki = {
  text: '12 Admiralty Way, Lekki Phase 1',
  location: { lat: 6.4452, lng: 3.4741 },
  landmark: 'Opposite the filling station',
};
const quoteBody = {
  legs: [
    { type: 'DEPARTURE', flightNumber: 'P47122', date: day(3), address: lekki },
    { type: 'ARRIVAL', flightNumber: 'P47123', date: day(5), address: lekki },
  ],
  passengers: 1,
  bags: 2,
  rideType: 'PRIVATE',
  plan: 'FLEX',
};
const traveller = { name: 'Ada Obi', phone: '+2348012345678', whatsapp: true };

async function adminToken(): Promise<string> {
  if (!existsSync(SUPER_FILE))
    throw new Error('Run the M1 flow first (pnpm --filter @airwheels/api flow:m1).');
  const sa = JSON.parse(readFileSync(SUPER_FILE, 'utf8')) as {
    email: string;
    password: string;
    secret: string;
  };
  const start = totpStep();
  while (totpStep() === start) await new Promise((r) => setTimeout(r, 1000)); // fresh code, never reused
  const r = await call('POST', '/v1/admin/auth/login', {
    email: sa.email,
    password: sa.password,
    totp: totpCode(sa.secret),
  });
  if (r.status !== 200) throw new Error(`super admin sign-in failed: ${r.status}`);
  return r.body.token as string;
}

async function ledgerBalanced(bookingId: string) {
  const rows = await prisma.ledgerEntry.findMany({ where: { bookingId } });
  const dr = rows.filter((r) => r.direction === 'DEBIT').reduce((s, r) => s + r.amountKobo, 0n);
  const cr = rows.filter((r) => r.direction === 'CREDIT').reduce((s, r) => s + r.amountKobo, 0n);
  return { rows, balanced: dr === cr && rows.length > 0, dr, cr };
}

async function main() {
  // --- quote, book, pay ---
  const q = await call('POST', '/v1/quotes', quoteBody);
  check(
    q.status === 201 && Number.isInteger(q.body.totalKobo),
    `quote returned (${q.status}, ${q.body.totalKobo} kobo)`,
  );
  const legsSum = (q.body.legs as { amountKobo: number; lines: { amountKobo: number }[] }[]).every(
    (l) => l.lines.reduce((s, x) => s + x.amountKobo, 0) === l.amountKobo,
  );
  check(legsSum, 'every leg breakdown adds up to its price');

  const ref = `AW${Date.now().toString(36).toUpperCase()}`.slice(0, 10);
  const key = `idem-${Date.now()}`;
  const book = await call(
    'POST',
    '/v1/bookings',
    { quoteId: q.body.quoteId, airlineBookingReference: ref, traveller },
    { 'idempotency-key': key },
  );
  check(
    book.status === 201 && book.body.status === 'PENDING_PAYMENT',
    `booking created, pending payment (${book.status})`,
  );
  const bookingId = book.body.bookingId as string;
  const payToken = book.body.payToken as string;
  const again = await call(
    'POST',
    '/v1/bookings',
    { quoteId: q.body.quoteId, airlineBookingReference: ref, traveller },
    { 'idempotency-key': key },
  );
  check(again.body.bookingId === bookingId, 'the same request retried returns the same booking');
  const otherKey = await call(
    'POST',
    '/v1/bookings',
    { quoteId: q.body.quoteId, airlineBookingReference: ref, traveller },
    { 'idempotency-key': `${key}-2` },
  );
  check(otherKey.status === 409, 'a quote can be booked only once');

  const pay = await call('POST', `/v1/bookings/${bookingId}/pay`, { payToken });
  check(pay.status === 200 && typeof pay.body.authorizationUrl === 'string', 'payment initialised');
  const pay2 = await call('POST', `/v1/bookings/${bookingId}/pay`, { payToken });
  check(pay2.body.reference === pay.body.reference, 'pressing Pay twice reuses the same payment');
  const badToken = await call('POST', `/v1/bookings/${bookingId}/pay`, {
    payToken: 'x'.repeat(32),
  });
  check(badToken.status === 403, 'paying needs the booking pay token');
  const reference = pay.body.reference as string;

  // A forged webhook is refused.
  const forged = FakePayments.webhook('charge.success', {
    reference,
    amountKobo: 1,
    status: 'success',
    feesKobo: 0,
  });
  const forgedRes = await call(
    'POST',
    '/v1/webhooks/payments',
    undefined,
    { 'x-paystack-signature': 'f'.repeat(128) },
    forged.rawBody,
  );
  check(forgedRes.status === 401, 'a webhook with a bad signature is refused');

  // Out of order: a "failed" webhook for this reference arrives first. Paystack still says pending, so nothing changes.
  const early = FakePayments.webhook('charge.failed', {
    reference,
    amountKobo: 0,
    status: 'failed',
    feesKobo: 0,
  });
  await call(
    'POST',
    '/v1/webhooks/payments',
    undefined,
    { 'x-paystack-signature': early.signature },
    early.rawBody,
  );

  // The traveller pays on the (fake) Paystack page: the real webhook path runs.
  const paid = await call('POST', `/v1/dev/fake-paystack/${reference}/complete`, {
    outcome: 'success',
  });
  check(paid.status === 200, 'payment completed on the checkout page');

  let status = '';
  for (let i = 0; i < 40 && status !== 'CONFIRMED'; i++) {
    status = (await call('GET', `/v1/bookings/${bookingId}?t=${encodeURIComponent(payToken)}`)).body
      .status as string;
    if (status !== 'CONFIRMED') await new Promise((r) => setTimeout(r, 500));
  }
  check(status === 'CONFIRMED', 'the webhook confirmed the booking');

  // Duplicates and a late failure change nothing.
  const fakeTx = {
    reference,
    amountKobo: q.body.totalKobo as number,
    status: 'success',
    feesKobo: 0,
  };
  const dup = FakePayments.webhook('charge.success', fakeTx);
  const d1 = await call(
    'POST',
    '/v1/webhooks/payments',
    undefined,
    { 'x-paystack-signature': dup.signature },
    dup.rawBody,
  );
  const d2 = await call(
    'POST',
    '/v1/webhooks/payments',
    undefined,
    { 'x-paystack-signature': dup.signature },
    dup.rawBody,
  );
  check(
    d2.body.duplicate === true || d1.body.duplicate === true,
    'a repeated webhook is recognised as a duplicate',
  );
  const late = FakePayments.webhook('charge.failed', { ...fakeTx, status: 'failed' });
  await call(
    'POST',
    '/v1/webhooks/payments',
    undefined,
    { 'x-paystack-signature': late.signature },
    late.rawBody,
  );

  // Wait for the queued steps (ledger, message).
  let steps: { step: string; status: string }[] = [];
  for (let i = 0; i < 40; i++) {
    steps = await prisma.bookingStep.findMany({ where: { bookingId } });
    if (steps.filter((s) => s.status === 'DONE').length >= 2) break;
    await new Promise((r) => setTimeout(r, 500));
  }
  check(steps.find((s) => s.step === 'post_ledger')?.status === 'DONE', 'ledger step done');
  check(
    steps.find((s) => s.step === 'notify_confirmed')?.status === 'DONE',
    'confirmation message step done',
  );

  const b = await prisma.transferBooking.findUniqueOrThrow({
    where: { id: bookingId },
    include: { legs: true, paymentIntents: true, quote: true },
  });
  check(b.status === 'CONFIRMED', 'still confirmed after the late failure webhook');
  check(
    b.legs.length === 2 && b.legs.every((l) => l.scheduledAt && l.pickupCodeHash.length === 64),
    'two legs stored with pickup times and pickup codes',
  );
  check(
    b.paymentIntents.length === 1 && b.paymentIntents[0]!.status === 'SUCCEEDED',
    'exactly one payment, succeeded: no second charge',
  );
  check(
    b.quote?.lockedAt &&
      b.quoteSnapshot &&
      (b.quoteSnapshot as { totalKobo: number }).totalKobo === b.amountKobo,
    'quote snapshot stored and locked',
  );
  const bookingsForRef = await prisma.transferBooking.count({
    where: { airlineBookingReference: ref },
  });
  check(bookingsForRef === 1, 'exactly one booking for the reference');

  const l1 = await ledgerBalanced(bookingId);
  check(l1.balanced, `ledger lines for the booking balance (${l1.dr} = ${l1.cr})`);
  const txns = await prisma.ledgerTransaction.count({
    where: { bookingId, kind: 'payment.our_channel' },
  });
  check(txns === 1, 'the payment is in the ledger exactly once');
  const cash = l1.rows.find(
    (r) => r.direction === 'DEBIT' && r.amountKobo === BigInt(b.amountKobo),
  );
  check(!!cash, 'customer payments received is debited with the amount paid');

  // The quote cannot be changed, even directly in the database.
  const tamper = await prisma.quote
    .update({ where: { id: b.quoteId! }, data: { totalKobo: 1 } })
    .then(
      () => 'changed',
      () => 'refused',
    );
  check(tamper === 'refused', 'the quote snapshot cannot be changed in the database');
  const unbalanced = await prisma
    .$transaction(async (t) => {
      const acct = await t.ledgerAccount.findFirstOrThrow();
      const txn = await t.ledgerTransaction.create({
        data: { reference: `bad:${Date.now()}`, kind: 'test' },
      });
      await t.ledgerEntry.create({
        data: {
          transactionId: txn.id,
          accountId: acct.id,
          amountKobo: 100n,
          direction: 'DEBIT',
          reference: 'bad',
        },
      });
    })
    .then(
      () => 'posted',
      () => 'refused',
    );
  check(
    unbalanced === 'refused',
    'the database refuses a ledger transaction that does not balance',
  );

  // --- an expired quote cannot be booked or paid ---
  const q2 = await call('POST', '/v1/quotes', { ...quoteBody, legs: [quoteBody.legs[0]] });
  const b2 = await call(
    'POST',
    '/v1/bookings',
    { quoteId: q2.body.quoteId, airlineBookingReference: `${ref}X`.slice(0, 12), traveller },
    { 'idempotency-key': `${key}-x` },
  );
  const original = await prisma.quote.findUniqueOrThrow({
    where: { id: q2.body.quoteId as string },
  });
  // Quotes are immutable, so make an expired twin of the same price (as if 31 minutes had passed).
  const expired = await prisma.quote.create({
    data: {
      ...original,
      id: undefined,
      lockedAt: null,
      createdAt: undefined,
      updatedAt: undefined,
      request: original.request as object,
      breakdown: original.breakdown as object,
      expiresAt: new Date(Date.now() - 60_000),
    },
  });
  const expiredBook = await call(
    'POST',
    '/v1/bookings',
    { quoteId: expired.id, airlineBookingReference: `${ref}Y`.slice(0, 12), traveller },
    { 'idempotency-key': `${key}-y` },
  );
  check(
    expiredBook.status === 410 && expiredBook.body.code === 'QUOTE_EXPIRED',
    'an expired quote cannot be booked',
  );
  // A booking made in time whose price hold then ran out cannot be paid either.
  await prisma.$executeRaw`ALTER TABLE "Quote" DISABLE TRIGGER quote_immutable`;
  await prisma.quote.update({
    where: { id: original.id },
    data: { expiresAt: new Date(Date.now() - 60_000) },
  });
  await prisma.$executeRaw`ALTER TABLE "Quote" ENABLE TRIGGER quote_immutable`;
  const expiredPay = await call('POST', `/v1/bookings/${b2.body.bookingId}/pay`, {
    payToken: b2.body.payToken,
  });
  check(
    expiredPay.status === 410 && expiredPay.body.code === 'QUOTE_EXPIRED',
    'a booking whose price hold has expired cannot be paid',
  );

  // --- refunds by role ---
  const token = await adminToken();
  const opsLimit = (
    await prisma.configEntry.findFirstOrThrow({
      where: { key: 'refunds.opsAgentLimitKobo' },
      orderBy: { version: 'desc' },
    })
  ).value as number;
  const opsInviteEmail = `ops-m2+${Date.now()}@airwheels.test`;
  const inv = await call(
    'POST',
    '/v1/admin/staff/invites',
    { email: opsInviteEmail, name: 'Ops M2', role: 'OPS_AGENT' },
    { authorization: `Bearer ${token}` },
  );
  const invToken = new URL(inv.body.devLink as string).searchParams.get('token')!;
  const invDetails = await call('GET', `/v1/admin/auth/invites/${invToken}`);
  const accepted = await call('POST', '/v1/admin/auth/invites/accept', {
    token: invToken,
    password: `OpsM2-${Date.now()}!`,
    totp: totpCode(invDetails.body.totpSecret as string),
  });
  const ops = { authorization: `Bearer ${accepted.body.token as string}` };

  const small = Math.min(500_000, opsLimit);
  const r1 = await call(
    'POST',
    `/v1/admin/bookings/${bookingId}/refunds`,
    { amountKobo: small, reason: 'Goodwill for a late driver' },
    ops,
  );
  check(
    r1.status === 201 && r1.body.route === 'PAYSTACK' && r1.body.status === 'COMPLETED',
    `ops refund within the limit goes through Paystack (${r1.status})`,
  );
  const refundTxn = await prisma.ledgerTransaction.findUnique({
    where: { reference: `refund:${r1.body.id}` },
    include: { entries: { include: { account: true } } },
  });
  const lines =
    refundTxn?.entries.map((e) => `${e.direction}:${e.account.code}:${e.amountKobo}`).sort() ?? [];
  check(
    lines.length === 2 &&
      lines[0] === `CREDIT:customer_payments_received:${small}` &&
      lines[1] === `DEBIT:refunds:${small}`,
    'the refund posts Dr refunds / Cr customer payments received',
  );
  const over = await call(
    'POST',
    `/v1/admin/bookings/${bookingId}/refunds`,
    { amountKobo: opsLimit + 100, reason: 'Too much for ops' },
    ops,
  );
  check(
    over.status === 403 && over.body.code === 'REFUND_OVER_LIMIT',
    'an ops refund over the limit is refused',
  );
  const tooBig = await call(
    'POST',
    `/v1/admin/bookings/${bookingId}/refunds`,
    { amountKobo: b.amountKobo, reason: 'More than is left' },
    { authorization: `Bearer ${token}` },
  );
  check(
    tooBig.status === 400 && tooBig.body.code === 'REFUND_TOO_LARGE',
    'a refund larger than what is left is refused',
  );
  const rest = b.amountKobo - small;
  const r2 = await call(
    'POST',
    `/v1/admin/bookings/${bookingId}/refunds`,
    { amountKobo: rest, reason: 'Flight cancelled, full refund' },
    { authorization: `Bearer ${token}` },
  );
  check(r2.status === 201, 'a super admin can refund above the ops limit');
  const final = await prisma.transferBooking.findUniqueOrThrow({ where: { id: bookingId } });
  check(final.status === 'REFUNDED', `fully refunded booking is Refunded (${final.status})`);
  const l2 = await ledgerBalanced(bookingId);
  check(l2.balanced, 'ledger still balances after the refunds');
  const trial = await call('GET', '/v1/admin/ledger/balances', undefined, {
    authorization: `Bearer ${token}`,
  });
  check(trial.body.trialBalance?.balanced === true, 'the whole ledger balances');

  // --- reconciliation finds nothing wrong with this booking ---
  const rec = await call(
    'POST',
    '/v1/admin/payments/reconcile',
    { day: new Date(Date.now() + 3_600_000).toISOString().slice(0, 10) },
    ops,
  );
  const recMismatches = ((rec.body.mismatches as { reference: string }[]) ?? []).filter(
    (m) => m.reference === reference,
  );
  check(
    rec.status === 200 && recMismatches.length === 0,
    'reconciliation matches our payment with Paystack',
  );

  // --- partner channel still posts its sale to the ledger ---
  const audit = await call('GET', `/v1/admin/audit?entityId=${r1.body.id}`, undefined, {
    authorization: `Bearer ${token}`,
  });
  check(
    ((audit.body.items as { action: string }[]) ?? []).some((i) => i.action === 'booking.refund'),
    'the refund is in the audit log',
  );

  await prisma.$disconnect();
  if (failures) {
    console.error(`\n${failures} check(s) failed`);
    process.exit(1);
  }
  console.log('\nM2 flow passed');
}

void main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
