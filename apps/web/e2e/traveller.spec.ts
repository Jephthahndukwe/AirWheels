import { type CDPSession, expect, test } from '@playwright/test';
import { createHmac, randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * The M3 traveller journey in a real browser, on a low-end phone over a slow network, against a
 * running API with fake providers (the CI smoke job; skipped when no API is running).
 *
 * After a test booking: the confirmation arrives on (fake) WhatsApp; the tracking page loads under
 * 200 KB (TRV-09); the traveller taps a reply button and sees it recorded; they change, then cancel,
 * with the six-digit code, seeing the cost before confirming.
 */
const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
const SUPER_FILE = resolve(__dirname, '../../../.storage/flow-super-admin.json');

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = Record<string, any>;
async function call(
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json().catch(() => ({}))) as Json };
}

let apiUp = false;
let A: Record<string, string> = {};
let restore: { key: string; value: unknown }[] = [];
test.beforeAll(async () => {
  apiUp = await fetch(`${API}/v1/health`)
    .then((r) => r.ok)
    .catch(() => false);
  if (!apiUp || !existsSync(SUPER_FILE)) return;
  A = await admin();
  // Earlier runs from the same machine (the M3 flow in CI) use the per-IP code limits (ACC-09);
  // lift them and the resend cooldown for this run, and put them back afterwards.
  const list = (await call('GET', '/v1/admin/config', undefined, A)).body;
  const entries = (Array.isArray(list) ? list : (list.entries ?? [])) as Json[];
  const get = (k: string) => entries.find((e) => e.key === k)?.value as Json | undefined;
  const limits = get('rateLimits');
  const code = get('traveller.changeCode');
  if (limits) {
    restore.push({ key: 'rateLimits', value: limits });
    await call(
      'PUT',
      '/v1/admin/config/rateLimits',
      {
        value: {
          ...limits,
          changeCodeRequest: { limit: 100, windowSeconds: 60 },
          changeCodeVerify: { limit: 100, windowSeconds: 60 },
          travellerActions: { limit: 300, windowSeconds: 60 },
        },
      },
      A,
    );
  }
  if (code) {
    restore.push({ key: 'traveller.changeCode', value: code });
    await call(
      'PUT',
      '/v1/admin/config/traveller.changeCode',
      {
        value: { ...code, resendCooldownSeconds: 2 },
      },
      A,
    );
  }
});
test.afterAll(async () => {
  for (const r of restore) await call('PUT', `/v1/admin/config/${r.key}`, { value: r.value }, A);
  restore = [];
});
test.beforeEach(() => {
  test.skip(
    !apiUp || !existsSync(SUPER_FILE),
    'needs a running API in development mode and the M1 flow',
  );
});

function totp(secretB32: string, step: number) {
  const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const ch of secretB32.replace(/=+$/, '').toUpperCase()) {
    value = ((value << 5) | A.indexOf(ch)) & 0xffff;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(step));
  const mac = createHmac('sha1', Buffer.from(bytes)).update(msg).digest();
  const o = mac[mac.length - 1]! & 0x0f;
  return String((mac.readUInt32BE(o) & 0x7fffffff) % 1_000_000).padStart(6, '0');
}

async function admin() {
  const sa = JSON.parse(readFileSync(SUPER_FILE, 'utf8')) as {
    email: string;
    password: string;
    secret: string;
  };
  const step = () => Math.floor(Date.now() / 30_000);
  const s0 = step();
  while (step() === s0) await new Promise((r) => setTimeout(r, 1000)); // a fresh code, never a replay
  const r = await call('POST', '/v1/admin/auth/login', {
    email: sa.email,
    password: sa.password,
    totp: totp(sa.secret, step()),
  });
  expect(r.status).toBe(200);
  return { authorization: `Bearer ${r.body.token}` };
}

const day = (n: number) =>
  new Date(Date.now() + n * 86_400_000 + 3_600_000).toISOString().slice(0, 10);

async function book(phone: string) {
  const address = {
    text: '12 Admiralty Way, Lekki Phase 1',
    location: { lat: 6.4452, lng: 3.4741 },
  };
  const q = await call('POST', '/v1/quotes', {
    legs: [{ type: 'DEPARTURE', flightNumber: 'P47122', date: day(4), address }],
    passengers: 1,
    bags: 1,
    rideType: 'PRIVATE',
    plan: 'STANDARD',
  });
  expect(q.status).toBe(201);
  const b = await call(
    'POST',
    '/v1/bookings',
    {
      quoteId: q.body.quoteId,
      airlineBookingReference: `PW${randomUUID().slice(0, 6).toUpperCase()}`,
      traveller: { name: 'Bisi Adeyemi', phone, whatsapp: true },
    },
    { 'idempotency-key': randomUUID() },
  );
  expect(b.status).toBe(201);
  const pay = await call('POST', `/v1/bookings/${b.body.bookingId}/pay`, {
    payToken: b.body.payToken,
  });
  await call('POST', `/v1/dev/fake-paystack/${pay.body.reference}/complete`, {
    outcome: 'success',
  });
  return {
    bookingId: b.body.bookingId as string,
    token: String(b.body.trackingUrl).split('/t/')[1]!,
  };
}

/** Slow 3G and a 4x slower CPU, as on a low-end Android phone (TRV-09). */
async function lowEndPhone(cdp: CDPSession) {
  await cdp.send('Network.enable');
  // A first load: nothing from the cache.
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
  await cdp.send('Network.emulateNetworkConditions', {
    offline: false,
    latency: 400,
    downloadThroughput: (400 * 1024) / 8,
    uploadThroughput: (400 * 1024) / 8,
  });
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
}

test.describe.configure({ mode: 'serial', timeout: 180_000 });

test('confirmation, tracking page under 200 KB on a slow phone, and a reply button recorded', async ({
  page,
  context,
}) => {
  const phone = `+23481${String(Date.now()).slice(-7)}2`;
  const { bookingId, token } = await book(phone);

  // The confirmation arrives on (fake) WhatsApp, delivered.
  await page.goto(`/dev/phone?to=${encodeURIComponent(phone)}`);
  await expect(page.getByText(/your transfer is confirmed/)).toBeVisible({ timeout: 20_000 });

  // First load of the tracking page on a low-end phone over slow 3G.
  const cdp = await context.newCDPSession(page);
  await lowEndPhone(cdp);
  let bytes = 0;
  cdp.on(
    'Network.loadingFinished',
    (e: { encodedDataLength: number }) => (bytes += e.encodedDataLength),
  );
  await page.goto(`/t/${token}`, { waitUntil: 'load', timeout: 90_000 });
  await expect(page.getByTestId('pickup-code')).toBeVisible();
  await expect(page.getByText('Powered by Airwheels')).toBeVisible();
  console.log(`tracking page first load: ${(bytes / 1024).toFixed(1)} KB`);
  expect(bytes).toBeLessThan(200 * 1024);
  await cdp.send('Network.emulateNetworkConditions', {
    offline: false,
    latency: 0,
    downloadThroughput: -1,
    uploadThroughput: -1,
  });
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });

  // The driver is confirmed for the night before: the message has Confirm · Change time · Cancel.
  const drivers = (await call('GET', '/v1/admin/drivers?status=ACTIVE', undefined, A))
    .body as unknown as { id: string; vehicle: string | null }[];
  const driver = drivers.find((d) => d.vehicle);
  test.skip(!driver, 'no active driver with a car (the M3 flow creates one)');
  const legs = (await call('GET', `/v1/admin/bookings/${bookingId}`, undefined, A)).body.legs as {
    id: string;
  }[];
  expect(
    (await call('POST', `/v1/admin/legs/${legs[0]!.id}/assign`, { driverId: driver!.id }, A))
      .status,
  ).toBe(200);
  await call(
    'POST',
    `/v1/admin/legs/${legs[0]!.id}/status`,
    { status: 'DRIVER_CONFIRMED', reason: 'confirmed' },
    A,
  );

  // The traveller taps Confirm on their phone…
  await page.goto(`/dev/phone?to=${encodeURIComponent(phone)}`);
  await page.getByRole('button', { name: 'Confirm' }).first().click({ timeout: 20_000 });
  await expect(page.getByRole('status')).toContainText('CONFIRM');
  // …and sees it recorded on the tracking page.
  await page.goto(`/t/${token}`);
  await expect(page.getByTestId('last-reply')).toContainText('You confirmed your driver');
  await expect(page.getByTestId('driver-card')).toBeVisible();
});

test('change, then cancel, with the six-digit code and the cost shown first', async ({ page }) => {
  const { token } = await book(`+23481${String(Date.now()).slice(-7)}4`);

  await page.goto(`/t/${token}/change`);
  await page.getByRole('button', { name: 'Text me a code' }).click();
  const code = (await page.getByText(/Development only: your code is/).textContent())!.replace(
    /\D/g,
    '',
  );
  await page.getByLabel('Six-digit code').fill(code);
  await page.getByRole('button', { name: 'Continue' }).click();
  const input = page.getByLabel('New pickup time (Lagos)');
  const current = await input.inputValue();
  const earlier = new Date(new Date(`${current}:00Z`).getTime() - 30 * 60_000)
    .toISOString()
    .slice(0, 16);
  await input.fill(earlier);
  await page.getByRole('button', { name: 'See the cost' }).click();
  await expect(page.getByTestId('change-cost')).toContainText('This change is free.');
  await page.getByRole('button', { name: 'Confirm change' }).click();
  await expect(page.getByRole('status')).toContainText('Done.');

  // A new code is needed for the cancellation (the first one is used).
  await page.goto(`/t/${token}/cancel`);
  await page.waitForTimeout(2500); // the resend cooldown, shortened for this run
  await page.getByRole('button', { name: 'Text me a code' }).click();
  const devCode = page.getByText(/Development only: your code is/);
  await expect(devCode).toBeVisible();
  await page.getByLabel('Six-digit code').fill((await devCode.textContent())!.replace(/\D/g, ''));
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByTestId('cancel-refund')).toContainText('You get back');
  page.once('dialog', (d) => void d.accept());
  await page.getByRole('button', { name: 'Cancel my transfer' }).click();
  await expect(page.getByRole('status')).toContainText('cancelled');
  await page.goto(`/t/${token}`);
  await expect(page.getByText('This booking is cancelled.')).toBeVisible();
});
