# Phase 7c — Memberships paid for at the counter

**Date:** 2026-09-16
**Decisions:** [D61](../decisions/07-2026-09-15-booking-website.md) counter-paid memberships · [D62](../decisions/07-2026-09-15-booking-website.md) the reason on a complimentary membership is optional.

Until now a membership meant a Stripe subscription. Customers who want to pay cash, or the venue before Stripe is even connected, had no way through. Now staff can take the money at the till for a fixed number of months.

**Done**

**Database** (migration `20260916001600_counter_membership.sql`)
- **`pos_sell_membership(staff, payload)`** — one transaction: customer (matched on email or phone, or created), membership period, payment on the open till, cash movement for cash, the free minutes for the months paid for, and the audit row. It **recomputes the price** from the tier and the months; the till only proposes it.
  - Refuses: a length other than 1/3/6/9/12 months, anything but cash or card terminal, a closed till, a wrong amount, a missing name or contact, and a membership already billed through Stripe.
  - Renewing early **adds to the time already paid for**; renewing after it lapsed starts from today. The tier can change at renewal.
- **`membership_expire_venue(now)`** — ends memberships that have run out, and only venue-managed ones: a Stripe membership is left to Stripe, whose renewal events can arrive late.
- **Free minutes can now come from a till payment**, not only a Stripe invoice: `member_balance_ledger.payment_id`, one grant per payment, and the "a grant needs a source" rule updated to accept either.
- **`admin_create_member` no longer requires a reason** (D62); it still records one when given.

**API**
- `POST /pos/memberships/counter` (staff + operator): tier, months, cash or card terminal, and either an existing customer or a name with an email or phone. Returns the member, what was taken, the minutes granted, the end date, and the member card.
- **An expired counter membership gives nothing from the moment it lapses**, before the daily job runs: member lookups treat it as ineligible. A Stripe membership is never treated this way.
- The daily job (`/cron/forfeit`) now expires counter memberships **before** forfeiting balances, so a balance that has just been frozen starts its 30 days today rather than a month later.

**POS**
- The "Sell a membership" dialog now asks how they pay: **on their phone** (unchanged) or **at the counter**.
- At the counter: months (1/3/6/9/12), cash or card terminal, the price shown before anything is taken, and afterwards a summary — what was taken, GST, minutes granted, the date it runs until, **"This membership is not billed automatically"** — with the member card ready to print.
- Counter sales list **all active tiers**, not only the Stripe-synced ones, because no Stripe is involved.

**Spec updated:** `membership.md` §1b (the two ways to pay), `pos.md` §5a/§5b.

**Verified**
1. **pgTAP `12_counter_membership` (34):** till must be open; months, method, price, name and contact all checked; a three-month cash sale (money, GST, 180 minutes, period, payment on the shift, cash in the drawer, audit); one grant per payment and a grant still needing a source; a card renewal that changes tier, adds to the remaining time and puts nothing in the drawer; the balance cap; a Stripe membership refused; expiry doing nothing early, ending it exactly when paid up to, and leaving Stripe memberships alone; a complimentary member with no reason; privileges. `06_admin` updated for D62. Full pgTAP **406**.
2. **`test/counter-membership.integration.test.ts` (8):** needs an open till; a three-month cash sale end to end with the card returned; bad lengths and tiers refused; a second sale renewing the same member rather than creating another, changing tier, and a card payment leaving the drawer alone; a Stripe-billed membership refused; unauthenticated refused; an expired membership ineligible **immediately** and ended by the daily job; **a Stripe membership with a stale period staying eligible**.
3. **POS e2e `membership-counter.spec.ts`:** a cashier opens the till, picks "At the counter", Silver, 3 months, cash, sees **$300.00** before taking it, and gets the summary and printable card — with the database checked afterwards for the member, the payment, the cash movement and the 180 minutes.
4. **Mutation check, 11 deliberate breaks, 11 killed** (one only after a test was added):
   - **Database (8):** price taken from the till instead of recomputed, no open till needed, renewal restarting from today, free minutes uncapped, card payments putting cash in the drawer, months unchecked, a Stripe membership sellable over the counter, expiry ending Stripe memberships too.
   - **API (3):** expiry ignored when deciding benefits; **a Stripe membership treated as expired** — this one survived at first, because nothing checked that a paying member with a late renewal keeps their benefits. A test was added (turning that member away at the counter would be the worst kind of bug), and it is now killed.
5. **Gate** (clean `db reset`, same command as the commit): pgTAP 406 · turbo 11/11 (pricing 78, API 190) · POS e2e 6 passed · booking e2e 7 passed.

**Issues found and fixed**
1. The first attempt built the member card before the member existed; the card helper needs the member. It now sells first and issues the card afterwards, reusing the existing "first card" path, so an existing member keeps the QR they already have.
2. `06_admin` asserted the old rule that a complimentary membership needs a reason. Updated, and the change is noted here rather than silently dropped.
3. The Stripe membership test failed again in the gate, showing "0 min free play ready". Checked rather than assumed: the grant **did** arrive, 60 seconds after the test gave up. Two webhooks are involved (one activates, one grants) and this machine runs Docker on under 4 GB with three suites at once. That test now allows 150 seconds for the second webhook.
4. **The new browser test left the till open**, which broke the counter smoke test that runs after it — caught by the gate, not by running the test on its own. It now closes the shift afterwards, and the whole POS suite passes together.

**Limitations, as agreed in D61**
- **Nothing renews and nobody is reminded.** Expiry is silent: no email goes out, and staff only see it when the member next comes in. A "your membership ends soon" email would be a sensible follow-up.
- These members have no Stripe portal, no invoices, and no card on file.
- Refunds go through the till's partial refund, not Stripe.
