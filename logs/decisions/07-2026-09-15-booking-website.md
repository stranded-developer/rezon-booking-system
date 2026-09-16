# Raceground — Decisions Log #7 — Booking Website (Phase 6c)

**Date:** 2026-09-15
**Status:** D58–D60 follow the owner's answers in chat before Phase 6c started.

---

## D58 — Venue contact details and photos are editable in the back office ✅ owner 2026-09-15

**Decision:**
- The home page shows the venue's **address, phone, contact email, a short intro and an Instagram link**. A superadmin edits them in **Venue & hours** in the back office, like the business name and ABN.
- **Photos** are uploaded, captioned, ordered and removed in the back office too. The booking site shows them on the home page.
- Photos are kept in **Supabase Storage** (a public `venue-photos` bucket). Only the API uploads or deletes them, like every other write. Visitors can view them but never upload.
- Every change is audited.

**Why:**
- None of these details were in the spec or the database.
- The owner chose back office editing over placeholders so the site can be kept current without a developer.

**Note:** Local Supabase now starts its Storage service. The hosted project gets the bucket from the same migration.

## D59 — The booking website has a lighter public look ✅ owner 2026-09-15

**Decision:**
- The booking site uses a **light background** with the same RACEGROUND wordmark and lime "flag" accent as the POS.
- The POS and back office stay dark.

**Why:** The owner prefers a lighter, consumer-style site for the public.

## D60 — Buying a membership online: account first, then pay ✅ owner 2026-09-15

**Decision:**
- **Guests booking a session never log in.** They give a name plus an email or phone (booking-site.md §3). This is unchanged.
- **Buying a membership on the website** goes: create account → confirm the email → log in → pay on Stripe Checkout.
- This is how the 6b-2 API already works, and it keeps D56 intact: nobody can take over a counter member's membership by signing up with their email.

**Why:** The owner confirmed the order after it was clarified that the question was only about buying a membership, not about booking.

## D61 — Memberships can be paid for at the counter ✅ owner 2026-09-16

**Decision:**
- Alongside the Stripe subscription sold by QR, staff can sell a membership paid **at the counter** in cash or on the card terminal.
- Sold in whole terms: **1, 3, 6, 9 or 12 months**, priced at the tier's monthly price × the months. Staff cannot change the amount.
- The free minutes for every month paid for are granted at once, still capped by the tier's balance cap.
- There is **no recurring payment**. The membership runs until its end date and then simply stops. Staff sell it again to continue it; renewing early adds to the time already paid for.
- At the end: benefits stop, and the balance is frozen for 30 days then forfeited — the same as a membership that ends on Stripe.
- A membership already billed online cannot be sold over the counter; it is changed in Stripe.

**Why:** not every customer wants to hand over a card for a subscription, and the venue already takes cash and card at the till. It also means memberships can be sold before Stripe is connected at all.

**Limitations, accepted:**
- Nothing renews itself and nobody is reminded — expiry is silent unless someone looks.
- The customer has no Stripe portal, no invoices and no automatic receipts for these.
- Refunds go through the till's own partial refund, not Stripe.

## D62 — A complimentary membership no longer needs a reason ✅ owner 2026-09-16

**Decision:** the reason field when creating a free membership is optional.

**Why:** the owner wants it faster to use. The audit log still records who created it and when, and the reason is kept when one is given — only the requirement is dropped.

## D63 — Time is sold in 30-minute sessions ✅ owner 2026-09-16

**Decision:**
- **A session is 30 minutes**, set once for the whole venue (editable in the back office).
- **Booked online:** at least one session, then 15-minute steps — 30, 45, 60, 75 … Half a session cannot be booked.
- **Walk-in:** unchanged. From the resource type's own minimum (15 minutes), billed by the minute.
- **Member free play per month, in sessions:** Silver 2 (1 hour), Gold 4 (2 hours), Diamond 8 (4 hours). Unused minutes still roll over, now capped at **ten months' worth** per tier: 600, 1200 and 2400 minutes.
- **Free play is spent the way the time is sold:** on a booking, a whole session and then 15-minute steps; at the counter, 15-minute blocks, so a half-session walk-in costs half a session.

**Why:** a 15-minute booking is not worth the slot it holds, while a walk-in that plays 15 minutes should still pay for 15. Selling in sessions also makes the membership benefit easy to say out loud: "Gold gives you four free sessions a month."

**Note:** this changes what Gold and Diamond earn each month (60 → 120 and 240 minutes). Existing members keep the balance they have and earn the new amount from their next renewal.
