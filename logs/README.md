# Raceground — Logs

Everything that was planned, decided and built, one file per step so each can be read on its own.

- **What the system must do** → [`spec/`](../spec/README.md). This is the source of truth; if a log and the spec disagree, the spec wins.
- **Why it is that way** → `decisions/`
- **What was built and how it was verified** → `build/`

## How to read the logs

1. **Start with "Current status" below.** It says what exists and what's next.
2. **Before working on an area,** open its build step(s) from the table. Each one has **Done** (what was built), **Verified** (the exact tests or checks run and their results), **Issues found and fixed**, and sometimes **Not built yet**.
3. **When a rule seems odd,** search `decisions/` for its D-number (e.g. `D48`). Later decision files supersede earlier ones; each file's header says what it supersedes.
4. **Planning history** (the original plan and questions Q1–Q23) is in `planning/`. It's background only.

## Current status (2026-09-14)

| Area | State |
|---|---|
| Pricing engine | ✅ Built and verified |
| Database (local Supabase in Docker) | ✅ Built and verified |
| API (Hono) | ✅ Built and verified |
| POS app, `apps/pos` at `localhost:3001` | ✅ Built and verified |
| Back office, inside the POS at `/admin` | ✅ Built and verified |
| Membership billing (Stripe test mode), sold at the counter | ✅ Built and verified |
| Booking rules in the database (hold, confirm, expiry, cancel/refund) | ✅ Built and verified (6a) |
| **Booking API + website** for customers, member login/account | ❌ **Next: Phase 6b (API), then 6c (website)** |
| Real emails (Resend) | ❌ Console only for now |
| Reports | ❌ Phase 7 |
| Deploy (Vercel + hosted Supabase), go-live | ❌ Phase 7 |

**Test totals at the last step:** pricing 78 · API 96 · pgTAP 327 · e2e 4.

## Build steps (in the order they were done)

| # | Step | File |
|---|---|---|
| 01 | Spec written | [build/01-spec.md](build/01-spec.md) |
| 02 | Monorepo scaffold | [build/02-monorepo-scaffold.md](build/02-monorepo-scaffold.md) |
| 03 | Pricing engine | [build/03-pricing-engine.md](build/03-pricing-engine.md) |
| 04 | Database schema, constraints, RLS, seed | [build/04-database.md](build/04-database.md) |
| 05 | API skeleton, staff auth, PIN operator, audit | [build/05-api-staff-auth-pin.md](build/05-api-staff-auth-pin.md) |
| 06 | POS database functions | [build/06-pos-database-functions.md](build/06-pos-database-functions.md) |
| 07 | POS API | [build/07-pos-api.md](build/07-pos-api.md) |
| 08 | POS web app + first browser test | [build/08-pos-web-app.md](build/08-pos-web-app.md) |
| 09 | Back office (API + screens) | [build/09-back-office.md](build/09-back-office.md) |
| 10 | No overstay charge, time-up pop-up | [build/10-no-overstay-time-up-popup.md](build/10-no-overstay-time-up-popup.md) |
| 11 | Membership billing core (Stripe) | [build/11-membership-billing-core.md](build/11-membership-billing-core.md) |
| 12 | Counter membership sales, back office billing, real Stripe check | [build/12-counter-membership-sales.md](build/12-counter-membership-sales.md) |
| 13 | Online booking rules in the database (6a) | [build/13-booking-database.md](build/13-booking-database.md) |

## Decisions

| File | Covers |
|---|---|
| [01 — 2026-08-10](decisions/01-2026-08-10-pricing-discounts-membership-venue.md) | D1–D8: stacking, multiplicative maths, minimum billing, tiers, Sydney timezone, no F&B, cash controls |
| [02 — 2026-09-14](decisions/02-2026-09-14-stacking-admin-balance-booking-flow.md) | D9–D20: stacking matrix, no cap, admin-editable rules, referral codes, monthly tiers, booking flow, free-play balance, 15-min minimum, Stripe Billing, resources and rates, hours, name |
| [03 — 2026-09-14](decisions/03-2026-09-14-launch-values-policies-staff-hosting.md) | D21–D34: launch values, balance rollover, happy hour, referrals (% or $), POS sales, QR vs login, refund/no-show policy, hardware, staff roles, hosting |
| [04 — 2026-09-14](decisions/04-2026-09-14-final-answers-before-build.md) | D35–D45: name "Raceground", allowances, balance freeze/forfeit, 10-hour cap, cancellation/tier changes, GST display, overrides, USB scanner |
| [05 — 2026-09-14](decisions/05-2026-09-14-pos-build-decisions.md) | D46–D53: single till ✅, frozen quote, **no overstay charge (D48 revised)**, receipts, DB audit trigger, complimentary members, partial refunds |

## Next step — Phase 6: Booking website

Planned sub-steps, each gets its own `build/` file:

1. ✅ **Database** → [build/13](build/13-booking-database.md)
2. **API (next):**
   - public config, availability and quote
   - hold → Stripe Checkout (payment mode, AUD, Adaptive Pricing off)
   - webhook branch for booking payments and expiry
   - signed booking view/cancel links with Stripe refunds
   - member login (Supabase email/password) and account endpoints: balance, card, bookings, billing portal, online membership sign-up
   - confirmation and cancellation emails (with .ics)
   - 24-hour reminder job
   - rate limiting on public endpoints
3. **`apps/booking` website:**
   - home, timetable, booking flow, member login/account, cancel page
   - browser tests including a real Stripe payment

## How to add to the logs

- **A finished build step** → new file `build/NN-short-name.md` (next number). Keep the sections **Done / Verified / Issues found and fixed / Not built yet**, and only mark a step ✅ once its checks actually ran and passed. Add a row to the table above and update "Current status" and "Next step".
- **A new decision or owner answer** → add D-numbered entries to the newest `decisions/` file, or start the next numbered file for a new round. Update the spec to match.
- **A correction to an earlier claim** → say so plainly in the newer file (see `build/10-…`, item 5). Don't rewrite history silently.
