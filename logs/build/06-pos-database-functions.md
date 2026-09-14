# Step 3a — POS database functions ✅

**Date:** 2026-09-14

**Done:** migration `…0900_pos`.

- **Schema changes:**
  - one open shift venue-wide (`shifts_one_open`) + `shifts.closed_by` — **D46 single till**
  - `sessions.closed_in_shift_id`
  - `payments.receipt_no` (sequential)
- **Service-role functions, each one transaction:**
  - `pos_open_shift`, `pos_cash_movement`, `pos_shift_totals`, `pos_close_shift`
  - `pos_open_walk_in`, `pos_arrive_booking`, `pos_mark_no_show`
  - `pos_close_session`, `pos_void_session`
- **Domain errors** are raised as `RG:<code>:<message>` and mapped by the API.

`pos_close_session` rules:
- re-checks the session (row lock)
- booking must be arrived
- member must be active or cancelling (row lock)
- referral must be active, unexpired and have uses left (row lock + increment)
- GST must equal round(total/11); total must equal computed unless there's an override with reason and approver
- cash needs tendered ≥ total; cash/card needs the open till
- then writes the session, booking, ledger, payment, cash movement, redemption, override and audit

`pos_void_session`:
- **open walk-in:** void (booking sessions must be closed instead)
- **closed session:** refund the remaining payment, cash-out movement for cash, return free minutes, void

**Verified:** `05_pos` (65 pgTAP tests) covers:
- **Walk-ins:** before opening; after last-open time (20:45 refused, 20:44 allowed); inactive resource; booked right now; double open; audit.
- **Till:** cash close without a shift; single-till uniqueness; negative float.
- **Close validation:** total mismatch; GST mismatch; insufficient cash; missing tender; close before open. A failed close leaves the session open and writes no payment.
- **Successful cash close:** change, receipt number, shift link, payment, cash movement, audit. A second close is refused.
- **Referrals:** last use taken; redemption recorded; external ref stored; used-up and expired codes refused, with full rollback.
- **Members:** past-due refused; balance overspend refused with no payment; 60 free minutes → $0 free payment with no till link.
- **Overrides:** without an approver refused; with an approver the price_overrides row and audit are written.
- **Paid out:** a reason is required; totals update.
- **Bookings:** early check-in refused; check-in OK; an arrived booking can't be a no-show; no-show before the hold refused; no-show after it OK; an open booking session can't be voided; prepaid close has no payment.
- **Voids:** open walk-in; closed cash sale (refund + cash-out); double void refused; free minutes returned.
- **Closing the till:** refused while a session is open; variances and flag correct; nothing left to close; no browser execute privilege.

**Mutation check.** Each change was made in the migration, the DB reset, the suite run, and the migration restored:

| Protection removed | Result |
|---|---|
| Referral max-uses | 1 failure |
| Cash tendered | 51 failures |
| Inactive member | 7 failures |
| Walk-in during booking | 10 failures |
| Till closing with open sessions | 4 failures |
| Cash sale movement | 3 failures |
| Free minutes returned on void | 1 failure |
| Override approver | 1 failure |

**All 8 caught.** Restored: 165/165.
