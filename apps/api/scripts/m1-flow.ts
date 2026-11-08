import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { totpCode, totpStep } from '../src/common/auth/totp';

/**
 * M1 end-to-end check against a running API in development mode (CI smoke job and local runs):
 * super admin signs in with TOTP and invites an ops agent; the ops agent onboards and invites a
 * driver; the driver activates and signs in; suspension signs the driver out at once; finance is
 * read-only; every step is in the audit log.
 *
 *   pnpm --filter @airwheels/api flow:m1
 */
const API = process.env.API_PUBLIC_URL ?? 'http://localhost:4000';
const SUPER_FILE = resolve(__dirname, '../../../.storage/flow-super-admin.json');

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
  token?: string,
  raw?: { data: Buffer; type: string },
) {
  const res = await fetch(path.startsWith('http') ? path : `${API}${path}`, {
    method,
    headers: {
      ...(raw ? { 'content-type': raw.type } : { 'content-type': 'application/json' }),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: raw ? new Uint8Array(raw.data) : body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json: unknown = text;
  try {
    json = JSON.parse(text);
  } catch {
    /* text */
  }
  return { status: res.status, body: json as Record<string, unknown> & Record<string, never> };
}

/** Waits for a fresh TOTP step, because a code may not be used twice. */
async function freshTotp(secret: string, after: number): Promise<string> {
  while (totpStep() <= after) await new Promise((r) => setTimeout(r, 1000));
  return totpCode(secret);
}

async function acceptInvite(link: string, password: string) {
  const token = new URL(link).searchParams.get('token')!;
  const details = await call('GET', `/v1/admin/auth/invites/${token}`);
  const secret = details.body.totpSecret as string;
  const accepted = await call('POST', '/v1/admin/auth/invites/accept', {
    token,
    password,
    totp: totpCode(secret),
  });
  return {
    secret,
    step: totpStep(),
    status: accepted.status,
    token: accepted.body.token as string,
  };
}

async function superAdmin() {
  const stamp = Date.now();
  if (existsSync(SUPER_FILE)) {
    const saved = JSON.parse(readFileSync(SUPER_FILE, 'utf8')) as {
      email: string;
      password: string;
      secret: string;
    };
    return { ...saved, step: 0 };
  }
  const email = `super+${stamp}@airwheels.test`;
  const out = execSync(`pnpm --silent admin:create-super --email ${email} --name "Flow Super"`, {
    cwd: resolve(__dirname, '..'),
    encoding: 'utf8',
  });
  const link = out.match(/https?:\/\/\S+accept-invite\?token=\S+/)?.[0];
  check(link, 'one-time command created a super admin invite');
  const password = `Flow-${stamp}-pw!`;
  const r = await acceptInvite(link!, password);
  check(r.status === 200 && r.token, 'super admin accepted the invite with password and TOTP');
  mkdirSync(resolve(SUPER_FILE, '..'), { recursive: true });
  writeFileSync(SUPER_FILE, JSON.stringify({ email, password, secret: r.secret }));
  const again = execSync(
    `pnpm --silent admin:create-super --email other${stamp}@airwheels.test --name X || true`,
    {
      cwd: resolve(__dirname, '..'),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  check(!/accept-invite/.test(again), 'the one-time command refuses once a super admin exists');
  return { email, password, secret: r.secret, step: r.step };
}

async function main() {
  const stamp = Date.now();
  const sa = await superAdmin();

  const wrong = await call('POST', '/v1/admin/auth/login', {
    email: sa.email,
    password: 'wrong-password-1',
    totp: '000000',
  });
  check(wrong.status === 401, 'wrong password is refused');
  const saLogin = await call('POST', '/v1/admin/auth/login', {
    email: sa.email,
    password: sa.password,
    totp: await freshTotp(sa.secret, sa.step),
  });
  check(saLogin.status === 200, `super admin signs in with TOTP (${saLogin.status})`);
  const saToken = saLogin.body.token as string;
  const replay = await call('POST', '/v1/admin/auth/login', {
    email: sa.email,
    password: sa.password,
    totp: totpCode(sa.secret),
  });
  check(replay.status === 401, 'the same TOTP code cannot be used twice');

  // Super admin invites an ops agent and a finance user.
  const opsInvite = await call(
    'POST',
    '/v1/admin/staff/invites',
    { email: `ops+${stamp}@airwheels.test`, name: 'Ops Agent', role: 'OPS_AGENT' },
    saToken,
  );
  check(opsInvite.status === 201 && opsInvite.body.devLink, 'super admin invites an ops agent');
  const ops = await acceptInvite(opsInvite.body.devLink as string, `Ops-${stamp}-pw!`);
  check(ops.status === 200, 'ops agent accepts the invite');
  const finInvite = await call(
    'POST',
    '/v1/admin/staff/invites',
    { email: `fin+${stamp}@airwheels.test`, name: 'Finance', role: 'FINANCE' },
    saToken,
  );
  const fin = await acceptInvite(finInvite.body.devLink as string, `Fin-${stamp}-pw!`);
  check(fin.status === 200, 'finance user accepts the invite');

  const opsStaff = await call('GET', '/v1/admin/staff', undefined, ops.token);
  check(opsStaff.status === 403, 'an ops agent cannot manage staff');
  const finWrite = await call('POST', '/v1/admin/vehicles', {}, fin.token);
  check(finWrite.status === 403, 'finance is read-only');
  const finRead = await call('GET', '/v1/admin/drivers', undefined, fin.token);
  check(finRead.status === 200, 'finance can read');

  // Ops agent onboards a driver.
  const vehicle = await call(
    'POST',
    '/v1/admin/vehicles',
    {
      plate: `FLW-${String(stamp).slice(-5)}`,
      brand: 'BYD',
      model: 'Atto 3',
      colour: 'White',
      class: 'SUV',
      seats: 4,
      bagCapacity: 3,
      powerType: 'ELECTRIC',
    },
    ops.token,
  );
  check(vehicle.status === 201, 'ops agent adds a vehicle');
  const phone = `+23481${String(stamp).slice(-8)}`;
  const driver = await call(
    'POST',
    '/v1/admin/drivers',
    {
      firstName: 'Tunde',
      lastName: 'Flow',
      phone,
      licenceNumber: `LAG-${stamp}`,
      idType: 'NIN',
      idNumber: String(stamp).slice(-11).padStart(11, '1'),
      referees: [{ name: 'Ref One', phone: '+2348030000000', relationship: 'Former employer' }],
    },
    ops.token,
  );
  check(driver.status === 201, 'ops agent creates the driver');
  const driverId = driver.body.id as string;
  const early = await call('POST', `/v1/admin/drivers/${driverId}/invite`, undefined, ops.token);
  check(early.status === 400, 'invite is refused until onboarding is complete');

  for (const type of ['LICENCE', 'ID']) {
    const up = await call(
      'POST',
      `/v1/admin/drivers/${driverId}/documents`,
      { type, fileName: `${type}.pdf`, contentType: 'application/pdf' },
      ops.token,
    );
    const put = await call('PUT', up.body.uploadUrl as string, undefined, undefined, {
      data: Buffer.from('%PDF-1.4 flow test'),
      type: 'application/pdf',
    });
    const conf = await call(
      'POST',
      `/v1/admin/documents/${up.body.documentId as string}/confirm`,
      undefined,
      ops.token,
    );
    check(put.status === 200 && conf.status === 200, `${type} uploaded to private storage`);
  }
  const kyc = await call('POST', `/v1/admin/drivers/${driverId}/kyc`, undefined, ops.token);
  check(kyc.status === 200 && kyc.body.passed === true, 'KYC check passes (fake provider)');
  const veh = await call(
    'PUT',
    `/v1/admin/drivers/${driverId}/vehicle`,
    { vehicleId: vehicle.body.id },
    ops.token,
  );
  check(veh.status === 200, 'vehicle assigned');
  const train = await call(
    'PUT',
    `/v1/admin/drivers/${driverId}/training`,
    { items: { airportRules: true, pickupCodes: true, customerCare: true, safety: true } },
    ops.token,
  );
  check(train.status === 200, 'training checklist ticked');
  const invite = await call('POST', `/v1/admin/drivers/${driverId}/invite`, undefined, ops.token);
  check(invite.status === 200 && invite.body.devCode, 'ops agent sends the driver invite');

  // Driver activates in the app.
  const deviceA = `flow-device-a-${stamp}`;
  const start = await call('POST', '/v1/driver/activate/start', { phone });
  check(start.body.devCode, 'activation OTP sent to the invited phone');
  const verify = await call('POST', '/v1/driver/activate/verify', {
    challengeId: start.body.challengeId,
    otp: start.body.devCode,
    inviteCode: invite.body.devCode,
  });
  check(verify.status === 200, 'OTP and invite code accepted, driver is Activated');
  const weakPin = await call('POST', '/v1/driver/activate/complete', {
    setupToken: verify.body.setupToken,
    pin: '123456',
    acceptTerms: true,
    deviceId: deviceA,
  });
  check(weakPin.status === 400, 'an easy PIN is refused');
  const complete = await call('POST', '/v1/driver/activate/complete', {
    setupToken: verify.body.setupToken,
    pin: '482913',
    acceptTerms: true,
    deviceId: deviceA,
  });
  check(complete.status === 200 && complete.body.token, 'driver sets a PIN and is Active');
  const reuse = await call('POST', '/v1/driver/activate/verify', {
    challengeId: start.body.challengeId,
    otp: start.body.devCode,
    inviteCode: invite.body.devCode,
  });
  check(reuse.status === 401, 'invite code and OTP are single-use');

  const login = await call('POST', '/v1/driver/login', { phone, pin: '482913', deviceId: deviceA });
  check(login.status === 200 && login.body.token, 'driver signs in with phone and PIN');
  const firstSession = await call('GET', '/v1/driver/me', undefined, complete.body.token as string);
  check(firstSession.status === 401, 'one active session: the earlier session ended');
  const newDevice = await call('POST', '/v1/driver/login', {
    phone,
    pin: '482913',
    deviceId: `flow-device-b-${stamp}`,
  });
  check(newDevice.body.otpRequired === true, 'a new device needs an OTP');
  const nd = await call('POST', '/v1/driver/login/verify', {
    challengeId: newDevice.body.challengeId,
    otp: newDevice.body.devCode,
  });
  check(nd.status === 200, 'OTP moves the account to the new device');
  const oldDevice = await call('GET', '/v1/driver/me', undefined, login.body.token as string);
  check(oldDevice.status === 401, 'the old device is signed out');
  const driverToken = nd.body.token as string;
  const me = await call('GET', '/v1/driver/me', undefined, driverToken);
  check(me.status === 200 && me.body.status === 'ACTIVE', 'driver app reads its profile');
  const duty = await call('POST', '/v1/driver/duty', { onDuty: true }, driverToken);
  check(duty.status === 200, 'driver goes on duty');
  const adminAsDriver = await call('GET', '/v1/admin/drivers', undefined, driverToken);
  check(adminAsDriver.status === 403, 'a driver cannot reach admin endpoints');

  // Suspension signs the driver out at once.
  const suspend = await call(
    'POST',
    `/v1/admin/drivers/${driverId}/suspend`,
    { reason: 'Flow test suspension' },
    ops.token,
  );
  check(
    suspend.status === 200 && (suspend.body.sessionsEnded as number) >= 1,
    'ops agent suspends the driver',
  );
  const after = await call('GET', '/v1/driver/me', undefined, driverToken);
  check(after.status === 401, 'suspended driver is signed out on the next request');
  const relog = await call('POST', '/v1/driver/login', {
    phone,
    pin: '482913',
    deviceId: `flow-device-b-${stamp}`,
  });
  check(relog.status === 403, 'suspended driver cannot sign in');
  const opsReactivate = await call(
    'POST',
    `/v1/admin/drivers/${driverId}/reactivate`,
    { reason: 'Cleared' },
    ops.token,
  );
  check(opsReactivate.status === 403, 'only a super admin can reactivate');

  // Everything is in the audit log.
  const audit = await call(
    'GET',
    `/v1/admin/audit?entityId=${driverId}&limit=100`,
    undefined,
    saToken,
  );
  const actions = ((audit.body.items as { action: string }[]) ?? []).map((i) => i.action);
  for (const a of [
    'driver.create',
    'driver.kyc',
    'driver.vehicle_assign',
    'driver.training',
    'driver.invite',
    'driver.activated',
    'driver.account_active',
    'driver.new_device',
    'driver.on_duty',
    'driver.suspend',
  ]) {
    check(actions.includes(a), `audit log has ${a}`);
  }
  const staffAudit = await call(
    'GET',
    '/v1/admin/audit?action=staff.invite&limit=20',
    undefined,
    ops.token,
  );
  check(((staffAudit.body.items as unknown[]) ?? []).length > 0, 'audit log has the staff invites');
  const docAudit = await call(
    'GET',
    '/v1/admin/audit?action=document.upload&limit=200',
    undefined,
    ops.token,
  );
  const docOwners = ((docAudit.body.items as { after: { ownerId?: string } }[]) ?? []).filter(
    (i) => i.after?.ownerId === driverId,
  );
  check(docOwners.length === 2, 'audit log has both document uploads');

  if (failures) {
    console.error(`\n${failures} check(s) failed`);
    process.exit(1);
  }
  console.log('\nM1 flow passed');
}

void main();
