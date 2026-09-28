# Phase 8g — New hours, one flat happy hour, and tournament entries at the counter

**Date:** 2026-09-28
**Decisions:** [D73, D74, D75](../decisions/08-2026-09-23-public-site-experiences-tournaments.md).
**Migrations:** `20260924002000_venue_hours_and_flat_happy_hour.sql`, `20260924002100_tournament_counter_entry.sql`
**Spec updated:** [README.md](../../spec/README.md) (launch values), [data-model.md](../../spec/data-model.md), [back-office.md](../../spec/back-office.md).

**Done**

**New opening hours** (D73): Mon–Thu 12:00–22:00, Fri 12:00–24:00, Sat 11:00–24:00, Sun 11:00–22:00. Midnight is stored as `24:00`, which Postgres reads as the following midnight, so a Friday booking can run to 11:59 pm and nothing crosses into Saturday.

**One happy hour, 12:00–15:00 every day, as a flat price everywhere** (D74). This settles the two-happy-hours problem flagged in D66.

| | Normal | Happy hour |
|---|---|---|
| Quick Race / Leaderboard Challenge | $35.00 | $29.00 |
| Double Race | $58.00 | $49.00 |
| Billiard table | **$25.00/hr** (was $30) | **$20.00/hr** |
| VR seat | $50.00/hr | **$40.00/hr** |

The hourly side uses **rate bands**, which already existed for exactly this. **The percentage happy hour is switched off** rather than deleted: with a flat rate in the same window, a percentage on top would discount twice. Switching it off keeps the history and lets it be turned back on.

Simulators by the hour are unchanged at $60 — they are sold online as experiences, and the hourly rate is only for a walk-in. **Flagged** for the owner if they want one.

**The site shows the happy-hour rate** beside the normal one on any hourly card that has one, from a new `fromRateCents` — the same idea as an experience's "from" price.

**Tournament entries at the counter** (D75). Staff choose **cash**, **card terminal** or **no charge**. The amount is worked out **by the server** from the tournament's own entry fee with a member's discount applied — the till proposes, the server decides, like every other money path. Money goes on the open shift and into the day's takings; "no charge" needs no till. One transaction, audited either way, and the spot counts immediately.

**Everything here is editable in the back office.** The seed only sets what a fresh install starts with, and both migrations change a value **only where it is still the previous launch default**, so a venue that has already set its own is left alone.

**Verified**

1. **6 new pgTAP tests** (461 → 468): the new hours and rates as launch values; that there is **no** percentage happy hour and the rate bands are what carries it; and the counter entry — only money the till can hold, "no charge" means nothing taken, taking nothing in cash is not a sale, cash reaching the till, and a free entry still taking a spot.
2. **2 new API tests** (233): adding someone at the counter is refused with **no open till**, then succeeds with one — the amount coming from the tournament's own fee, a cash movement on the shift, and an audit row naming the operator; and a **no-charge** entry that needs no till, carries its reason, and cannot be repeated for the same person.
3. **A browser test** for the new dialog is not added; the back office screen is covered by the existing tournaments test, and the counter path is covered end to end by the API test above. **Flagged as thinner coverage than the rest.**
4. **Gate:** turbo **11/11** · pgTAP **468** · API **233** · POS e2e **6** · booking e2e **10**.

**Issues found and fixed**

1. **Midnight printed as "12:00 pm".** A closing time of midnight is `24:00`; read as an hour number that is past noon, so the site showed Saturday as "11:00 am – 12:00 pm" — a one-hour day. Found by checking the formatter against the new hours before trusting them.
2. **Nineteen API tests, forty-one pgTAP assertions and three browser tests had the venue's launch values baked in**, so changing the hours and prices broke them. Each is now independent of what the owner charges:
   - pgTAP booking and till tests **set their own opening hours inside their transaction**, which rolls back with everything else.
   - API test files set theirs in `beforeAll` and restore in `afterAll` — safe because files run one at a time — through a shared `useOpeningHours` helper.
   - **The POS suites, API and browser, now create their own resource type and their own happy hour.** They are about what the till *does*, not about what the venue charges.
   - Tests that must assert a launch value read it from the database.
   - Only `01_schema_seed` still asserts the launch configuration, which is its whole job.
3. **A happy hour created by one browser test changed the price in another.** The back-office test made one scoped to "Everything", which then discounted the till test's walk-in. It is now scoped to VR seats and switched off the moment its assertion is done.
4. **The booking window can straddle a month end.** On 28 September a day four out is in October, and the calendar opens on the month containing today — so the day simply was not on screen. The test now presses the arrow, which is what a person does.
5. **A false alarm on the secret scan.** `sk_test_offline_never_called` is a deliberate placeholder that has been in the repo since Phase 6b-1; it only appeared in the diff because the file moved. Confirmed with `git log -S` before committing rather than waved through.

**Worth knowing**

- **Do not start the test suites straight after `pnpm db:reset`.** The reset restarts the Supabase containers, and a run that begins while auth is still coming up fails at setup with "Could not create the sign-in account" — which looks like a code fault and is not. Wait for `/auth/v1/health`.

**Not built yet**

- Cancelling or refunding a tournament entry — not asked for.
- Any display of a tournament's format: brackets, rounds, heats, results or a leaderboard — the owner said to leave it.
- A happy-hour rate for simulators by the hour.
