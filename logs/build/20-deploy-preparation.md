# Phase 7a — Deploy preparation

**Date:** 2026-09-15

Everything needed to deploy, without touching a single hosted service. No Vercel project, Supabase project, Stripe account or DNS record was created or changed by the developer.

**Done**

**The API can run as a Vercel function**
- `apps/api/api/index.ts`: the entry point Vercel calls. It builds the app on the **first request**, not at import, so a missing setting appears as a readable error in the logs instead of a crash while the function is starting.
- `apps/api/src/bootstrap.ts`: one place that wires environment → database → Stripe → email. The local server (`src/server.ts`) and the Vercel entry both use it, so they can't drift apart.
- `apps/api/public/index.html`: a plain page at the API's root. Vercel needs a static output folder for a project with no framework; without it the deploy fails with *"No Output Directory named public found"*.

**Scheduled jobs work the way Vercel calls them**
- Vercel Cron sends a **GET** with an `Authorization: Bearer CRON_SECRET` header it adds itself. The three `/cron/*` endpoints previously accepted POST only, so all three would have failed in production. They now accept both.

**Configuration in the repo**

| File | What it sets |
|---|---|
| `apps/api/vercel.json` | Build of the shared packages, `public` as the output folder, all paths rewritten to the function, 60 s limit, and the three cron schedules |
| `apps/pos/vercel.json` | Next.js preset, build including the shared packages |
| `apps/booking/vercel.json` | Next.js preset, build including the shared packages |

The build commands were **run locally from the same directories Vercel uses** (`apps/api`, `apps/pos`, `apps/booking`), and all three succeed.

**Cron schedules** (UTC, because that is what Vercel uses): reminders 22:00, forfeit 22:20, holds 22:40 — that is 08:00/08:20/08:40 Sydney in winter and an hour later in summer, which suits D54's "about 09:00".

**`apps/api/.env.example` was wrong.** It listed 9 settings; the API reads 16. The missing ones included the Stripe keys, the cron secret, the member-QR secret and the booking site URL — exactly what someone would forget when filling in Vercel. It now lists all of them, grouped and explained, **and a test fails if the two ever drift apart again**.

**The runbook:** [`spec/deploy.md`](../../spec/deploy.md) — what runs where, the one table of names and addresses, the accounts the owner creates, Vercel project settings, the environment variables per project, Supabase and Stripe setup, the scheduled jobs, the go-live order, and what to do after. Linked from `spec/README.md` and `architecture.md`.

**Verified**
1. **`test/vercel-entry.integration.test.ts` (6):** the deployed entry point answers `/health` built purely from environment variables; unknown paths still return the API's own 404; starting without settings names the missing one; all three cron paths answer a **GET with the cron secret**, refuse a GET without it or with the wrong one, and still accept POST.
2. **`.env.example` completeness test:** compares the file against the settings the API actually reads.
3. **Build commands:** `turbo run build --filter=…` for each project, run from each app's directory as Vercel will. All three pass.
4. **Mutation check, 6 deliberate breaks, 6 killed:** cron jobs accept POST only, cron secret not checked, a setting dropped from `.env.example`, the app built at import time (crashes before settings can be read), plus two earlier cron-auth breaks.
   - One attempt was not a real mutation (the same lazy initialisation written differently) and was replaced by the import-time version above.
5. **Gate** (clean `db reset`, same command as the commit): pgTAP 372 · turbo 11/11 (pricing 78, API **168**) · POS e2e 4 passed + 1 skipped · booking e2e 7 passed.

**Issues found and fixed**
1. **The cron jobs would all have failed in production** — Vercel calls them with GET, the API only accepted POST. Found by writing the deployment down rather than assuming it.
2. **The deploy failed with "No Output Directory named public"** (reported by the owner mid-deploy). A project with no framework needs a static folder; added, with a plain page explaining what the address is.
3. **`.env.example` was missing 7 of 16 settings**, including secrets. Now complete and guarded by a test.
4. The local server and a Vercel entry point would have been two copies of the same wiring; extracted to `bootstrap.ts` before that could rot.

**Correction to step 18**

Build log 18 blamed the password-reset test failure on Supabase's local limit of 2 auth emails an hour. That was **wrong**, and the same test failed again after the limit was raised. The real cause: the test clicked through to the page and typed before React had hydrated it, so the controlled input was reset to empty and the form never submitted (the page snapshot showed an empty email field). Tests now type with a small retry that checks the value stuck. The email limit was genuinely too low for a test run as well, and is still raised for local development.

Two things came out of chasing it, both kept:
- **The "forgot password" page no longer waits for the email to be sent.** It shows the same answer immediately, so its timing can't be used to work out whether an address has an account either.
- Local Supabase allows 200 auth emails an hour (development only). The hosted project must still send through Resend SMTP.

**A flaky test, explained rather than retried**

The POS membership test failed twice in full gate runs, in two different places. The second failure named the cause: the screen said "**0 min** free play ready" where the test expected 60. Selling a membership involves **two** Stripe webhooks — `checkout.session.completed` activates the member, and `invoice.paid` grants the free minutes — and the test assumed one moment in time for both. Under a loaded machine the second event arrives a little later, so the member was genuinely active with a zero balance at the instant the test looked.

Nothing is wrong in the product: the POS updates as soon as the second event lands. The test now waits for the balance (up to 60 s) instead of assuming it, and the "print card" assertion allows for its API round trip. Two clean runs after the change, plus the full suite.

**Not built yet**
- Nothing is deployed. The owner creates the accounts and we follow `spec/deploy.md` together.
- **To verify on the first real deploy** (can't be checked from here): that Vercel's bundler resolves the API's TypeScript imports, that the workspace packages are traced into the function, and that a cron job fires.
- Reports, Resend email templates, and the final legal wording — the rest of Phase 7.
