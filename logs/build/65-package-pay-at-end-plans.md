# 65 — Packages paid at the end; the 12-month plan on the website; "monthly until cancelled" said plainly

**Date:** 2026-10-30
**Decision:** [D116](../decisions/15-2026-10-29-twelve-month-plan-walk-in-packages.md).

**Done**

- **Database** (`20261030000100_package_pay_at_end.sql`)
  - `sessions.package_pay_at_end` (only with a package).
  - `pos_open_package_pay_at_end(staff, p)`: the package checks of `pos_open_package` (sold at the counter, right kind of table, ends by closing time, no booking on the table before it ends), then opens the walk-in with its end. No money, no receipt. API only.
  - `pos_close_session`: a package paid at the end goes through the normal charged close; free play on it is whole sessions and at most the package's length. Paid-up-front packages still close for nothing.
  - `pos_void_session`: an unpaid package is voided like open time, with nothing to refund.
- **API**
  - `POST /pos/packages` takes `{ resourceId, experienceId, payAtEnd: true }` (nothing else allowed with it). It returns the end time and `receipt: null`.
  - Package pricing is split into `pricePackage(…, startAt, …)`, shared by the package screen and the close.
  - `quoteClose` has a new mode, `package`: `priceExperience` at the session's **start** time (Happy Hour by the start), member / free play / student price / referral given at the close, and **nothing for running over**. The quote also returns `freeStepMinutes` (15 for open time, 30 for a package) and `claimablePromos`. The close takes `claimedPromoIds`.
  - The package can be priced at the close even if it has since been switched off in the back office (`loadExperience(…, "any")`).
  - The floor returns `packageId` and `packagePayAtEnd`. A receipt for an open package exists only if it was paid up front.
  - Back office member detail: `billing` is now `stripe`, `counter` (a counter sale, D61: its free-play grant carries the till payment) or `complimentary`.
- **Till**
  - The package screen has **Pay now / Pay at the end**. Pay at the end hides the discounts ("given when the table closes") and the tender, and shows "To pay at the end $x · nothing extra for running over". The button reads "Start — pay at the end", and the started screen says "They pay when they finish".
  - The tile shows "<package> until 15:00 ≈ $list price". The table's dialog says "(pay at the end)".
  - The close screen says "Package price — nothing extra for running over". It offers free play in whole sessions and the student price.
  - Sell membership: "The default. Charged every month with no end date until the member cancels. Choose 12 months for a fixed year." Counter months read "How many months (paid now, doesn't renew)".
- **Back office, Members:** each member's badge reads *Monthly, until cancelled*, *12-month plan*, *Paid at the counter* or *Complimentary*. The Membership box spells out each one; counter: "runs until … and doesn't renew".
- **Website**
  - The membership page offers **Monthly, until you cancel** (preselected) and **12 months, paid monthly**, each with one line, and the note: "Same monthly price on both plans. If you don't choose the 12-month plan, your membership renews every month, with no end date, until you cancel." *Join* sends the chosen plan.
  - "How joining works" names both plans. The account shows "Plan: Monthly — renews every month until you cancel".
- **Spec:** `pos.md` (packages), `data-model.md`, `membership.md` §1b, `booking-site.md`, `README.md`.
- **Also done:** stopped the old API dev program on port 8787 (it had been running since 28 September and reloading itself), as the owner asked. The browser tests ran on the normal port again.

**Verified**

1. **pgTAP `20_package_pay_at_end` (9):**
   - only a package can be paid at the end;
   - it starts with its end time and no payment;
   - closing it is charged, not waved through;
   - free play is whole sessions and at most the package;
   - closing records one payment;
   - a void refunds nothing;
   - API only.
   - Full: 20 files, 559 tests, **PASS**.
2. **API `packages.integration` (+4, now 16):**
   - started at 13:00 with no payment and no receipt (409), with the tile's `packagePayAtEnd`; extra tender fields refused (422);
   - refused when it runs into a booking;
   - at 15:20, 80 minutes over, the plain price is $25.00 (Happy Hour, by the 13:00 start, not $30), with Student offered; 15 free minutes refused; Gold + 30 free = $12.00. Cash $20 gives $8 change; one payment; 30 minutes off the balance;
   - a void refunds $0.
3. **API `counter-membership`:** a counter sale shows as `billing: "counter"` in the back office. `admin` still shows `complimentary` for a complimentary member.
4. **POS browser `package.spec.ts`:**
   - after the paid-up-front round, the same package paid at the end: no tender shown, "They pay when they finish", tile "≈ $14.50", dialog "(pay at the end)";
   - the close shows "Package price — nothing extra for running over" at $14.50; cash $20, change $5.50;
   - two cash payments of $14.50; the till closes at $229.00 with no variance.
   - Screenshots: `package-03-pay-at-end.png`, `package-04-close.png`.
5. **Website browser:**
   - the membership page shows both plans, with monthly preselected, and the note; picking 12 months selects it (`web-16-membership-plans.png`);
   - the real-Stripe join sends `plan: "monthly"` when nothing is picked, and the account shows "Plan: Monthly — renews every month until you cancel".
6. **Gate:** turbo 11/11 (pricing 121, API 291), pgTAP PASS, POS e2e 10/10, booking e2e 18/18, with real Stripe test mode. See the commit.

**Issues found and fixed**

1. **A member who paid at the counter was labelled "Complimentary"** in the back office: only Stripe members were told apart. Fixed: `counter`.
2. The first screenshot of the website's plan choice made both boxes look selected. A radio dot now fills in on the chosen plan, and the other box has a plain border.
3. `pos/membership.spec.ts` looked for the old "Billed monthly through Stripe" wording; it now checks the new wording.
4. The till's linter flagged the existing `Date.now()` check in the close screen's pay handler once the screen changed. The check moved into a small helper outside the component; it behaves the same.

**For the owner**
- **Before deploying:** `supabase db push` (one more migration, as well as the two from steps 63 and 64).
- **Defaults chosen for you; say if you want them different:**
  - a package paid at the end costs its price at the time it **started**;
  - running over is **not** charged;
  - member and referral discounts are given at the end.
