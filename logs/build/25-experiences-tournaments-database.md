# Phase 8b — Experiences, tournaments and events in the database

**Date:** 2026-09-23
**Decisions:** [D65–D70](../decisions/08-2026-09-23-public-site-experiences-tournaments.md).
**Migration:** `20260923001800_experiences_tournaments_events.sql`
**Spec updated:** [data-model.md](../../spec/data-model.md) (experiences, tournaments, site events, new functions, launch seed), [README.md](../../spec/README.md) (launch values).

**Done**

**Experiences** (`experiences`): a named package with a fixed length and a flat price, plus the words that go on its card — a tagline, bullet points and badges like "Most popular". A length has to be a whole number of quarter hours; a price cannot be negative. Three are seeded, all on the simulators: **Quick Race 30 min $35.00**, **Leaderboard Challenge 30 min $35.00**, **Double Race 60 min $58.00**. Billiard tables and VR seats keep the hourly rate, and every walk-in stays hourly.

**Promotional prices** (`experience_promos`): a named window with its own flat price for one experience, and a `claimed` flag for prices the customer has to ask for. Seeded: **Happy Hour** every day 12:00–15:00 at $29 / $29 / $49, automatic; **Student** every day at all hours at $32 / $32 / $52, only on request.

Unlike rate bands and percentage happy hours, **overlapping windows are not rejected here**, and the spec now says why: the cheapest match wins, so the overlap *is* the rule that keeps the student price out of Happy Hour.

**Bookings** gained `experience_id`, and `booking_hold` now has two branches instead of one:
- **With an experience:** it must be active, must belong to the booked resource's type, and the booking must be **exactly its own length** — "Quick Race runs for 30 minutes" if you try to stretch it. Free play is taken in **whole sessions**, because a flat price is shared pro rata and half-sessions would make the arithmetic uglier than the benefit.
- **Without one:** the session rules from D63 are untouched — at least one session, then 15-minute steps.

The function was **copied from its previous migration and changed only inside that fork**, the same discipline as build step 23, so nothing else in this money path could drift.

**Tournaments** (`tournaments`, `tournament_entries`) with four functions that mirror the booking ones exactly, because the problem is the same one:
- `tournament_spots_left` counts confirmed entries **and holds that have not expired** — the same trick that stops a referral code being over-redeemed while people are at the checkout.
- `tournament_hold` sweeps stale holds, checks the tournament is published and has not started, finds or creates the customer, and then branches: a member with free entries left is **confirmed on the spot at $0**, everyone else gets a hold and goes to payment.
- `tournament_attach_checkout`, `tournament_confirm`, `tournament_release_hold` complete the Stripe round trip.
- A partial unique index allows **one live entry per person per tournament**, while still letting someone who cancelled sign up again.
- `payments` gained `tournament_entry_id`, and its "exactly one target" constraint was widened to four.

**Free tournament entry is built but switched off.** `membership_tiers.monthly_free_tournaments` is **0 for every tier**, so today every entry goes to payment. The owner's written brief describes the free-entry flow, but when asked which perks the system should enforce they did not choose it — so rather than pick a side, both branches exist and the perk is a number in the back office. Counted per calendar month in venue time.

**Site events** (`site_events`): a title, a line of copy, a highlight line like "$2,000 cash prize pool", a button, the dates to show between, and whether it appears as a pop-up, a banner or both. A constraint keeps the button's label and link together — one without the other is a half-drawn button.

**Membership values changed** (D67): Silver **$48.00 / 10%**, Gold **$78.00 / 20%**, Diamond **$128.00 / 20%**. Free play a month is unchanged (2 / 4 / 8 sessions). Each tier also gained a `perks` list — the things staff honour by hand, listed on the site but not enforced: weekday-only Silver, free billiard hours, food and drink discounts, watch parties, birthdays.

The price change **only touches tiers still on their previous launch values**, so a venue that has already set its own prices is left alone. And because `tier_prices` is a history rather than a current value, the change **adds a row** rather than editing one — the same thing `admin_set_tier_price` does.

**Security:** all five tables have RLS on and no write privileges for browser roles, as every table must. Experiences, promotional prices and site events are readable the same way resource types are (active rows to anyone, everything to staff); tournaments only when published; entries only by staff or the person who made them.

**Verified**

1. **`pnpm db:reset` applies the migration and the seed cleanly**, and the seeded rows were read back and checked by eye before any test was written: three experiences at the right prices and lengths, six promotional prices, three tiers at $48 / $78 / $128 with 3, 6 and 9 listed perks, and one `tier_prices` row each.
2. **31 new pgTAP tests** (`14_experiences_tournaments`). pgTAP **423 → 456**. They cover:
   - the seeded prices and lengths, and that the student price is marked as needing to be asked for;
   - the two constraints that protect the shape of an experience (a 40-minute length, a negative price);
   - booking an experience for its own length, and being refused for any other — **both directions**, a Quick Race stretched to an hour and a Double Race cut to half;
   - a simulator experience refused on a billiard table, and a switched-off experience refused outright;
   - free play on an experience in whole sessions only, the balance actually going down, and a plain booking still following the old session rules;
   - the new membership numbers, including that free tournament entry is present and set to zero;
   - tournaments: all spots at the start, an unpublished one closed, one that has started closed, **a hold holding a spot**, the same person refused twice, and the last spot filling the tournament.
3. **`pnpm db:test` → Result: PASS**, run twice — on the database as reset and again on the same database after a full run, as the project requires.
4. Assertions are scoped to this test's own rows (its own simulator, table, member and tournaments), so they hold on a used database.

**Issues found and fixed**

1. **Three existing pgTAP files failed, and they were right to.** `01_schema_seed` asserted the exact list of tables and the old tier values; `06_admin` proved "setting the same price is refused" by passing $100, which is no longer Silver's price, so nothing was refused; `12_counter_membership` had **eleven hardcoded copies of $100 and $300**.

   The counter-membership one was worth more than a find-and-replace. Hardcoding a tier's price in a test that is *about* selling at the counter meant the next price change would break it again. It now reads the prices out of `membership_tiers` and computes the expected totals and GST from them, so it tests the behaviour rather than the numbers. The `06_admin` case was fixed the same way.

   Worth noting: test 26 failing caused test 28 to fail too, because the price change it wasn't supposed to make left two `tier_prices` rows with the same timestamp and an ambiguous order. Fixing the first fixed the second.
2. **An ambiguous `price_cents`** in one of my own assertions — two joined tables both have the column. Qualified.
3. **`plan(30)` with 31 tests.** Corrected rather than deleting a test to fit the number.

**Not built yet**

- The API does not read any of this yet: no experience appears in `/public/config`, no quote can be asked for one, and there are no tournament or event endpoints. That is the next step.
- The back office has no screens for experiences, promotional prices, tournaments or events, so today they can only be changed in SQL.
- Cancelling a tournament entry (and refunding it) is not built. `tournament_entries` has the columns for it.
