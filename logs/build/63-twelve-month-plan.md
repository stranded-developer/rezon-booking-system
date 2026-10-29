# 63 — The 12-month membership plan, paid monthly

**Date:** 2026-10-29
**Decision:** [D114](../decisions/15-2026-10-29-twelve-month-plan-walk-in-packages.md).

**Checked first:** monthly rolling already existed. *Sell membership → On their phone* (and *Join* on the website) is a Stripe subscription that renews until cancelled. The *At the counter* sale (D61) is paid up front because the CommBank terminal isn't connected to Stripe: the card never reaches our system, so it can't be charged again. The owner keeps the phone QR for counter sign-ups.

**Done**

- **Database** (`20261029003800_twelve_month_plan.sql`): `members.term_ends_at`. `membership_sync_subscription` takes `termEndsAt`. If Stripe's `cancel_at` equals the plan's own end, the member stays `active`, not `cancelling`; any other end date is still a cancellation. `cancelAt` is now passed as an ISO time.
- **API**
  - `POST /pos/memberships/checkout` and `POST /me/membership/checkout` take `plan: "monthly" | "twelve_months"` (default monthly). The 12-month plan puts `term_months: "12"` in the subscription's metadata.
  - `syncSubscription`: when a fixed-term subscription is active and has no end date yet, it sets Stripe's `cancel_at` to the billing anchor + 12 months, with no proration. That is the end of the 12th paid period, so Stripe takes exactly 12 payments. `termEnd()` clamps a 31st to the month's last day, as Stripe's periods do. If staff end it early (cancel at period end) that end stands; if they undo it, the 12-month end is set again.
  - The member can't cancel: `/me/membership/cancel` answers `fixed_term`. Their Stripe portal uses a second configuration (`member_portal_fixed_term_v1`) with cancelling turned off.
  - The account (`termEndsAt`) and the back office member detail show the plan.
- **Till:** *On their phone* has a **Plan** choice ("Monthly, until cancelled" / "12 months, paid monthly") with one line explaining each.
  - **Also fixed:** the till kept the tier list it loaded at sign-in. Tiers synced with Stripe in the back office weren't sellable until the page was reloaded. *Sell membership* now refreshes it when it opens, and so does a table's dialog (for packages, step 64).
- **Website account page:** "12-month plan — last payment covers until …", and no Cancel button while it runs.
- **Spec:** `membership.md` §1b (why the terminal can't do rolling payments; the plan and how it works), §2, §5; `pos.md` §5a; `booking-site.md`; `data-model.md`; `README.md` launch values.

**Verified**

1. **pgTAP `18_twelve_month_plan` (10):**
   - the plan's own end is not a cancellation, and the end date is recorded;
   - a payment keeps it active;
   - ended early by staff, or any other end date, means `cancelling`;
   - back to the plan's end means `active`;
   - after the last payment it is `ended`;
   - rejoining on a rolling plan clears the old end.
2. **Unit (3 new):** `termEnd` for an ordinary date, the 31st into a short month, 29 Feb, and across the year.
3. **Real Stripe, test clock (`stripe.integration`):**
   - the till's checkout takes `plan: "twelve_months"`, and a bad plan is refused (422);
   - the subscription gets `cancel_at` = anchor + 12 months, and the member is `active` with `term_ends_at`;
   - staff ending it early leaves `cancel_at` at the period end and the member `cancelling`; undoing it puts back the 12-month end;
   - **a year on the clock, two months at a time:** exactly **12 paid invoices** and 12 payments of Silver's price, no stray invoices, then `customer.subscription.deleted` ended it, with the "membership ended" email. 140 s.
4. **Real Stripe, account (`account-stripe.integration`):**
   - `/me/membership/checkout` with the plan;
   - after the first payment, `cancel_at` = 12 months on and the account shows `termEndsAt`;
   - the member's Cancel is refused (`fixed_term`) and Stripe is untouched;
   - the portal configuration created for them has cancelling off, with card and invoices on.
5. **POS browser test with a real Stripe checkout (`membership-12-month.spec.ts`, E2E_STRIPE=1):**
   - the cashier picks "12 months, paid monthly" and the phone pays by test Visa;
   - the subscription's metadata says 12, `cancel_at` is 12 months on, the member is `active` with the same end date;
   - the back office shows "12-month plan, paid monthly".
6. **Gate:** see the commit for this step.

**Issues found and fixed**

1. My first account test passed without testing anything: `/me/membership/checkout` silently dropped the unknown `plan` field. The route now takes it, and the real-Stripe browser test checks the subscription's metadata end to end. A Checkout Session doesn't show its `subscription_data` after it is created, so a test has to complete the payment to see it.
2. **`membership.spec.ts` was out of date:** it expected Silver at $100.00 with a $100 payment, but launch Silver is $48. It only runs with real Stripe on, so it hadn't been noticed. It now reads the tier's price and free minutes from the database (D67).
3. **The till didn't see newly synced tiers** (above). This only showed up on a freshly reset database.
4. **The real-Stripe API tests must not run while `stripe listen` is forwarding to an API on the same database.** The first gate run had the forwarder on (for the browser tests). It delivered the Stripe events to the running API first, so when the test delivered them, they were duplicates: the statuses changed, but the "payment failed" and "ended" emails went to the other server's outbox, and two tests failed on those emails. Rerun with the forwarder off: 6/6. The gate now runs the API tests first and starts `stripe listen` only for the browser tests. The existing lifecycle test had the same exposure.

**The other real-Stripe browser tests, brought up to date.** These run only with `E2E_STRIPE=1` and `stripe listen`, and had gone stale since they last ran. None of this was caused by this step:
- `pos/membership.spec.ts` expected Silver at $100; it now reads the tier.
- `booking/member-stripe.spec.ts` expected "5% off" and "1 hour"; it now reads Silver's percentage and free minutes.
- `booking/booking-stripe.spec.ts` still used the booking flow from before the three-step panel (8e). It also couldn't step the calendar into next month (29 Oct + 3 days = 1 Nov), and days are now labelled with the year. It is rewritten to the panel flow, the same way `booking.spec.ts` does it.

All three pass again, with real test-mode payments, refunds and webhooks.

**Worth knowing**

- The plan is the same monthly price as rolling. A cheaper 12-month price would be a second Stripe price per tier: possible, but not asked for.
- Stripe can't force payment. A member who cancels their card goes `past_due`, Stripe retries, and then it ends, as for any subscription. Chasing the rest of the year is outside the system.
- The website's *Join* still offers monthly only. Adding the choice there is a page change; the API is ready.
