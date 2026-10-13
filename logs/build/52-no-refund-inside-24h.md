# Step 52 — No refund inside 24 hours

**Date:** 2026-10-13
**Decisions:** [D101](../decisions/14-2026-10-13-explore-wording-happy-hour.md).

**Done**

- **Database:** migration `20261013003200_no_refund_inside_24_hours.sql` replaces `booking_cancel_quote`: 24 hours or more before the start → full refund and free minutes back; inside 24 hours → `too_late` (no refund, no online cancel). The venue-fault rule and staff overrides are unchanged. Who can call it is unchanged (API only).
- **API:** `/public/config` `refundPolicy` is now `{ fullRefundHoursBefore: 24 }`. The "too late" messages and both emails (confirmation, reminder) say 24 hours and no refund.
- **Booking site:** the refund policy page, the cancel page and the Cancellations box before paying say: full refund 24 hours or more before; inside that, no cancelling and no refund. The refund page now links to the terms and mentions the Australian Consumer Law (as the owner's terms do), instead of "the full terms are being finalised".
- **Back office → Bookings:** "Less than 24 hours before the start: no refund applies unless it's the venue's fault or you set an amount."
- Spec: `booking-site.md` (policy table), `data-model.md`.

**Verified**

1. pgTAP `08_bookings`: exactly 24 h before is a full refund; one second under is refused (`too_late`); under 2 h is refused too; a customer cancel 10 h ahead (the old half-refund case) is refused; a cancel 29 h ahead refunds in full; staff overrides and venue fault still work at any time.
2. API: a customer cancel 23 h and 1.5 h ahead is refused, then 24 h+ works; back office "under 24 hours needs a venue-fault cancel or a set refund"; **real Stripe (test mode):** a paid booking 10 h ahead shows "not allowed", refuses every refund amount, and nothing is refunded in Stripe.
3. POS browser test: the back office shows "Less than 24 hours before the start" for a booking 3 hours out.
4. **Gate:** see the commit for this step.

**Issues found and fixed**

1. The first API run still got the old 50% answer: the migration hadn't been applied to the local database (a cut-off command). Applied with `supabase migration up`; all 49 tests in those files pass.

**For the live site**

- `supabase db push` before deploying, as for step 48. Bookings already made are covered by the new rule from then on.
2. The gate's POS browser test had a second check on a booking starting within 2 hours that still expected "Less than 2 hours before the start" and the API's "2 hours" message; both now expect the 24-hour wording.
3. The booking site's "legal pages" browser test clicked the link named "Terms", which now also matched the refund page's new "terms and conditions" link. It matches exactly now, and also checks the page says "Less than 24 hours before" and no longer mentions 50%.
