# Phase 8s — Walk-ins are charged in 15-minute blocks, rounded up

**Date:** 2026-10-08
**Decision:** [D91](../decisions/12-2026-10-08-sessions-walk-in-blocks-type.md).

**Checked first:** walk-ins were billed by the exact minute once the 15-minute minimum was met (20 minutes played = 20 minutes charged). The owner wants 15-minute options at the counter, charged in 15- or 30-minute amounts, and chose "round up to the next 15 minutes".

**Done**

- **Pricing engine:** `billedMinutes = ceil(max(played, minimum) / 15) × 15` whenever the minimum applies (walk-ins and booking quotes; bookings are whole sessions already, so nothing changes for them). Each minute is still priced on its own, so happy hour and rate bands fall where they should inside a block. `BILLING_BLOCK_MINUTES` is exported.
- **Receipt / quote wording:** under 15 minutes it still says "Minimum 15 min charge (played 5 min)". Otherwise it says "Charged 30 min, in 15-minute blocks (played 20 min)". Nothing is shown when the time played is already a whole block.
- **Till:** nothing to change. The POS's running price uses the same engine, and the free play a member can use at close is already capped by the minutes charged, so a 20-minute walk-in can be covered by 30 free minutes.
- **Website wording:** the home page says "Walk in and we charge in 15-minute blocks", and the terms say walk-in time is charged in 15-minute blocks, rounded up, with 15 minutes as the minimum.
- **Spec:** `pricing.md` §1 and §3 (the formula), cases T3 and T3b; `README.md` launch values; `booking-site.md` terms.

**Verified**

1. **Pricing (114):** 5→15, 15→15, 16→30, 20→30, 30→30, 31→45, 45→45, 46→60, 61→75 minutes, each at 50c a minute. T3 (16 min 10 s) is 17 played, 30 billed, $15.00. T17 (a walk-in starting 14:59:30) keeps its one happy-hour minute, and the other 29 billed minutes are at the full rate. The explanation lines were checked word for word. The randomised invariants (segments add up to the subtotal, etc.) still hold.
2. **API (257):** a new till test opens a walk-in at 19:25: the quote at 19:45 is 20 played / 30 billed with the blocks line, and the quote at 20:10 is 45 / 45.
3. **Gate:** see the commit for this step.

**Worth knowing**

- The minimum is still the back office's per-type setting (15 at launch). If it were set to 30, a 10-minute walk-in would be charged 30, then blocks of 15 after that.
- `applyMinimum: false` still bills exact minutes. Nothing in the apps uses it now (overstay isn't charged, D48).
