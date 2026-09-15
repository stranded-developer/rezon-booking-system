# Phase 6b-1 — Public booking API: availability, quote, hold, Stripe payment, cancel links

**Date:** 2026-09-15

**Done**

**Database** (migration `20260915001300_rate_limits.sql`)
- `rate_limits` table + `rate_limit_hit(key, limit, window, now)`: fixed-window counters in Postgres, shared by every API instance. On Vercel an in-memory counter wouldn't be.

**API** (`services/bookings.ts`, `routes/public.ts`)

| Endpoint | What it does |
|---|---|
| `GET /public/config` | Venue settings, today's venue date, resource types with resources, hours, happy hours, rate bands, tiers (no Stripe ids) |
| `GET /public/availability?type&date` | For every 15-min start from the 30-min cutoff to close: free resources and the longest length on each. Nothing outside the 7-day window or on closed days. Unexpired holds block. |
| `POST /public/quote` | The one pricing engine, with a referral code; venue date + wall time in, DST gaps refused |
| `POST /public/referral/check` | Valid / not found / used up (live holds count as uses) |
| `POST /bookings/hold` | Re-prices; refuses if the price changed since the customer saw it; "any available" tries resources in order; $0 → confirmed now; otherwise Stripe Checkout (AUD, cards only, Adaptive Pricing off, ~31 min expiry inside the 40-min hold) |
| `GET /bookings/:ref?token` | Booking page data incl. cancellation quote; wrong token looks like "not found" (timing-safe) |
| `POST /bookings/:ref/cancel` | Refund must match what the customer saw → Stripe refund (reuses one already made for this cancel) → DB cancel → email |
| `POST /bookings/:ref/abandon` | Customer backed out of Checkout: expire it on Stripe and free the slot (not if already paid) |
| Webhook `checkout.session.completed` (payment) | Confirm (paid, AUD only); a payment for a released hold is fully refunded, audited, customer emailed; retries never double-refund |
| Webhook `checkout.session.expired` | Release the hold |
| `POST /cron/holds` | Expire stale holds (cron secret) |

- **Emails** (console transport): confirmation with `.ics` calendar invite, check-in code and view/cancel link; cancellation with refund; late-payment refund.
- **Rate limits per IP:**
  - public reads 300/min
  - quotes 120/min
  - referral checks 10/min
  - holds 10 per 10 min
  - booking links 30/min
- **Refactor:** Stripe helpers moved to `lib/stripe.ts` (shared by billing and bookings).
- **Spec updated:** `architecture.md` (endpoints, rate limits), `booking-site.md` §6 implementation notes, `data-model.md` (rate_limits).

**Design choices**
1. **The link token travels in the Checkout session metadata.** Only the hash is stored, but the webhook needs the token to put the link in the confirmation email. Only the Stripe account (the owner) can see metadata, and the same link is already in the Checkout return URL.
2. **Cards only in Checkout.** Delayed payment methods would "complete" before the money arrives; with cards, completed means paid. Apple Pay / Google Pay still work (they are cards).
3. **Times go in as venue date + wall time**, so a visitor's phone timezone can't shift a booking.

**Verified**
1. **pgTAP `09_rate_limits` (9):** windows, per-key counting, reset, privileges. `01_schema_seed` table list updated. Full pgTAP **336/336**.
2. **`test/bookings.integration.test.ts`, 23 tests.** Local DB, fixed clock Mon 11 Feb 2030, its own resource type so reruns never collide. Covers:
   - config
   - availability: cutoff (first start 10:45 at 10:10), last start 20:45, 41 slots, window edges, key or id
   - quote at base rate and with happy hour; referral codes: valid, not found, live hold counts as a use, 11th check in a minute → 429 with `Retry-After`
   - holds:
     - no Stripe configured → 503 with nothing left held
     - price changed → 409 with the new quote
     - missing terms or contact → 422
     - $0 booking confirmed with an email containing the link and a valid `.ics` (UTC times, folded lines)
     - second customer goes on Bay B, a third gets `slot_taken`
   - viewing a booking only with its token
   - cancelling: < 2 h refused, ≥ 24 h works with an email, can't cancel twice
   - signed webhooks: confirm once (duplicate and re-delivered events do nothing), IDR refused, unpaid ignored, expired released, non-booking ignored
   - an expired hold stops blocking the timetable before cleanup
   - cron needs its secret
3. **`test/bookings-stripe.integration.test.ts`, 6 tests against real Stripe test mode, real clock:**
   - Real Checkout session checked on Stripe: AUD, exact total, cards only, Adaptive Pricing off, expires within 31 min, hold outlives it.
   - Abandon: Stripe session expired, slot free again.
   - Real Visa PaymentIntent confirmed through the webhook, then a cancel ≥ 24 h made a **real Stripe refund** of the full amount, matching the DB refund row.
   - An earlier refund for the same cancel is reused (Stripe still shows one refund).
   - A cancel 10 h before refused the stale amount (no refund made), then refunded **half** on Stripe.
   - A payment arriving after release is **fully refunded on Stripe**, audited and emailed; a repeat delivery doesn't refund again.
4. Both suites ran twice back to back on the used local database: **29/29 both times**.
5. **Mutation check, 22 deliberate breaks** in the API code, including:
   - token check, price re-check, the Stripe-before-hold check, resource fallback
   - Checkout expiry, Adaptive Pricing, cards only, unpaid/currency checks
   - late-payment refund, refund re-check, reusing an existing refund, idempotency key
   - expired holds, reservation counting, cutoff, window
   - rate limit, terms, webhook wiring, confirmation email

   **22/22 killed.**
6. **Gate** after a clean `db reset`:
   - pgTAP **336/336**
   - turbo typecheck/lint/test **9/9** (pricing 78, API **125** = 96 + 29, Stripe suites included)
   - POS build + e2e **3 passed, 1 skipped**. The skipped one is the real-Stripe membership e2e, which needs `stripe listen`. Membership billing code only changed by moving the Stripe helpers, and its Stripe integration suite passed.

**Issues found and fixed**
1. **Test assumption, not a code bug:** a phone-only guest fixture used a fixed phone number. On the second run the guest was correctly matched to the earlier customer, whose email was already saved, so the "email saved from Stripe" assertion failed. Each run now uses its own phone number.
2. A Supabase `insert().select().order()` in a test fixture returned nothing; the fixture now checks errors and sorts in code.

**Not built yet (6b-2)**
- Member login on the booking flow (member discount, free minutes online), `/me` account endpoints, online membership sign-up, Stripe customer portal, tier change from the account.
- 24-hour reminder emails + the hourly-cron decision.
- Back office booking list/cancel with venue-fault refunds.
