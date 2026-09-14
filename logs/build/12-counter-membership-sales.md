# Phase 5b — Selling memberships at the counter, back office billing, real Stripe check ✅

**Date:** 2026-09-14

**Done**
- **POS "Sell membership":** pick a Stripe-synced tier, name/email/phone → **payment QR** of the Stripe Checkout link (+ "open on this screen") → polls the member every 3 s (passive) → "Membership active ✓ · 60 min free play ready" → **Print member card**.
- **Back office:**
  - Members: Membership section with billing type and next renewal, change tier (paid: at renewal; complimentary: immediately), cancel at end of paid month / undo
  - Tiers: **Sync with Stripe** button, a warning for unsynced tiers, and price-change copy updated
- **API:**
  - `/pos/config` tiers now carry a `sellable` flag (has a Stripe price) instead of being filtered, so complimentary members can still use every tier
  - Webhook secret and cron secret added to the git-ignored `apps/api/.env.local` (the whsec comes from `stripe listen --print-secret`)

**Issues found and fixed**
1. **Adaptive Pricing** (found by probing the real Stripe Checkout page from this laptop, which is in Jakarta).
   - **What happened:** Stripe showed the Silver membership as **IDR 1,308,241.92/month** with an IDR/AUD switch. Customers abroad would have been charged in their own currency, and the webhook would have recorded that amount as AUD cents.
   - **Fix:** counter checkouts set `adaptive_pricing: { enabled: false }`, and the webhook refuses a membership invoice that isn't `aud` (500, event left unprocessed, nothing recorded).
   - **Verified:** re-probed the page → A$100.00, no IDR, no switch. The session test asserts adaptive pricing is off. A new test delivers a signed IDR invoice → 500, `processed_at` null, no payment.
2. **Staff page N+1** (found while chasing an intermittent back office e2e failure).
   - **Finding:** the failure happened once in a full gated run. Twelve reruns in other orders wouldn't reproduce it. The one remaining difference was a fresh `next build` just before, i.e. a cold start. That reproduced on the first try: the Staff row wasn't visible within 5 s.
   - **Cause:** `listStaff` looked up every staff email with its own auth call. Measured 117 lookups = **4,383 ms** vs one paged `listUsers` = **258 ms**.
   - **Fix:** paged `listUsers`. The failing sequence (build → admin e2e) now passes 3/3.
3. **Test left state behind:** the "bad signature" test used a fixed `evt_fake` id, which a signature mutation run had stored. It now uses a unique id per run, and the leftover row was deleted.

**Verified**
1. **Real end-to-end payment, `e2e/membership.spec.ts`** (runs with `E2E_STRIPE=1` and `stripe listen` forwarding):
   - owner syncs tiers from the back office
   - cashier view "Sell membership" → Silver → payment QR
   - a second browser page acts as the customer's phone: the real Stripe Checkout (asserts 100.00 and no IDR), test Visa 4242, Subscribe → `/checkout/complete`
   - `stripe listen` forwarded the genuine events (invoice.paid, customer.subscription.created, checkout.session.completed arriving out of order, then updates) and the API answered 200 to every one
   - the POS switched to "Membership active · Silver · 60 min free play ready" on its own
   - card printed
   - DB: active, `qr_token_hash` set, one $100.00 Stripe payment
   - back office: "Billed monthly through Stripe" → cancel at end of paid month (Stripe `cancel_at_period_end` true, status cancelling) → undo (false)
   - teardown cancels the test subscription
   - Screenshots reviewed.
2. **Full gate:**
   - turbo typecheck / lint / test: pricing 78, API 96
   - pgTAP 245
   - e2e 4/4 including real Stripe, repeated in full twice

**How to run billing locally**
- `stripe listen --forward-to localhost:8787/webhooks/stripe` in one terminal (uses the owner's Stripe CLI login)
- then the API and POS as usual
- counter sales, renewals and cancellations flow through test mode
