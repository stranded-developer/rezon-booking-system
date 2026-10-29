# 64 — Walk-in packages at the counter, paid up front

**Date:** 2026-10-29
**Decision:** [D115](../decisions/15-2026-10-29-twelve-month-plan-walk-in-packages.md).

**Checked first:** a walk-in was open time only: a timer, charged in 15-minute blocks at the end (D91). Experiences (D65) already had flat prices, promotions and member prices, but only online. A counter package is therefore an experience sold at the counter. It isn't a booking: a booking needs a named customer, and brings confirmation and alert emails.

**Done**

- **Database** (`20261029003900_walk_in_packages.sql`)
  - `experiences.online` and `experiences.at_counter`. Existing experiences keep both on.
  - `sessions.experience_id` and `sessions.package_ends_at`, with a shape check: both or neither; walk-ins only; the end after the start.
  - **`pos_open_package(staff, p)`**, one transaction:
    - checks the package is sold at the counter and fits this kind of table, and that it ends by closing time;
    - refuses it if a live booking on the table starts before it ends;
    - checks the member, free play (whole sessions, within the balance), and member XOR referral;
    - applies the tender rules: money needs an open till;
    - opens the walk-in through `pos_open_walk_in`, so it gets the same opening checks;
    - records the package and its end, the payment on the session, the cash movement, the ledger use, the referral use and redemption, and an audit row.
  - **`pos_close_session`:** a package closes with nothing more to pay. Its total is what was paid at the start; there's no second payment.
  - **`pos_void_session`:** an open package is refunded like a closed session, and free play is returned.
  - Launch packages, counter only, added by the migration for the live venue and by the seed for a fresh one:
    - billiards 30 min $12.50 · 1 hour $25 · 2 hours $50 (the hourly rate);
    - simulators 2 hours $116 (two Double Sessions).
- **API**
  - `/pos/config` lists `packages`.
  - `POST /pos/packages/quote` prices a package with `priceExperience`, exactly as online. Promotions are decided by the start time, and claimed ones are offered as "prices they can ask for". It also covers the member's flat price or percentage, free play in whole sessions, and referral codes.
  - `POST /pos/packages` re-prices the package and refuses a changed total (`quote_changed`), then sells it and returns the receipt straight away.
  - Closing a package quotes "Package paid at the start, nothing more to pay". The floor reports its end (`bookingEndsAt`, so the time-up pop-up works as for bookings) and its `packageName`.
  - Receipts can be printed for a package that is still open.
  - **The website lists and books only `online` experiences.** `loadExperience(…, "online" | "counter")` enforces it on availability, quotes and holds.
  - Back office: experiences take `online` and `atCounter`.
- **Till**
  - A free table offers **Open time (pay at the end)** plus its packages ("from $x").
  - The package screen has the member card / referral / search field, free play in 30-minute steps, prices to ask for, the explanation, and the total to pay now with its end time. Then cash or card, change due, the receipt, and "Time is up at …".
  - The tile shows "1 hour until 17:00". The time-up pop-up says "Package ended at …".
  - The close screen says "Paid in advance — nothing to pay" (bookings too).
- **Back office:** Experiences has **Sold: On the website / At the counter**, with badges on each card.
- **Spec:** `pos.md` §4 (opening a package), `pricing.md` (where `priceExperience` is used), `data-model.md`, `back-office.md`, `booking-site.md`, `README.md` launch values.

**Verified**

1. **pgTAP `19_walk_in_packages` (10):**
   - launch packages and prices; the website's simulator packages sold at the counter too;
   - the shape check (no end; end before start);
   - refused: a package not sold at the counter, a simulator package on a billiard table, wrong GST, free play without a member, free play in part-sessions;
   - only the API can call `pos_open_package`.
   - Full pgTAP: 19 files, **Result: PASS**.
2. **API `packages.integration` (12):** on its own table type, with the owner's example prices: 1 hour $30, 2 hours $55.
   - **Where sold:** the till lists counter packages by table type. The website lists online ones only; booking a counter-only one online is a 404, and so is selling an online-only one at the counter.
   - **Pricing:** 2 hours $55.00 ending 18:00. Happy Hour at 13:00 gives $25; student on request $27; the Gold flat price $24; 30 free minutes make it $12 (pro rata); a $5 referral gives $25. Refused: free play of 15 min, a simulator package on a table, member + referral.
   - **Selling:**
     - money needs an open till;
     - a price that changed since the till showed it is refused, with the new total;
     - cash $50 for $30 gives $20 change, the receipt at once, the tile in use "1 hour" until 17:00, one payment on the shift and a cash movement;
     - refused: a table in use, a 1-hour package that runs into a 17:00 booking (a 30-minute one fits), a 2-hour package at 19:30 with the venue closing at 21:00.
   - A member pays $12 with 30 free minutes, which come off the balance.
   - At 17:10 the table is overdue. Closing quotes $0, the session keeps its $30 total, and there is still one payment.
   - **Void:** a $12 card refund and 30 minutes back on the balance (balance 60).
   - **Shift report:** cash sales $30, card $15 + $12 − $12, gross $57, refunds $12, closed with no variance.
3. **API `admin-experiences` (+1):** an experience is online and at the counter unless set otherwise. Made counter-only it disappears from the website; it can be switched back.
4. **POS browser test `package.spec.ts`:**
   - a cashier opens the till, taps the table, sees "Open time (pay at the end)" and the "Half hour" package at $14.50;
   - pays $20 cash, gets $5.50 change and "Time is up at";
   - the tile shows "Half hour until"; closing says "Paid in advance — nothing to pay" at $0.00;
   - one cash payment of $14.50 in the database; the till closes at $214.50 with no variance.
   - Screenshots: `package-01-pay.png`, `package-02-started.png`.
   - The smoke test (open time) and the time-up test passed in the same run, at 20:27 Sydney. Like the smoke test, this one skips outside 10:00–20:45 Sydney time.
5. **Gate:** see the commit for this step.

**Issues found and fixed**

1. **`endsAt` came back as `…+00:00`** (Postgres JSON) where everything else in the API says `…Z`. It is now normalised.
2. My first test run crashed in setup and left its own table types switched on in the local database. The test's cleanup now runs even when setup fails, and the leftovers were switched off. A passing run leaves nothing behind (checked).
3. A pattern-based edit added the new website/counter fields to three other back office routes as well. The typechecker caught it, and they were removed.

**How the browser tests were run tonight:** an API server started at 16:22, before any of this work, was still running on port 8787 with the old code. I wasn't permitted to stop it. So the current API ran on port 8788, and the POS and booking site were built against it for the e2e runs (`NEXT_PUBLIC_API_URL=http://localhost:8788`), with `stripe listen` forwarding there. Nothing in the code depends on that port.

**For the owner**
- **Set the billiard prices** (and the 2-hour simulator price) in Back office → Experiences. They start at the hourly rate: $12.50 / $25 / $50 and $116.
- Billiard packages get a Happy Hour price only if you add one to them, like the simulators' $29/$49.
- **Before deploying:** `supabase db push` (two new migrations).
