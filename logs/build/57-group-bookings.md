# Step 57 — A simulator session for several people

**Date:** 2026-10-14
**Decisions:** [D106](../decisions/14-2026-10-13-explore-wording-happy-hour.md).

**Done**

- **Pricing engine** (`packages/pricing`): `priceExperience` takes `partySize`. Price per person × people; a member's price for everyone (owner's choice); free play covers the member's own place only; a referral comes off the group's subtotal once. The explanation says "3 people × $35.00  $105.00", or with free play "…, your place" then "2 more people × $58.00".
- **Database** (migration `20261014003500_group_bookings.sql`):
  - `bookings.party_size` (on the lead) and `bookings.group_lead_id` (on each linked booking). A linked booking can't carry a price, payment, member, referral or free play.
  - `booking_hold` takes `extraResourceIds`: one linked booking per extra person, same type, active, none twice, held with the lead. Any one taken → the whole group fails (`slot_taken`).
  - Trigger `follow_group_lead`: linked bookings follow the lead to confirmed, expired, cancelled (no refund of their own) and no-show.
  - Trigger `guard_group_member`: a linked booking can't be confirmed or cancelled on its own (`part_of_group`).
  - `pos_arrive_booking`: checking the lead in opens a session on every simulator of the group.
- **API**: `partySize` on quote and hold (simulator sessions only; up to the number of simulators). The hold picks the asked-for (or first free) simulator as the lead and the next free ones for the rest; too few free → 409 `not_enough_spots` ("Only 1 spot is free at that time for 2 people"). Stripe shows "Single Session · 3 people". The booking page, the confirmation email and the venue alert name every simulator; the reminder goes once per group; a member's account lists the group once; happy hour in the summary is for the whole group.
- **Booking site**: "How many people?" (− / +) above the start times; times with too few spots are greyed out; no simulator choice for a group ("each of you gets your own simulator, side by side"); People in the summary, the pay step and the booking page.
- **Back office → Bookings**: the lead shows "Group of 3 · pays for all"; each other simulator "With group ABC234" and can't be cancelled on its own.
- Spec: `booking-site.md`, `data-model.md`, `back-office.md`.

**Verified**

1. Pricing (7 new tests, X23–X29): × people, Happy Hour for all, member price for all, free play on one place, a referral once, refuses 0 / 1.5 / −2 people. 121 pricing tests pass.
2. pgTAP `17_group_bookings` (24 checks): a group of 3 holds three simulators with the price on the lead; a group that clashes leaves nothing behind; refuses the lead's simulator twice, a duplicate, a switched-off simulator, a billiard table, and a group on time booked by the hour; a linked booking can't be confirmed or cancelled alone; paying confirms everyone with one payment; cancelling refunds the lead and cancels everyone; releasing the hold frees everyone; checking the lead in opens a session on every simulator.
3. API (4 new tests): quote × people and Happy Hour for the group; refuses more people than simulators, a group on a table, 0 people; a $0 group of 2 confirms both rigs, takes both spots, shows "Rig A, Rig B", sends one confirmation naming both, is listed right in the back office, and cancels together; too few free rigs → `not_enough_spots`.
4. Browser test: a guest picks 3 people (times with fewer than 3 spots greyed out), gets no simulator choice, sees "3 people × $…", confirms with a $0 code, the booking page says "3, a simulator each" and names three sims, the database has the lead and two linked bookings confirmed; cancelling the code cancels all three. Screenshot `web-17-group` checked.
5. **Gate:** see the commit for this step.

**For the live site**

- `supabase db push` before deploying the API.
