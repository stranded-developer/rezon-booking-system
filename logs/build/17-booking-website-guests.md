# Phase 6c-2 — The booking website for guests

**Date:** 2026-09-15
**Decisions:** [D59](../decisions/07-2026-09-15-booking-website.md) lighter public look; [D58](../decisions/07-2026-09-15-booking-website.md) home page content from the back office.

**Done**

**New app `apps/booking`** (Next.js App Router, port 3000). It reads only the public API, holds no secret and never works out a price itself: every amount on screen comes from the API, which re-prices at payment time.

| Page | What a customer can do |
|---|---|
| `/` | Read the intro, see the photos, rates, happy hour, opening hours, address, phone, email and Instagram (all from the back office), and the membership tiers |
| `/book` | Pick type → day → start time → length → table (or "any available"), enter name and email/phone, apply a referral code, see the full price breakdown incl. GST, accept the terms and pay |
| `/booking/[ref]?token=…` | Booking code, QR check-in code, what and when, what was paid, and a cancel link |
| `/booking/[ref]/cancel?token=…` | The refund that applies right now, then cancel |
| `/terms`, `/privacy`, `/refund-policy` | The cancellation rules in full; terms and privacy marked as drafts for Phase 7 |

**How the tricky parts work**
- **Stale prices can't be paid.** The selected time, length and quote are keyed to the current choice, so a quote from an earlier choice is never shown. `POST /bookings/hold` also sends the price the customer saw; if it changed, the site shows the new total and asks again.
- **Someone else takes the slot:** the timetable reloads and the customer picks another time.
- **After Stripe:** the success URL returns to the booking page, which polls for up to a minute while Stripe's webhook confirms. Pressing back at Stripe returns with `abandoned=1`, and the site releases the hold immediately so the time is free for someone else.
- **Link security:** the booking and cancel pages need the token from the email; without it they say "Booking not found" (the API answers the same for a wrong token).
- **Home page renders per request** (`connection()`), so back office changes show straight away. Photos come from Supabase Storage and Next resizes them.

**Verified**
1. **Browser tests, `apps/booking/e2e` (4):**
   - **Home:** rates, happy hour, opening hours and tiers all match the venue's configuration, including a resource type created just for the run; "Book now" opens the flow.
   - **Guest books and cancels (no Stripe):** picks its own booth two days ahead, sees a real quote, gets "that code has already been fully used" for a spent referral code, applies a $1,000 code that makes the booking free, is blocked from confirming until the terms are accepted, lands on a confirmed booking with a code and QR, finds the link refuses a wrong token, then cancels with the full-refund rule shown and sees the booking as cancelled.
   - **Legal pages** explain the 24-hour and 2-hour rules and that Stripe handles payments.
   - **Real Stripe payment** (`E2E_STRIPE=1` + `stripe listen`): pays $13.50 with a test card on Stripe Checkout, comes back to the booking page, waits for the webhook, and sees the booking confirmed. The database has the booking `confirmed`, a `stripe` payment whose reference matches the PaymentIntent, and after cancelling more than 24 hours ahead, a refund row with a real Stripe `re_…` id, with the page showing "We've refunded $13.50".
2. **Mutation check, 7 deliberate breaks, 7 killed:** price not checked at payment, terms not required, referral code dropped when booking, booking link token ignored, cancel sends a different refund, rates missing from the home page, no check-in QR on the confirmation.
   - "Price not checked at payment" survived the free-booking test (expecting $0 is right when the total is $0) and was killed by the real-payment test. Worth remembering: the money checks need the paid test.
3. **Gate** (clean `db reset`, same command as the commit):
   - pgTAP 372
   - turbo typecheck/lint/test 11/11 (pricing 78, API 161)
   - POS build + e2e **4 passed** (with `stripe listen`)
   - booking build + e2e **4 passed** (with `stripe listen`)

**Issues found and fixed**
1. **The home page was baked at build time** and served a stale "system is having a moment" page: the first build ran while the API was down, and every visitor kept getting that page. It now renders per request. This would have shipped a home page frozen at deploy time.
2. **Lint caught three real React problems:** state set during an effect in three places (cascading renders) and `Date.now()` during render. Fixed by deriving the values from the current choice instead of storing copies — which is also what stops a stale quote being shown.
3. **44 duration buttons** (up to 11 hours in 15-minute steps) were unusable. Now: quick buttons for 30 min, 1 h, 1 h 30, 2 h, plus a dropdown with every length that fits.
4. The resource question read "Which e2e booth cf75c2?" because the type name was lowercased. It now uses the name as it is.
5. Test-only fixes: `getByLabel("Email")` also matched the phone hint; `role=alert` also matched Next's route announcer; a booking made tomorrow evening fell into the half-refund window, so the tests now book two days ahead.

**Not built yet**
- **Members on the website (6c-3):** sign up, log in, forgot/reset password, member discount and free minutes in the flow, the account page, and joining a membership online (account first, D60). The booking flow currently says member login is coming soon, and the home page says to join at the counter.
- **Back office Bookings page (6c-4).**
- Real emails (Resend) and the final legal wording, both Phase 7.
