# Phase 8c — The API serves experiences, promotions, tournaments and events

**Date:** 2026-09-23
**Decisions:** [D65–D70](../decisions/08-2026-09-23-public-site-experiences-tournaments.md).
**Spec updated:** [pricing.md](../../spec/pricing.md) §9.5 (X8b).

**Done**

**`/public/config` now carries everything the new site needs**, so the home page is still one request:
- **`experiences`**, each with its name, tagline, bullets, badges, length, price and its promotional prices.
- **`fromPriceCents`** per experience: the cheapest price anyone could pay **without asking for it**. A price marked "claimed", like the student price, is deliberately left out — a "from" price on a card is a promise to a passer-by, and $32 is not available to one.
- **`events`**: the active site events, already filtered to the ones whose show-between window is open right now.
- **`tiers[].perks`**: the listed-but-not-enforced perks (D67).

**`/public/availability` takes `?experience=`.** The important part is not that it resolves the experience but what it does with the length: **every resource is asked for the experience's own length**, so "1 spot" on a Double Race means one simulator free for the whole hour, not for half of it. It also stops offering a start time once the whole experience no longer fits before closing — the last Double Race of a 21:00 day starts at 20:00, not 20:30.

**`/public/quote` and `/bookings/hold` take `experienceKey`.** When one is given:
- **the length is the experience's own**, and a `durationMinutes` sent alongside it is ignored rather than honoured. The client does not get to decide how long a Quick Race is;
- the resource type comes from the experience, so a simulator package can never be quoted against a billiard table;
- free play must be in whole sessions, checked here as well as in the database, because a quote never reaches the database and a wrong amount would show the customer a price they would only be refused at payment;
- `claimedPromoIds` carries the promotions the customer has asked for, and the quote returns **`claimablePromos`** — the ones they could still tick at that start time — so the site offers the student price without hardcoding it.

Everything else is unchanged: the same member-or-referral rule, the same stale-quote check, the same hold, the same Stripe Checkout. The Stripe line item and the confirmation email now say "Quick Race · Sim 3" rather than "Driving Simulator · Sim 3", and a booking reports `what` — the experience if there was one, otherwise the kind of resource.

**Tournaments** (`services/tournaments.ts`), deliberately shaped like bookings because it is the same problem:
- `GET /public/tournaments` — published, not yet started, soonest first, with **spots left**, in one query rather than one per tournament.
- `POST /tournaments/signup` — quote the entry (a member's percentage applies to the fee), refuse a stale total, then `tournament_hold`. A free entry is confirmed on the spot and emailed; anything else goes to Stripe Checkout.
- `GET /tournaments/:ref?token=` — the entry, behind the same token comparison as a booking link.
- The Stripe webhook now tries a booking **and then** an entry for a one-off payment, each ignoring the other's sessions. A hold that lapsed before the payment landed is refunded rather than forced through, exactly as a booking is.
- A new email template, `tournament_entry_confirmed`.

**Verified**

1. **22 new API tests** (`experiences.integration.test.ts`). API total **191 → 213**. The file builds its own resource type, experiences, promotions, tournaments and event, so it never depends on the launch data for its arithmetic and can run on a used database.
2. **The arithmetic is checked against something independent.** The test rig is $60/hr, so half an hour of *time* would be $30; the Quick Race quote is **$35**. That is the whole point of D65 and it is now a test.
3. **Eight deliberate breaks, eight killed** — but **four of them survived the first attempt**, which was the useful part of the exercise:

   | Break | First result | Why the test was weak |
   |---|---|---|
   | Availability counts spots at one session, not the experience's length | **survived** | The blocked rig was busy *at* the start time, so it scored 0 either way. Now there is a 16:30 case where a rig has exactly 30 minutes free: enough for a Quick Race, not for a Double Race. |
   | "From" price includes prices you have to ask for | **survived** | The claimed price happened to be dearer than the automatic one, so the filter changed nothing. A claimed promotion **cheaper** than Happy Hour was added, and "from" must still ignore it. |
   | The claimable list ignores the "claimed" flag | **survived** | The quote was outside the Happy Hour window, so the automatic promotion was filtered out by the window anyway. Now also asserted **inside** Happy Hour. |
   | The engine takes the first matching promotion, not the cheapest | **survived** | The fixture listed Happy Hour first, so "first" and "cheapest" agreed. X8b now prices the same thing with the promotions reversed. |
   | The quote trusts a length sent with an experience | killed | |
   | Unpublished tournaments are listed | killed | |
   | Spots left ignores holds waiting for payment | killed (2 tests) | |
   | `booking_hold` stops checking the experience length | killed (3 tests) | |

4. **Gate:** `turbo run typecheck lint test --force` → **11 successful, 11 total**; pricing **101**, API **213**. `pnpm db:test` → **PASS**, 456.

**Issues found and fixed**

1. **Four tests that passed for the wrong reason** — see the table above. Each is now built around a case where the right and wrong behaviours actually differ. This is the strongest argument for the mutation check: all four were green, and all four would have let a real regression through.
2. **Two test names described something the test did not do.** "books it for its own length" only ever asserted a refused stale total, and a token test doubled as a Stripe-missing test. Both renamed to say what they check.
3. **The API compiled against stale generated types** until `@raceground/db` was rebuilt — the new tables existed in `database.types.ts` but not in `dist/`. Worth knowing for next time: after `gen:types`, build the package before trusting a typecheck.

**Correction — the gate in this step's first commit was not actually green**

The "Gate" line above was written from checks that had passed a few minutes earlier. The command that ran the gate and committed piped **each step through `tail`**, so every step reported `tail`'s exit code, which is always 0. The `&&` chain therefore never saw a failure and the commit went ahead over a **red** gate. Two checks were failing, and both were right to:

1. **`01_schema_seed` failed on a used database.** The two launch-seed assertions added in step 8b selected *every* experience and promotional price, so the rows `experiences.integration.test.ts` leaves behind (`test_quick_…`, "Test Happy Hour") broke them. Scoped to the three launch keys. This is exactly the rule in CLAUDE.md — *tests must pass on a fresh and on a used local database* — and the new assertions broke it while the rest of the file obeyed it.

2. **The password-reset browser test failed whenever it ran straight after the POS suite.** `appReady` waits for the header's account link, but the header lives in the **shared layout**: after a client-side navigation it is already hydrated while the form on the *new* page may not be. A value typed into a React-controlled input before it hydrates is silently wiped, so the form looked filled in and submitted nothing — and because the "we've sent a link" notice is set synchronously on submit, its absence meant the submit never happened, not that the email failed. Fills now retry until the value sticks, which is what actually waits for the form. Reproduced by running POS-then-booking, then confirmed fixed over three back-to-back runs.

Both are fixed in the commit that follows this step's. The gate was then re-run through a script that checks each step's real exit code: **turbo 11/11 · pgTAP 456 · POS e2e 5 · booking e2e 5**.

**The lesson worth keeping:** never pipe a gate step into anything. `set -o pipefail`, or capture to a file and check the status.

**Not built yet**

- **The back office has no screens** for experiences, promotional prices, tournaments or events. Until the next step they can only be changed in SQL, so the owner cannot yet create a tournament or an event.
- **Cancelling a tournament entry**, and refunding it, is not built.
- The **website** still shows none of this — that is what comes next.
