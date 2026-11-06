# Airwheels

Door-to-door airport transfers sold inside airline booking flows. Lagos first.
The source of truth is **PRD v2.4** (November 6, 2026). Section numbers in code comments (e.g. `PRD 10.1`, `CHN-03`) point to it.

## Setup (about 5 minutes)

You need **Node 22+**, **pnpm 10** (`corepack enable`) and **Docker Desktop**.

```bash
pnpm install
pnpm dev
```

`pnpm dev` does everything in order:

1. creates `.env` from `.env.example` and fills local-only secrets (`pnpm setup:env`)
2. starts Postgres and Redis in Docker (`pnpm infra:up`)
3. applies migrations and seeds data (`pnpm db:migrate`, `pnpm db:seed`)
4. starts every app with Turborepo (`pnpm dev:apps`)

| What | URL |
| --- | --- |
| API (REST + WebSocket `/rt`) | http://localhost:4000/v1/health |
| API docs (OpenAPI) | http://localhost:4000/docs |
| Booking page and tracking pages | http://localhost:3000 |
| Admin dashboard | http://localhost:3001 |
| Widget host page (fake airline checkout) | http://localhost:3002 |
| Mock airline control panel | http://localhost:4100 |

### First sign-in to the admin (M1)

Staff accounts are never seeded. Create the first super admin once, with the one-time command (it refuses if a super admin exists):

```bash
pnpm --filter @airwheels/api build      # the command runs from the compiled API
pnpm admin:create-super --email you@company.com --name "Your Name"
```

Open the printed link (in development email is faked, so the link is printed), scan the QR code with an authenticator app, set a password and finish. Then invite staff from **Staff and roles**. In development, invite links, driver invite codes and SMS codes are also returned by the API and shown in the admin and the driver app, because email and SMS are fake.

To check the whole M1 path end to end against a running API: `pnpm --filter @airwheels/api flow:m1`.

### Driver app on a phone or tablet

Set `EXPO_PUBLIC_API_URL` in `apps/driver/.env` to your computer's LAN address (for example `http://192.168.1.20:4000`), run `pnpm driver`, and open it in Expo Go. Onboard and invite the driver in the admin, then tap **Activate** in the app. Suspending the driver in the admin signs the app out within about 5 seconds.

### Send a booking from the mock airline

```bash
pnpm mock:booking
```

This quotes, then confirms a paid booking through the signed partner API, exactly as an airline would.
Open http://localhost:3001/bookings to see it stored. The API log shows the fake WhatsApp message with the tracking link and pickup code.

Other mock airline calls:

```bash
pnpm --filter @airwheels/mock-airline send get <REF>
pnpm --filter @airwheels/mock-airline send change <REF>
pnpm --filter @airwheels/mock-airline send cancel <REF>
pnpm --filter @airwheels/mock-airline send alert TIME_SHIFTED   # or CANCELLED, DEPARTED, LANDED
pnpm --filter @airwheels/mock-airline smoke                     # end-to-end check used by CI
```

### Driver app (Expo Go)

```bash
pnpm driver
```

Scan the QR code with Expo Go (SDK 58). For a phone to reach the API, set `EXPO_PUBLIC_API_URL` in `apps/driver/.env` to your computer's LAN address, e.g. `http://192.168.1.20:4000`.

## Repository layout

```
apps/
  api/            NestJS modular monolith: REST, OpenAPI, WebSocket gateway, BullMQ workers, Prisma
  web/            Next.js: our booking page, tracking page, change and cancel pages
  admin/          Next.js: ops dashboard shell
  widget/         Embeddable transfer widget (one ~1.5 kB gzipped script) + host page
  driver/         Expo driver app (Expo Router), driver-only
  mock-airline/   Plays the airline: signed bookings, changes, cancellations, flight alerts
packages/
  types/          Shared Zod schemas and types (partner API, enums, money)
  api-client/     Typed client generated from the API's OpenAPI spec
  ui/             Airwheels brand tokens and airline theming
  config/         Shared ESLint and TypeScript config
```

### API modules (PRD 4.3)

`auth, drivers, admin, airlines, intake, bookings, traveller-access, flights, dispatch, matching, pricing, policy, payments, settlement, messaging, calls, support, config, audit, media` each live in `apps/api/src/modules/<name>`.

Built in this milestone: **intake** (partner API with HMAC signing and idempotency), **bookings** (booking + legs + events), **pricing** (quote engine with margin floor), **traveller-access** (tracking links, pickup codes), **flights** (airline alerts to snapshots), **messaging** (queued WhatsApp-then-SMS), **config** (versioned config store), **audit**, **airlines** (partner auth, widget config).
The rest are module boundaries with the milestone that fills them noted at the top of the file.

## Rules for contributors

- **Money is integer kobo.** Never floats. See `packages/types/src/money.ts`.
- **Timestamps are UTC** in the database (`timestamptz`) and shown in `Africa/Lagos`.
- **No assumption values in code.** Buffers, cut-offs, thresholds and fares live in `ConfigEntry` and `PricingRule` (seeded from `apps/api/prisma/seed-data.ts`) and are read through `ConfigStore`. Seeded fares are placeholders.
- **Every external service sits behind an adapter** in `apps/api/src/adapters`. Fakes are used by default (`ADAPTERS_MODE=fake`), so nothing needs a real account. Live adapters are added per provider as each milestone needs them.
- **No secrets in the repo.** `.env` is git-ignored; `.env.example` lists every variable with empty values.
- **Changing API routes or DTOs?** Run `pnpm openapi` and commit `packages/api-client`. CI fails if it is stale.
- **Changing the schema?** `pnpm db:migrate:dev` creates a migration.

## Scripts

| Command | Does |
| --- | --- |
| `pnpm dev` | Full local stack (env, Docker, migrate, seed, all apps) |
| `pnpm dev:apps` | Apps only, if Postgres and Redis are already running |
| `pnpm lint` / `typecheck` / `test` / `build` | Same checks as CI |
| `pnpm --filter @airwheels/web test:e2e` | Playwright on a mobile viewport |
| `pnpm --filter @airwheels/driver test:maestro` | Maestro flows (needs an emulator and Maestro installed) |
| `pnpm openapi` | Regenerate the OpenAPI spec and typed client (no database needed) |
| `pnpm infra:down` | Stop Postgres and Redis |

## Observability

Sentry (API, web, admin, driver app) and PostHog (API, web) start only when their keys are set in `.env`. API logs are structured JSON (pretty in development) and carry a request id on every line.

## Keys and secrets

| Variable | Used for | Where it lives |
| --- | --- | --- |
| `APP_ENCRYPTION_KEY` | Encrypting airline signing secrets at rest (AES-256-GCM) | Environment only. Locally `.env`, in staging and production the secrets manager. Never in the database or repo. |
| `APP_ENCRYPTION_KEY_PREVIOUS` | Decrypting with the old key during a rotation | Set only during a rotation |
| `PICKUP_CODE_KEY` | Deriving 4-digit pickup codes | Environment only, same as above |

The database holds only ciphertext (`AirlineCredential.secretEncrypted`). Without the key it is useless.
The API refuses to start an encryption or decryption if a key is missing or malformed.

### Rotating the encryption key

1. Generate a new key: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.
2. In the secrets manager, set `APP_ENCRYPTION_KEY_PREVIOUS` to the **current** key and `APP_ENCRYPTION_KEY` to the **new** key. Redeploy. The API now encrypts with the new key and still reads values made with the old one.
3. Re-encrypt stored secrets: `pnpm --filter @airwheels/api secrets:rotate`. It is safe to run twice and prints how many it changed.
4. Remove `APP_ENCRYPTION_KEY_PREVIOUS` and redeploy. Destroy the old key.

Rotating the encryption key does not change pickup codes, because they use `PICKUP_CODE_KEY`. Rotating `PICKUP_CODE_KEY` changes every live code, so do it only together with a message to travellers about their new codes.

To rotate a single airline's **signing secret** (not the encryption key), issue a new `AirlineCredential` for the airline, share it with them, then set the old one to `REVOKED` (admin screen in M5).

## Access control (M1)

- **Deny by default.** A global guard checks every route. A route needs `@Roles(...)` or `@Public()`; anything else is blocked. `apps/api/src/route-access.test.ts` boots the app and calls every route as every role (driver, ops agent, super admin, finance, airline partner, system, anonymous) against the access table from PRD 2.2. A new route fails that test until it is added to the table.
- **Sessions** are server-side rows. The bearer token (a signed JWT) only names the row, so sign-out, suspension, role changes and new-device sign-in take effect on the next request.
- **Admins:** email, password (argon2id), TOTP (secret encrypted with `APP_ENCRYPTION_KEY`, codes cannot be reused), inactivity timeout, account lock after repeated failures, and sign-in history.
- **Drivers:** no sign-up. Ops create the driver, upload documents to private storage, run KYC, assign a vehicle, tick training and send the invite. The driver activates with the SMS code plus the invite code, sets a six-digit PIN and is bound to one device; a new device needs an SMS code and signs out the old one.
- **Finance** is read-only everywhere, enforced in the guard as well as per route.
- **Audit:** services record who, what, before and after. A safety net records any admin write a service did not. Viewer at **Audit log**.
- **Rate limits** (Redis, per IP or per airline key) and every timeout, lockout and expiry live in the config store, editable by super admins at **Settings**.
- **System jobs** call internal routes with `SYSTEM_API_TOKEN`.

## Money (M2)

- **Quotes** follow PRD 12.2 step by step in a pure engine (`apps/api/src/modules/pricing/engine.ts`): zone base fare, airport fee (passed through), time and season surcharges, vehicle class and extra bags, extras, plan multiplier, shared share, discounts with stacking limits, tax and rounding. A cost model runs alongside; the margin floor wins over the price ceiling and flags the quote for ops.
- **Pricing rules** are versioned and effective-dated (`PricingRule`). Super admins add versions at **Pricing**; nothing is edited in place and every change is in the audit log. Each quote stores the rule versions it used.
- **Quotes are snapshots**: a Postgres trigger refuses any change except setting `lockedAt` once. The price is held for the airline's quote expiry, or `pricing.ownChannelQuoteExpiryMinutes` on our own channel. An expired quote cannot be booked or paid.
- **Bookings** have the states of PRD 8.4; moves PRD 8.4 does not allow are refused. Every change writes a `BookingEvent`. After confirmation, the ledger posting and the confirmation message run as queued steps that each run once (`BookingStep`), and a sweeper re-queues anything the queue missed.
- **Channels**: airline partner API, our booking page (`/`), the post-booking link (`/?airline=P4&ref=ABC123&flight=P47121&date=2026-11-20&leg=DEPARTURE`) and ops entry (**Bookings → New phone or WhatsApp booking**) all go through the same booking service.
- **Paystack**: the real adapter (`apps/api/src/adapters/paystack.ts`) is used when `ADAPTERS_MODE=live` and `PAYSTACK_SECRET_KEY` is set (test key `sk_test_...` for test mode). Locally and in CI a fake gateway sends you to a test checkout page and signs its webhooks exactly like Paystack. Webhooks are signature-checked, stored once per event, and applied only after asking Paystack for the transaction, so duplicates and out-of-order events change nothing. Payment details are never logged or stored.
- **Ledger**: double-entry in integer kobo with every PRD 14.4 account, plus per-airline receivable and revenue share accounts. Postings are refused unless they balance, and a deferred Postgres trigger refuses an unbalanced transaction at commit. Ledger rows cannot be edited or deleted.
- **Refunds** go back through Paystack for our channel, or onto the airline's statement for airline-collected bookings. Ops agents are capped at `refunds.opsAgentLimitKobo`; larger refunds need a super admin.
- **Reconciliation** runs daily (`payments.reconciliationHourLagos`) and on demand at **Payments**: it settles payments still pending, compares the day with Paystack, checks the ledger balances, and alerts ops about any mismatch.
- Check the whole path: `pnpm --filter @airwheels/api flow:m2` (after `flow:m1`).

### Paystack test mode

Add your test keys to `.env` and switch the adapter on:

```
ADAPTERS_MODE=live
PAYSTACK_SECRET_KEY=sk_test_...
PAYSTACK_PUBLIC_KEY=pk_test_...
```

Point the Paystack dashboard's test webhook URL at `https://<your tunnel>/v1/webhooks/payments`. Without a webhook (for example on localhost), reconciliation settles the payment within `payments.pendingCheckAfterMinutes`, or run it from **Payments**. Note that with `ADAPTERS_MODE=live` every other provider without a live adapter still uses its fake, which is only allowed in development.

## Notes and decisions

- **Airline signing secrets** are stored AES-256-GCM encrypted, not hashed (PRD 18 says "secret hash"), because verifying an HMAC signature needs the secret itself.
- **Pickup codes** are derived from the leg id and the leg's code version with `PICKUP_CODE_KEY`, so the tracking page can show them again while only a hash is stored (PRD 19.1). Ops reissue a code with `POST /v1/admin/legs/:id/pickup-code/reissue`, which bumps the version so the old code stops working. After `dispatch.pickupCodeMaxAttempts` wrong guesses (config store, default 5) the leg locks and the driver calls support.
- **Pickup code lock (ACC-11):** at the wrong-attempt limit only code entry locks for that leg; the trip carries on and ops get one alert. Reissuing the code (ACC-10) issues a new version, clears the lock, resolves the alert and sends the traveller the new code.
- **Development shortcuts (ACC-12)**: codes in API responses only when `NODE_ENV=development`; fake providers only in development and the test runner. Anywhere else the API refuses to start with a fake provider.
- **Driver status** has one extra value, `ONBOARDING`, for a driver ops have created but not yet invited. The PRD flow Invited, Activated, Active, Suspended follows from there.
- **Pickup and drop-off points at the airport** are placeholders until FAAN confirms zones (PRD 3.4).
