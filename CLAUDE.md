# Raceground — working notes for Claude

Booking system + POS for Raceground, a Sydney gaming venue (billiard tables, driving sims, VR seats). The repo folder is still called `rezon-booking-system`; the product is **Raceground**.

## Before doing anything

1. **Read [`logs/README.md`](logs/README.md)** for current status, the index of build steps and decisions, and what's next.
2. **Read the relevant [`spec/`](spec/README.md) file.** The spec is the source of truth.
3. **Open the `logs/build/` step(s) for the area you'll touch** to see how it was built and verified.

## How the owner wants work done

- **Small steps.** Build, verify and log each one before moving on. Don't assume things work: run the tests, or reproduce the problem.
- **One log file per step:** `logs/build/NN-name.md` with Done / Verified / Issues found and fixed. Then update `logs/README.md`.
- **Business rules and owner answers** go in `logs/decisions/` as D-numbers, and the spec is updated to match.
- **Ask the owner before anything external:** hosted Supabase, Vercel deploys, pushing to GitHub, live Stripe.
- **Never open the owner's personal credential files** (e.g. `~/.config/stripe/…`). Ask them to confirm instead.
- **Explain progress in plain language.** The owner isn't a developer.

## Commands (Node 22, pnpm 9 via corepack)

```
nvm use 22
corepack pnpm install
corepack pnpm db:start            # local Supabase in Docker, incl. Storage for website photos (Docker Desktop must be running)
corepack pnpm db:reset            # rebuild DB from migrations + launch seed (wipes local data)
corepack pnpm --filter @raceground/api dev    # API on :8787 (reads apps/api/.env.local)
corepack pnpm --filter @raceground/pos dev    # POS + back office on :3001 (reads apps/pos/.env.local)
corepack pnpm --filter @raceground/booking dev  # booking website on :3000 (reads apps/booking/.env.local)
stripe listen --forward-to localhost:8787/webhooks/stripe   # only for membership payments locally
```

## Verification gate (run before every commit)

```
corepack pnpm exec turbo run typecheck lint test --force   # expect "11 successful, 11 total"
corepack pnpm db:test                                      # expect "Result: PASS"
cd apps/pos && corepack pnpm build && corepack pnpm e2e        # 5 browser tests (the walk-in one only runs 10:00–20:45 Sydney)
cd apps/booking && corepack pnpm build && corepack pnpm e2e    # 7 browser tests
```

Both e2e suites need `E2E_STRIPE=1` and `stripe listen --forward-to localhost:8787/webhooks/stripe` for their real-Stripe tests; without it those tests are skipped. The booking-site tests read confirmation and password emails from the local mail catcher (Mailpit, `http://127.0.0.1:54324`).

- **Commit only if every check passed in that same run.** Put the commit in the same command, conditional on the checks.
- **Never commit secrets.** `.env.local` files are git-ignored; scan the staged diff for `sk_test_` / `whsec_` / `sb_secret_`.
- Commits stay local unless the owner asks to push.

## Conventions that matter

- **Money** is integer cents; **percentages** are basis points; **instants** are UTC; **wall-clock times** are `Australia/Sydney`.
- **One pricing engine** (`packages/pricing`) is used everywhere. The API recomputes every charge.
- **Only the API writes.** Money actions are single-transaction Postgres functions that raise `RG:<code>:<message>`. Config writes carry `x-rg-actor` / `x-rg-reason-b64` headers for the audit trigger.
- **Tests must pass on a fresh and on a used local database**, in any order. Scope assertions to the test's own rows.
