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

## Current status (2026-10-08)

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
| **Phase 8 — public site rebuilt to the owner's reference** | ✅ complete |
| Experiences: flat-price packages in the pricing engine (8a) | ✅ Built and verified |
| Experiences, tournaments and events in the database (8b) | ✅ Built and verified |
| Public API: experiences, promotions, tournaments, events (8c) | ✅ Built and verified |
| The booking website's new look, home, events, tournaments (8d) | ✅ Built and verified |
| The experience grid, booking panel and membership page (8e) | ✅ Built and verified |
| Back office screens for all of the above (8f) | ✅ Built and verified |
| Raceground's own colours and fonts (8i) | ✅ Built and verified — lime on graphite, Chakra Petch + Manrope |
| VR rigs are simulators (8 in all); Double Race listed second (8j) | ✅ Built and verified |
| "Are you a member?" at the top of Details, back to the booking after login (8k) | ✅ Built and verified |
| Pick your game, track and car, with a back office screen (8l) | ✅ Built and verified — **starting list to confirm** |
| Bottom bar (Book now / Events / Explore) and Clothing coming soon (8m) | ✅ Built and verified |
| Flat member prices that never stack, Single/Double Session, the membership poster (8n) | ✅ Built and verified |
| "Before you arrive" rules, arrive-early setting (8o) | ✅ Built and verified |
| Home page tiles with images from the back office (8p) | ✅ Built and verified — **photos to upload** |
| The owner's mockup: new look, new home page, the rig renders, Racegrounds (8q) | ✅ Built and verified |
| Online bookings in whole 30-minute sessions, starting on :00 / :30 (8r) | ✅ Built and verified |
| Walk-ins charged in 15-minute blocks, rounded up (8s) | ✅ Built and verified |
| Sizes and spacing matched to the mockup video, smaller rig (8t) | 🚧 next |
| Garet Bold / Regular on the booking site (8u) | ⏳ waiting for the font files from the owner |
| Real emails (Resend) | ✅ Built (7b); needs a verified domain to switch on |
| Deploy configuration + go-live runbook (7a) | ✅ Built and verified |
| Deploy itself (Vercel + hosted Supabase) | 🚧 **Deployed by the owner.** API `raceground-api.vercel.app`, site `raceground-booking.eatzyeats.com`, POS `raceground-pos.eatzyeats.com`. The owner has applied the Phase 8 migrations; the live site now shows the new hours, prices, tiers and experiences. **Before deploying 8i–8p, run `supabase db push` first** — the new API reads the games, member-price and tile tables and the arrive-early setting. See [build/35](build/35-game-track-car.md) and [build/39](build/39-home-tiles.md). |

**Test totals at the last step:** pricing 114 · API 257 · pgTAP 504 · e2e 21 (8 POS + 13 booking site; 3 of them need `stripe listen`, 1 the venue to be open).

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
| 28 | The experience grid, the three-step booking panel, the membership page (8e) | [build/28-booking-panel-membership.md](build/28-booking-panel-membership.md) |
| 29 | Back office: experiences, tournaments and what's on | [build/29-back-office-experiences.md](build/29-back-office-experiences.md) |
| 30 | New hours, one flat happy hour, tournament entries at the counter (8g) | [build/30-venue-values-counter-entry.md](build/30-venue-values-counter-entry.md) |
| 31 | The live site was down: its database was on the old schema, and the tier perks came with it (8h) | [build/31-live-site-database-behind.md](build/31-live-site-database-behind.md) |
| 32 | Raceground's own look: colours and fonts (8i) | [build/32-own-look.md](build/32-own-look.md) |
| 33 | VR rigs are simulators; Double Race listed second (8j) | [build/33-vr-rigs-are-simulators.md](build/33-vr-rigs-are-simulators.md) |
| 34 | "Are you a member?" at the top of Details (8k) | [build/34-are-you-a-member.md](build/34-are-you-a-member.md) |
| 35 | Pick your game, track and car (8l) | [build/35-game-track-car.md](build/35-game-track-car.md) |
| 36 | The bottom bar and Clothing (8m) | [build/36-bottom-bar-clothing.md](build/36-bottom-bar-clothing.md) |
| 37 | Flat member prices, Single/Double Session, the membership poster (8n) | [build/37-member-prices-sessions-poster.md](build/37-member-prices-sessions-poster.md) |
| 38 | Before you arrive: the session rules (8o) | [build/38-arrive-early-rules.md](build/38-arrive-early-rules.md) |
| 39 | The home page tiles (8p) | [build/39-home-tiles.md](build/39-home-tiles.md) |
| 40 | The owner's mockup: new look, new home page, Racegrounds (8q) | [build/40-mockup-layout.md](build/40-mockup-layout.md) |
| 41 | Online bookings are whole 30-minute sessions, on :00 and :30 (8r) | [build/41-whole-sessions-online.md](build/41-whole-sessions-online.md) |
| 42 | Walk-ins are charged in 15-minute blocks, rounded up (8s) | [build/42-walk-in-blocks.md](build/42-walk-in-blocks.md) |

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
| [12 — 2026-10-08](decisions/12-2026-10-08-sessions-walk-in-blocks-type.md) | D90–D93: **online bookings whole 30-minute sessions on :00/:30 (supersedes D63's 15-minute steps)**, walk-ins charged in 15-minute blocks, sizes from the mockup video, Garet |
| [11 — 2026-10-05](decisions/11-2026-10-05-mockup-layout-racegrounds.md) | D88–D89: the owner's mockup — lime on purple, Unbounded, the new home page and header, the rig renders (**supersedes D76's look**); the name Racegrounds |
| [10 — 2026-10-01](decisions/10-2026-10-01-poster-tiles-rules.md) | D81–D87: bottom bar, **member prices flat and never stacked (supersedes D67's arithmetic)**, Single/Double Session, the membership poster, arrive 15 min early, Clothing coming soon, home page tiles |
| [09 — 2026-09-30](decisions/09-2026-09-30-look-vr-member-prompt-games.md) | D76–D80: our own colours and fonts (**supersedes D64's look**), VR rigs are simulators at the same price, Double Race second, "Are you a member?" with a return to the booking, pick your game/track/car |
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

## Phase 8 — the public site, rebuilt to the owner's reference ✅ complete

The owner supplied `velocitysimlounge.com` as a reference (screenshots and three recordings in `logs/screenshots/`), plus a price list, membership promo prices, and notes on tournaments and event pop-ups. The reference is a **look and flow reference only**: every price, time, resource and rule stays ours. Decisions are in [08](decisions/08-2026-09-23-public-site-experiences-tournaments.md).

1. ✅ **8a** pricing engine: experiences and flat promotional prices → [build/24](build/24-pricing-experiences.md)
2. ✅ **8b** database: experiences, promotions, tournaments, site events, new tier values → [build/25](build/25-experiences-tournaments-database.md)
3. ✅ **8c** API: config, availability, quotes and holds for experiences; tournaments; events → [build/26](build/26-experiences-tournaments-api.md)
4. ✅ **8d** the booking website: new look, home page, events, tournaments, contact → [build/27](build/27-booking-site-look.md)
5. ✅ **8e** the `/book` experience grid, the three-step booking panel with spots left, and the membership page → [build/28](build/28-booking-panel-membership.md)
6. ✅ **8f** back office: screens for experiences, promotional prices, tournaments and events → [build/29](build/29-back-office-experiences.md)

7. ✅ **8g** the owner's venue values, and tournament entries at the counter → [build/30](build/30-venue-values-counter-entry.md)
8. ✅ **8i–8l** the owner's round of 2026-09-30: own look, VR as simulators, member prompt, game/track/car → [build/32](build/32-own-look.md)–[35](build/35-game-track-car.md)
9. ✅ **8m–8p** the owner's round of 2026-10-01: bottom bar, clothing, member prices and the poster, rules, home tiles → [build/36](build/36-bottom-bar-clothing.md)–[39](build/39-home-tiles.md)
10. ✅ **8q** the owner's mockup and the name Racegrounds → [build/40](build/40-mockup-layout.md)

**Still open for the owner** (raised in [08](decisions/08-2026-09-23-public-site-experiences-tournaments.md)):
- ~~Free tournament entry~~ — settled by the poster (D84): Diamond gets one a month.
- **Leaderboard Challenge** has no flat member price (it isn't on the poster), so members pay their percentage off $35 — Silver $31.50 (D82).
- **Home page tile photos** are placeholders until uploaded (D87).
- **Simulators by the hour** have no happy-hour rate. They are sold online as experiences, which do; the hourly rate is only for a walk-in.
- ~~Two happy hour windows~~ — settled by D74: one window, 12:00–15:00 every day, flat prices everywhere.
- **The game/track/car list** (D80) is a starting guess — Assetto Corsa Competizione, Assetto Corsa, F1 25. Confirm or edit in the back office.
- **VR walk-ins** are now $60/hr like the other simulators, with no VR happy-hour rate (D77). Say if VR walk-ins should stay at $50.

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
