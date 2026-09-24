# Phase 8e — The experience grid, the three-step booking panel, and the membership page

**Date:** 2026-09-24
**Decisions:** [D65, D66, D70, D71](../decisions/08-2026-09-23-public-site-experiences-tournaments.md).

**Done**

**`/book` is now a grid of what you can buy.** The named experiences lead, each with its real price, length, badges and bullet points; anything still sold by the hour follows underneath. Arriving with `?experience=<key>` opens that experience's panel straight away, so "Book now" on a card anywhere else on the site lands on the right thing.

**Booking happens in a panel over the page, in three steps** (D71):

- **Date** — a month calendar, then the times for the chosen day. Days outside the booking window and days the venue is shut are greyed out **before anything is looked up**, from the opening hours the config already carries. Every time tile says **how many spots are free** (D70), counted at the length actually being booked: "1 spot" on a Double Race means one simulator free for the whole hour, not for half of it.
- **Details** — how long and which one, but **only when that is the customer's to choose**. An experience has a fixed length, so the panel never offers one. Then the prices that have to be asked for — the student price — taken from what the quote says is claimable at that start time, rather than from anything written into the page. Then the member's free play, the referral code (never shown to a member), and the customer's details.
- **Pay** — the same breakdown, cancellation policy, terms tick and Stripe handoff as before.

A **summary sits beside the steps** the whole way through, showing the experience, its blurb and the **live price** as it changes — it starts at the "from" price and becomes the real quote once a day and time are chosen.

**Every rule underneath is the one that was already there**: the same availability, the same quote, the same hold, the same Stripe Checkout, the same handling of a price that changed or a slot someone else took. What changed is the shape of the conversation. The old `booking-flow.tsx` is gone; its logic moved into the panel unchanged.

**The membership page** now shows, per tier: the real monthly price, the percentage off, the monthly free play expressed as **races** (from the venue's own session length), the roll-over cap, and then the **perks staff honour by hand, marked with a star** and explained at the bottom of the section. Under that, a table of **what each tier actually pays for each experience** — worked out from the tier's own percentage and the experience's own price, so it is the price the customer will really be charged rather than a rounded figure typed into the page (D67).

**Verified**

1. **Two new browser tests**, and the two existing booking tests rewritten for the panel. The booking suite goes **9 → 10** (11 counting the skipped Stripe one).
   - A guest books end to end through the panel: a day, a time **that says how many spots are free**, a length, a referral code that is refused when used up and accepted when not, the terms gate, the confirmation with its QR, and a cancellation with its refund preview. Afterwards the same time is offered **once** rather than twice, because one of the two booths is now taken — that is the spots counter proved against a real booking.
   - An experience is booked for **its own fixed length**: the panel offers no length picker at all, and ticking the student price changes the total.
   - The member test now books through the panel, still proving the tier's percentage and that free play on a booking starts at a whole session.
2. **Looked at, not just tested**: screenshots of the grid, all three steps, the membership page and the member-price table. The numbers were checked against the database — Quick Race $35 normal / $31.50 Silver / $28.00 Gold, Double Race $58 / $52.20 / $46.40.
3. **Gate:** turbo **11/11** · pgTAP **456** · POS e2e **5** · booking e2e **10**.

**Issues found and fixed**

1. **The step buttons read as "2Details" to a screen reader.** The number and the label sat next to each other with no space, so they ran together in the accessible name. The number is decoration — the position is already carried by the list and by `aria-current` — so it is now hidden from assistive technology, which fixes the reading *and* lets a test ask for "Details". Found because a test could not find the button it was looking at.
2. **`/book` and `/tournaments` had no `h1`.** Their section heading is the page's own title, so `SectionTitle` gained a `level` and those two pages use it.
3. **The seeded tier perks repeated what the system already enforces.** Silver listed "10% off every booking" and "2 races a month" as starred perks, and the page also derives both from the tier's own numbers — so each printed twice. `perks` now lists **only what the system does not enforce**, which is what the column is for (D67). This was only visible by looking at the page.
4. **The panel's title appeared twice** as a heading (title bar and summary). Both earn their place — the title bar scrolls away on a phone — so the test asks for the one it means rather than the component losing a heading.

**Two testing lessons worth keeping**

1. **`next build` while `next start` is running serves a half-replaced build.** The old server keeps answering with chunk names the new build no longer has, every script 500s, and the page sits on its loading state forever. It looks exactly like a hung fetch. Stop the server, build, then start.
2. **The browser suites' assertion timeout is now 10s, not Playwright's 5s default.** Every assertion here waits on a real round trip — the Next server, the API and local Supabase — and 5s is a render-speed budget. Two assertions that genuinely wait on slow work are longer still and say why: creating an account (Supabase sends the confirmation email before it answers) and loading the account page (it waits for the session to be restored first). Before this, the suite passed alone and failed in a full run, which is the worst kind of flake. Confirmed with five consecutive green runs.

**Not built yet**

- **The back office** still has no screens for experiences, promotional prices, tournaments or events. That is the next and last step of this phase; until then the owner cannot create a tournament or an event without SQL.
- Cancelling a tournament entry, and refunding it, is still not built.
