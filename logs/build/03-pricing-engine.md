# Step 2 — Pricing engine `@raceground/pricing` ✅

**Date:** 2026-09-14

**Done**
- `src/engine.ts`: `priceSession()` implements [spec/pricing.md](../../spec/pricing.md). It covers:
  - minimum + per-minute billing
  - free minutes first
  - per-minute rate band and happy hour classification in venue time
  - multiplicative member / referral-percent discount, fixed referral floored at $0
  - exact BigInt rational math, rounding half-up once
  - GST = total/11
  - largest-remainder segment amounts
  - explanation lines
- `src/time.ts`: `Intl`-based wall-clock conversion (no dependencies), `HH:MM` parsing, window matching.
- `src/money.ts`: `roundHalfUp`, `allocateLargestRemainder`, formatting.
- `src/validate.ts`: `validateRateBands`, `validateHappyHours`, `validateReferral`, `validateTier` (overlaps, bp ranges, time formats).
- **Runtime dependencies: none.**

**Verified**
1. **DST instants checked against real tz data first** (Node ICU 78.2, tzdata 2025c):
   - 2026-10-04: `15:59Z` = 01:59 AEST, then `16:00Z` = 03:00 AEDT. The 02:00–02:59 hour does not exist.
   - 2026-04-05: `15:59Z` = 02:59 AEDT, then `16:00Z` = 02:00 AEST. The 02:00–02:59 hour happens twice.
2. **Test suite: 71 tests, all passing.** It covers spec cases T1–T20 plus:
   - happy hour boundary inclusivity
   - resource-type-scoped happy hours
   - 0% tier
   - 11 invalid-input rejections
   - a **2,000-session randomised invariant test** (seeded):
     - segment minutes = billed minutes
     - segment cents = subtotal
     - 0 ≤ total ≤ subtotal
     - discount = subtotal − total
     - GST = round(total/11)
     - subtotal within ½ cent of an independent float recomputation
   - Key worked examples confirmed:
     - T4 Gold sim 14:30–15:30 Wed → **$51.30, GST $4.66**, explanation text matches the spec exactly
     - T5 → **$22.00**
     - T8 → **$12.83** ($12.825 rounds half up)
     - T14 DST start → **60 min**
     - T15 DST end → **180 min**, repeated hour billed at the 2am band rate twice
3. **Device-timezone independence.** The suite passes with `TZ` = `Asia/Jakarta` (machine default), `UTC`, `America/Los_Angeles`, `Australia/Perth` and `Pacific/Kiritimati` (UTC+14).
4. **Mutation check** (proves the tests catch real bugs, not just pass). Each bug was injected on its own, the suite run, and the source restored (a diff confirmed restoration):

   | Injected bug | Tests failing |
   |---|---|
   | Round half-up → floor | 3 |
   | Window end exclusive → inclusive | 6 |
   | Member discount ignored | 4 |
   | Free minutes applied to end, not start | 1 |
   | Minimum not applied | 4 |
   | Duration floor instead of ceil | 2 |
   | Overlapping happy hours: first instead of largest | 1 |
   | Fixed referral not floored at $0 | 2 |
   | Member + referral allowed together | 1 |
   | Remainder tie-break reversed | 1 |

   **All 10 caught.** After restoring: 71/71 passing.
5. `pnpm typecheck` ✅ and `pnpm build` ✅ (emits `dist/` with `.d.ts`).
