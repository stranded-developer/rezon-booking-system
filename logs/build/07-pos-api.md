# Step 3b — POS API ✅

**Date:** 2026-09-14

**Done**
- **`@raceground/pricing`:** `localToInstant` (venue date + wall time → UTC; DST gap → after the gap, overlap → earlier instant) and `addDaysToDate`. 7 new tests: round-trip every 30 minutes across both 2026 DST changes, 23 h / 25 h day lengths, gap and overlap behaviour. They pass under `TZ` = Jakarta, UTC and New York. Total: 78.
- **API deps:** an injectable `clock` (system clock in production, a movable `TestClock` in tests).
- **Services:**

  | File | Purpose |
  |---|---|
  | `venue.ts` | settings, pricing context (DB → engine types), range parsing, GST |
  | `lookup.ts` | member by QR (sha256 of token) / id / search (name, email, phone); referral lookup (typed or `rg:r:` scanned, case-insensitive) with usable/reason |
  | `pin-check.ts` | shared PIN verification + lockout. `/pos/operator` was refactored onto it and the existing tests still pass |
  | `charge.ts` | `quoteClose` (walk-in / prepaid / overstay; frozen close time valid 2 min; member eligibility; referral usability; free minutes ≤ balance) · `closeSession` (`expectedTotalCents` → `quote_changed`; override approval by superadmin PIN; tender rules; snapshot incl. tender; RPC) · `buildReceipt` |
  | `floor.ts` | tiles with state free / in_use / booking / overdue / awaiting_arrival, next booking, minutes to next, walk-in booking warning, no-show time; shift and opening/closing times; today's bookings with search |
  | `shift-report.ts` | cash and card reconciliation, tender split, refunds, discounts (happy hour / member / referral / override), free minutes, per-staff totals, using `closed_in_shift_id` |

- **Routes** (all need device session + operator; void is superadmin):
  - `GET /pos/config`, `/pos/floor`, `/pos/bookings/today`
  - shifts: `current`, `open`, `current/movements`, `current/close`, `:id/report`
  - `POST /pos/members/scan`, `GET /pos/members/search`, `GET /pos/referrals/:code`
  - `POST /pos/sessions`, `sessions/:id/quote|close|void`, `GET sessions/:id/receipt`
  - `POST /pos/bookings/:id/arrive|no-show`
  - The operations routes are nested inside `/pos`, so the device check runs once and the operator check follows it.

**Verified**
1. **`pos.integration.test.ts`: 27 tests**, a full till day on a fixed clock (Wed 16 Jan 2030, Sydney), every amount checked:
   - **Access:** operator required; config.
   - **Till:** no shift → cash close refused; open once.
   - **Walk-in with member:** 09:30 refused; floor state in_use; QR scan / invalid / unknown / search.
   - **Quote** 14:30–15:30 Gold: **$28.50 − $2.85 = $25.65, GST $2.33**, explanation text exact. Quote 3 min old → `quote_expired`; changed total → `quote_changed`.
   - **Cash close:** change $4.35, receipt fields and reprint identical, tile free again, double close refused.
   - **Referrals:** $5 code → $22.00 and used up; used-up / member + referral / past-due refused.
   - **Concurrency:** two simultaneous closes racing for a code's last use → exactly one 200 and one `referral_invalid`, loser still open. Two simultaneous closes of one session → one 200, one 409, exactly one payment.
   - **Free play:** 60 free minutes on a sim → $0, balance 0, next request refused; free tender refused when money is owed.
   - **Overrides:** cashier without approver 403, wrong PIN 401, cashier as approver 403, owner PIN 200 (receipt shows original + reason, DB row has requester + approver); superadmin self-approves.
   - **Voids:** cashier 403; owner voids the cash sale → refund $25.65, receipt marked voided.
   - **Bookings:** floor shows next booking in 10 min, then awaiting arrival with no-show time; today's list search; check-in → booking → overdue → overstay 10 min = $5.00, booking completed; on-time booking → prepaid, no payment row; no-show refused at 19:10, OK at 19:15; walk-in warning "free for 40 min" and tile warning at 19:52.
   - **Closing the till:** paid-out recorded; close refused while a session is open; exact counts → not flagged; the report's cash (float, sales $45.65, refunds $25.65, paid out $5, expected), card total (tracked independently in the test), referral discounts $6, overrides $15, free minutes 60 and voided count all match.
2. **Mutation check on the API.** Each bug was injected on its own and the source restored:

   | Injected bug | Result |
   |---|---|
   | Stale quote accepted | 2 failures |
   | Changed total not detected | 4 failures |
   | Cashier override without approval | 1 failure |
   | Approver role unchecked | 1 failure |
   | Cashier can void | 1 failure |
   | Overstay billed from session open | 3 failures |
   | Overdue never shown | 3 failures |
   | Shift report not scoped to its shift | 1 failure |
   | GST rounded down | 14 failures |
   | Free tender accepted when owed | **survived** |

   **Accepted survivor:** the "free tender accepted when owed" check is duplicated in `pos_close_session`, which still refuses it with the same 422. The API check only gives a friendlier message.
3. **Cross-suite, uncached**, on fresh and used databases:
   - pricing 78 + API 66 + pgTAP 165 all pass in order DB → API → DB → API → DB, and on a fresh DB
   - no open sessions, open shifts or active test resources are left behind

**Issues found and fixed during this step**
1. **Shift report used a time window.** It selected sessions by close time within the shift's open period. That is wrong when a session closes at a different time than recorded (tests exposed it), and it misses $0 closes with no payment. Replaced with an explicit `sessions.closed_in_shift_id` set at close time, with a pgTAP assertion added.
2. **Route mounting.** Two route groups mounted on `/pos` would have run the device check twice per request, and the operator check's placement depended on registration order. The operations routes are now nested.
3. **Seed count test.** It counted inactive test resources (they can't be deleted), so it failed after the API tests. It now counts active seeded resources only.
4. **Silent second test run.** `pnpm test --force` printed nothing because pnpm rejected the flag; it hadn't run at all. Re-ran with `pnpm exec turbo run test --force`.

**Decisions made (Decisions Log #5):**
- D46 single till ⚠️
- D47 frozen close time
- D48 overstay on the booking session (grace period question ⚠️)
- D49 referral not restored on void
- D50 receipts
