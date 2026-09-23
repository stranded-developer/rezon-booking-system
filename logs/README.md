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

## Current status (2026-09-23)

| Area | State |
|---|---|
| Pricing engine | ✅ Built and verified |
| Database (local Supabase in Docker) | ✅ Built and verified |
| API (Hono) | ✅ Built and verified |
| POS app, `apps/pos` at `localhost:3001` | ✅ Built and verified |
| Back office, inside the POS at `/admin` | ✅ Built and verified |
| Membership billing: Stripe subscriptions, or paid at the counter (7c) | ✅ Built and verified |
| Booking rules in the database (hold, confirm, expiry, cancel/refund) | ✅ Built and verified (6a) |
| Public booking API: availability, quote, hold, Stripe payment, cancel links, emails (6b-1) | ✅ Built and verified |
| Member accounts API: login, member pricing, QR, online membership, portal, reminders, back office booking cancel (6b-2) | ✅ Built and verified |
| Venue contact details + website photos in the back office (6c-1) | ✅ Built and verified |
| Booking website for guests: home, timetable, booking, payment, cancel (6c-2) | ✅ Built and verified |
| Members on the website: login, account, member pricing, join online (6c-3) | ✅ Built and verified |
| Back office Bookings page (6c-4) | ✅ Built and verified |
| Reports | ❌ Phase 7 |
| **Phase 8 — public site rebuilt to the owner's reference** | 🚧 in progress |
| Experiences: flat-price packages in the pricing engine (8a) | ✅ Built and verified |
| Experiences, tournaments and events in the database (8b) | ✅ Built and verified |
| Public API: experiences, promotions, tournaments, events (8c) | ✅ Built and verified |
| The booking website's new look, home, events, tournaments (8d) | ✅ Built and verified |
| The experience grid and three-step booking panel (8e) | ❌ Next |
| Back office screens for all of the above (8f) | ❌ Next |
| Real emails (Resend) | ✅ Built (7b); needs a verified domain to switch on |
| Deploy configuration + go-live runbook (7a) | ✅ Built and verified |
| Deploy itself (Vercel + hosted Supabase), go-live | ❌ Owner sets up the accounts; see [spec/deploy.md](../spec/deploy.md) |

**Test totals at the last step:** pricing 101 · API 213 · pgTAP 456 · e2e 17 (6 POS + 11 booking site; 4 of them need `stripe listen` or the venue to be open).

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
| 21 | Real emails through Resend (7b) | [build/21-resend-email.md](build/21-resend-email.md) |
| 22 | Memberships paid for at the counter (7c) | [build/22-counter-membership.md](build/22-counter-membership.md) |
| 23 | Time sold in 30-minute sessions; member free play in sessions (7d) | [build/23-sessions.md](build/23-sessions.md) |
| 24 | Experiences in the pricing engine: flat prices, flat promotions (8a) | [build/24-pricing-experiences.md](build/24-pricing-experiences.md) |
| 25 | Experiences, tournaments and site events in the database (8b) | [build/25-experiences-tournaments-database.md](build/25-experiences-tournaments-database.md) |
| 26 | The API serves experiences, tournaments and events (8c) | [build/26-experiences-tournaments-api.md](build/26-experiences-tournaments-api.md) |
| 27 | The booking site's new look, home page, events and tournaments (8d) | [build/27-booking-site-look.md](build/27-booking-site-look.md) |

## Decisions

| File | Covers |
|---|---|
| [01 — 2026-08-10](decisions/01-2026-08-10-pricing-discounts-membership-venue.md) | D1–D8: stacking, multiplicative maths, minimum billing, tiers, Sydney timezone, no F&B, cash controls |
| [02 — 2026-09-14](decisions/02-2026-09-14-stacking-admin-balance-booking-flow.md) | D9–D20: stacking matrix, no cap, admin-editable rules, referral codes, monthly tiers, booking flow, free-play balance, 15-min minimum, Stripe Billing, resources and rates, hours, name |
| [03 — 2026-09-14](decisions/03-2026-09-14-launch-values-policies-staff-hosting.md) | D21–D34: launch values, balance rollover, happy hour, referrals (% or $), POS sales, QR vs login, refund/no-show policy, hardware, staff roles, hosting |
| [04 — 2026-09-14](decisions/04-2026-09-14-final-answers-before-build.md) | D35–D45: name "Raceground", allowances, balance freeze/forfeit, 10-hour cap, cancellation/tier changes, GST display, overrides, USB scanner |
| [05 — 2026-09-14](decisions/05-2026-09-14-pos-build-decisions.md) | D46–D53: single till ✅, frozen quote, **no overstay charge (D48 revised)**, receipts, DB audit trigger, complimentary members, partial refunds |
| [06 — 2026-09-15](decisions/06-2026-09-15-booking-site-accounts.md) | D54–D57: daily reminders ✅, three Vercel projects, confirmed-email account linking, re-showable member QR |
| [07 — 2026-09-15](decisions/07-2026-09-15-booking-website.md) | D58–D63: venue details + photos in the back office ✅, lighter public look ✅, join online account-first ✅, memberships paid at the counter ✅, optional reason on complimentary members ✅, 30-minute sessions with free play in sessions ✅ |
| [08 — 2026-09-23](decisions/08-2026-09-23-public-site-experiences-tournaments.md) | D64–D72: dark racing look (**supersedes D59**), experiences at flat prices, flat promotional prices, new membership values and listed perks, tournaments, event pop-up and banner, spots left, three-step booking panel, new home page |

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

## Phase 8 — the public site, rebuilt to the owner's reference

The owner supplied `velocitysimlounge.com` as a reference (screenshots and three recordings in `logs/screenshots/`), plus a price list, membership promo prices, and notes on tournaments and event pop-ups. The reference is a **look and flow reference only**: every price, time, resource and rule stays ours. Decisions are in [08](decisions/08-2026-09-23-public-site-experiences-tournaments.md).

1. ✅ **8a** pricing engine: experiences and flat promotional prices → [build/24](build/24-pricing-experiences.md)
2. ✅ **8b** database: experiences, promotions, tournaments, site events, new tier values → [build/25](build/25-experiences-tournaments-database.md)
3. ✅ **8c** API: config, availability, quotes and holds for experiences; tournaments; events → [build/26](build/26-experiences-tournaments-api.md)
4. ✅ **8d** the booking website: new look, home page, events, tournaments, contact → [build/27](build/27-booking-site-look.md)
5. **8e** the `/book` experience grid, the three-step booking panel with spots left, and the membership page
6. **8f** back office: screens for experiences, promotional prices, tournaments and events

**Still open for the owner** (raised in [08](decisions/08-2026-09-23-public-site-experiences-tournaments.md)):
- The venue now has **two happy hour windows** — 10:00–15:00 on the hourly rate for billiards, VR and walk-ins, and 12:00–15:00 on the simulator experiences. Both are editable; they need aligning.
- **Free tournament entry** is built and set to 0 for every tier. The written brief describes it as a Diamond perk; the answer to the perks question did not include it.

## Next step — Phase 7

- Reports (revenue, discounts, usage, membership, free play, staff) with CSV export
- ✅ Real emails through Resend → [build/21](build/21-resend-email.md); switch on with a verified domain
- Auth emails through Resend SMTP on hosted Supabase (its built-in sender is rate limited)
- Final wording for the terms and privacy pages
- ✅ Deploy configuration and the go-live runbook → [build/20](build/20-deploy-preparation.md), [spec/deploy.md](../spec/deploy.md)
- The deploy itself: the owner creates GitHub, Vercel, Supabase, Resend and Stripe accounts, then we follow the runbook together

## How to add to the logs

- **A finished build step** → new file `build/NN-short-name.md` (next number). Keep the sections **Done / Verified / Issues found and fixed / Not built yet**, and only mark a step ✅ once its checks actually ran and passed. Add a row to the table above and update "Current status" and "Next step".
- **A new decision or owner answer** → add D-numbered entries to the newest `decisions/` file, or start the next numbered file for a new round. Update the spec to match.
- **A correction to an earlier claim** → say so plainly in the newer file (see `build/10-…`, item 5). Don't rewrite history silently.
