# Architecture

## 1. Stack

| Layer | Choice |
|---|---|
| Runtime | Node.js 22 LTS (`.nvmrc`) |
| Package manager | pnpm 9 (pinned via `packageManager`, run through corepack) |
| Monorepo | Turborepo |
| Language | TypeScript (strict) everywhere |
| Frontends | Next.js App Router (booking, POS) |
| API | Hono on Vercel Functions |
| Database / auth / realtime | Supabase (Postgres, Auth, Realtime) |
| Payments | Stripe (Checkout, Billing, Customer Portal, Refunds), AUD |
| Email | Resend + React Email |
| UI | Tailwind + shadcn/ui in `packages/ui` |
| Tests | Vitest (unit), Playwright (E2E, later phases) |
| Hosting | Vercel: three projects from one repo |

## 2. Repository layout

```
apps/
  booking/     Next.js public site
  pos/         Next.js POS + back office
  api/         Hono API: all money-touching writes, webhooks, cron endpoints
packages/
  pricing/     pure pricing engine + validators (zero runtime deps)
  db/          SQL migrations, generated types, typed client helpers
  types/       shared DTOs / zod schemas
  ui/          shared components
  config/      tsconfig / eslint presets
supabase/      config, migrations, seed
spec/          this spec
logs/          planning, decision and build logs
```

## 3. Security rules (non-negotiable)

1. **Only `apps/api` writes** bookings, sessions, payments, refunds, ledger, referral counters, config and audit rows. Only the API holds the Supabase service-role key and the Stripe secret key.
2. **Frontends never compute a charge.** Frontends may call the engine for instant UI previews, but the **API recomputes** and its result is what gets charged.
3. **Staff endpoints** require a valid Supabase JWT for an active `staff` row **and** an operator PIN token (short-lived, issued by `POST /pos/operator`). The role is checked on the server per endpoint.
4. **Member endpoints** require a Supabase JWT mapped to a `customers.auth_user_id`.
5. **Webhooks** verify the Stripe signature. **Cron endpoints** require `CRON_SECRET`.
6. **Secrets** live only in Vercel/Supabase environment variables, never in the repo. `.env.example` lists names only.
7. **Audit log** is insert-only.
8. **QR tokens and cancel tokens** are stored as hashes only.
9. **Rate limiting** on PIN verification, login, referral code checks and hold creation.

## 4. API surface (outline)

```
Public
  GET  /public/config                 opening hours, types, resources, happy hours, tiers
  GET  /public/availability?type&date
  POST /public/quote                  engine quote (member discount only with member JWT)
  POST /public/referral/check
  POST /bookings/hold                 → Stripe Checkout URL or confirmed ($0)
  GET  /bookings/:ref?token
  POST /bookings/:ref/cancel?token

Member (JWT)
  GET  /me  ·  GET /me/ledger  ·  POST /me/qr/reissue
  POST /me/membership/checkout  ·  POST /me/membership/tier  ·  POST /me/portal

POS (staff JWT + operator)
  POST /pos/operator                  PIN → operator token
  shifts:    open / close / movements / report
  floor:     GET /pos/floor
  sessions:  open / arrive / no-show / quote / close / void / extend
  members:   scan / search / sell (Checkout QR)
  referral:  check

Back office (superadmin)
  CRUD: resource-types, resources, rate-bands, happy-hours, opening-hours, settings,
        tiers (+ price change), members (adjust, reissue, tier, cancel), referral-codes,
        staff, bookings (cancel/refund)
  GET reports/*, audit

System
  POST /webhooks/stripe
  POST /cron/reminders     hourly: 24h booking reminders
  POST /cron/forfeit       daily: forfeit balances ended > 30 days
  POST /cron/holds         cleanup of expired holds (correctness doesn't depend on it)
```

## 5. Scheduled jobs

- **Hourly** (booking reminders) and **daily** (balance forfeit).
- **Vercel Cron on the Hobby plan runs at most once a day**, so hourly reminders need either **Vercel Pro** or Supabase `pg_cron` + `pg_net` calling the API.
  - The decision is deferred to Phase 6.
  - All jobs are idempotent: reminders are marked sent in `email_log`, and forfeits are checked against the ledger.

## 6. Environments

| Env | Database | Stripe | Email |
|---|---|---|---|
| local | Supabase local (Docker) | test mode | Resend test / log to console |
| preview | Supabase hosted (staging project or branch) | test mode | Resend test |
| production | Supabase hosted | live mode | Resend, verified domain |

## 7. Timezone handling

- Store UTC (`timestamptz`) everywhere.
- Store rate bands, happy hours and opening hours as local wall-clock times.
- Convert with `Intl` using `venue_settings.timezone`.
- Render every time in venue time.
- The DST cases are part of the pricing engine test suite.

## 8. Quality gates (every phase)

- `pnpm typecheck`, `pnpm lint` and `pnpm test` all green before a phase is marked done in the build log.
- Money paths require unit tests. Phase 3+ adds API integration tests against local Supabase.
- Each build step is logged in `logs/2026-09-14-build-log.md` with what was done, how it was verified, and results.
