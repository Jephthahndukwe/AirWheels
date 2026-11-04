# Airwheels

Door-to-door airport transfers sold inside airline booking flows. Lagos first.
The source of truth is **PRD v2.2** (November 1, 2026). Section numbers in code comments (e.g. `PRD 10.1`, `CHN-03`) point to it.

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

## Notes and decisions

- **Airline signing secrets** are stored AES-256-GCM encrypted, not hashed (PRD 18 says "secret hash"), because verifying an HMAC signature needs the secret itself.
- **Pickup codes** are derived from the leg id and the leg's code version with `PICKUP_CODE_KEY`, so the tracking page can show them again while only a hash is stored (PRD 19.1). Ops reissue a code with `POST /v1/admin/legs/:id/pickup-code/reissue`, which bumps the version so the old code stops working. After `dispatch.pickupCodeMaxAttempts` wrong guesses (config store, default 5) the leg locks and the driver calls support.
- **Admin endpoints** are open only when `NODE_ENV` is exactly `development`. Any other value, or no value, blocks them until admin sign-in lands in M1.
- **Pickup and drop-off points at the airport** are placeholders until FAAN confirms zones (PRD 3.4).
