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

## Current status (2026-09-15)

| Area | State |
|---|---|
| Pricing engine | ✅ Built and verified |
| Database (local Supabase in Docker) | ✅ Built and verified |
| API (Hono) | ✅ Built and verified |
| POS app, `apps/pos` at `localhost:3001` | ✅ Built and verified |
| Back office, inside the POS at `/admin` | ✅ Built and verified |
| Membership billing (Stripe test mode), sold at the counter | ✅ Built and verified |
| Booking rules in the database (hold, confirm, expiry, cancel/refund) | ✅ Built and verified (6a) |
| Public booking API: availability, quote, hold, Stripe payment, cancel links, emails (6b-1) | ✅ Built and verified |
| Member accounts API: login, member pricing, QR, online membership, portal, reminders, back office booking cancel (6b-2) | ✅ Built and verified |
| Venue contact details + website photos in the back office (6c-1) | ✅ Built and verified |
| Booking website for guests: home, timetable, booking, payment, cancel (6c-2) | ✅ Built and verified |
| Members on the website: login, account, member pricing, join online (6c-3) | ✅ Built and verified |
| Back office Bookings page (6c-4) | ✅ Built and verified |
| Reports | ❌ Phase 7 |
| Real emails (Resend) | ❌ Console only for now |
| Deploy configuration + go-live runbook (7a) | ✅ Built and verified |
| Deploy itself (Vercel + hosted Supabase), go-live | ❌ Owner sets up the accounts; see [spec/deploy.md](../spec/deploy.md) |

**Test totals at the last step:** pricing 78 · API 168 · pgTAP 372 · e2e 12 (5 POS + 7 booking site; 3 of them need `stripe listen`).

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
| 14 | Public booking API + Stripe payments and refunds (6b-1) | [build/14-booking-api-public.md](build/14-booking-api-public.md) |
| 15 | Member accounts API, online membership, reminders, back office booking cancel (6b-2) | [build/15-member-accounts-api.md](build/15-member-accounts-api.md) |
| 16 | Venue contact details and website photos in the back office (6c-1) | [build/16-venue-details-photos.md](build/16-venue-details-photos.md) |
| 17 | Booking website for guests, with a real Stripe payment (6c-2) | [build/17-booking-website-guests.md](build/17-booking-website-guests.md) |
| 18 | Members on the website: accounts, member pricing, joining online (6c-3) | [build/18-booking-website-members.md](build/18-booking-website-members.md) |
| 19 | Back office Bookings page (6c-4) — **Phase 6 complete** | [build/19-back-office-bookings.md](build/19-back-office-bookings.md) |
| 20 | Deploy preparation: Vercel config, cron over GET, go-live runbook (7a) | [build/20-deploy-preparation.md](build/20-deploy-preparation.md) |

## Decisions

| File | Covers |
|---|---|
| [01 — 2026-08-10](decisions/01-2026-08-10-pricing-discounts-membership-venue.md) | D1–D8: stacking, multiplicative maths, minimum billing, tiers, Sydney timezone, no F&B, cash controls |
| [02 — 2026-09-14](decisions/02-2026-09-14-stacking-admin-balance-booking-flow.md) | D9–D20: stacking matrix, no cap, admin-editable rules, referral codes, monthly tiers, booking flow, free-play balance, 15-min minimum, Stripe Billing, resources and rates, hours, name |
| [03 — 2026-09-14](decisions/03-2026-09-14-launch-values-policies-staff-hosting.md) | D21–D34: launch values, balance rollover, happy hour, referrals (% or $), POS sales, QR vs login, refund/no-show policy, hardware, staff roles, hosting |
| [04 — 2026-09-14](decisions/04-2026-09-14-final-answers-before-build.md) | D35–D45: name "Raceground", allowances, balance freeze/forfeit, 10-hour cap, cancellation/tier changes, GST display, overrides, USB scanner |
| [05 — 2026-09-14](decisions/05-2026-09-14-pos-build-decisions.md) | D46–D53: single till ✅, frozen quote, **no overstay charge (D48 revised)**, receipts, DB audit trigger, complimentary members, partial refunds |
| [06 — 2026-09-15](decisions/06-2026-09-15-booking-site-accounts.md) | D54–D57: daily reminders ✅, three Vercel projects, confirmed-email account linking, re-showable member QR |
| [07 — 2026-09-15](decisions/07-2026-09-15-booking-website.md) | D58–D60: venue details + photos editable in the back office ✅, lighter public look ✅, join online account-first ✅ |

## Phase 6 — Booking website ✅ complete

Planned sub-steps, each gets its own `build/` file:

1. ✅ **Database** → [build/13](build/13-booking-database.md)
2. **API**
   - ✅ 6b-1 public booking API, Stripe payments/refunds, emails, rate limits → [build/14](build/14-booking-api-public.md)
   - ✅ 6b-2 member accounts, online membership, portal, daily reminders, back office booking cancel API → [build/15](build/15-member-accounts-api.md)
3. **Website:**
   - ✅ 6c-1 venue contact details + photos, editable in the back office → [build/16](build/16-venue-details-photos.md)
   - ✅ 6c-2 `apps/booking` for guests: home, timetable, booking flow with referral codes, Stripe payment, booking and cancel pages, legal pages → [build/17](build/17-booking-website-guests.md)
   - ✅ 6c-3 members on the website: accounts, member pricing and free play, account page, joining online → [build/18](build/18-booking-website-members.md)
   - ✅ 6c-4 back office Bookings page in the POS app (list, search, cancel with refund) → [build/19](build/19-back-office-bookings.md)

## Next step — Phase 7

- Reports (revenue, discounts, usage, membership, free play, staff) with CSV export
- Real emails through Resend (a custom domain is needed; `.vercel.app` can't be verified)
- Auth emails through Resend SMTP on hosted Supabase (its built-in sender is rate limited)
- Final wording for the terms and privacy pages
- ✅ Deploy configuration and the go-live runbook → [build/20](build/20-deploy-preparation.md), [spec/deploy.md](../spec/deploy.md)
- The deploy itself: the owner creates GitHub, Vercel, Supabase, Resend and Stripe accounts, then we follow the runbook together

## How to add to the logs

- **A finished build step** → new file `build/NN-short-name.md` (next number). Keep the sections **Done / Verified / Issues found and fixed / Not built yet**, and only mark a step ✅ once its checks actually ran and passed. Add a row to the table above and update "Current status" and "Next step".
- **A new decision or owner answer** → add D-numbered entries to the newest `decisions/` file, or start the next numbered file for a new round. Update the spec to match.
- **A correction to an earlier claim** → say so plainly in the newer file (see `build/10-…`, item 5). Don't rewrite history silently.
