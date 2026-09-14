# Raceground — Decisions Log #5 — POS Build Decisions

**Date:** 2026-09-14
**Status:** Made by the developer during Step 3 (POS). Items marked ⚠️ need the owner's confirmation.

---

## D46 — One shared till (shift) for the venue ✅ confirmed by owner 2026-09-14

**Decision:** At most **one open shift venue-wide**. Anyone who is PIN-signed-in can take payments on it, and each payment still records the staff member who took it. The shift records who opened it and who closed it. The shift report includes a per-staff breakdown.

**Why:** The venue has one cash drawer. The earlier spec had one shift per staff member, which breaks as soon as the owner steps in while the cashier's shift is open: two shifts would share one drawer, so neither count could ever match. The spec is updated.

**Confirm:** if a second till or drawer is ever added, this becomes one shift per till.

## D47 — The close time is frozen when the total is quoted

**Decision:** When the cashier presses **Close**, the POS gets a quote with a fixed `closedAt`. Payment is recorded against that exact quote if it's completed within **2 minutes**; after that, the POS must re-quote.

**Why:** The cashier types the amount into the CommBank terminal. If the price ticked up by one minute between the quote and saving the payment, the terminal and the POS would disagree.

**Also:**
- The POS sends the total it showed as `expectedTotalCents`. If anything changed in the meantime (for example an admin edited rates), the close is refused with `quote_changed` and the new total is shown.
- The play time billed ends at the quoted time, not when the payment was saved.

## D48 — Overstay is charged on the booking's own session

**Decision:** A booked customer who plays past the booking end is charged for the extra minutes when their session is closed. It's the same session row, marked `mode: overstay` in its pricing snapshot, with no separate "overstay session". Extra minutes use the normal rates, happy hour and member discount, with **no 15-minute minimum**. If they finish on time, the close records nothing to pay.

⚠️ **Question — overstay grace period.** Right now closing a booking even 30 seconds late charges 1 extra minute (e.g. $0.50 on a table). Do you want a grace period (e.g. first 5 minutes free) before overstay is charged? It's a one-line setting.

## D49 — Referral use is not restored when a session is voided

**Decision:** This is consistent with D25 (not restored on refund). A voided session still refunds the payment in full and returns any free-play minutes used.

## D50 — Receipts

**Decision:**
- Receipts have sequential numbers (`payments.receipt_no`).
- Receipts over $82.50 are titled "Tax Invoice"; below that, "Receipt".
- Every receipt shows the business name, ABN (once provided), the itemised pricing lines, GST, the payment method, cash tendered and change, who served, and the member number.
- An override shows the original price and the reason.
- A voided sale can be reprinted, marked as voided.
- **Emailed receipts** come with the email provider in Phase 5/6. The POS prints from the browser until then.

## D51 — Configuration audit happens in the database

**Decision:** Changes to configuration tables are audited by a trigger in the same transaction as the change. The API passes who made the change and why as request headers.

**Why:** An audit row written by the API as a separate call could fail after the change was already saved, and a new admin route could forget to write one. The trigger makes an unaudited config change impossible.

**Scope:** Writes made directly in the database (migrations, seed, psql) are not audited.

## D52 — Complimentary memberships

**Decision:** A superadmin can create a membership without billing (staff perks, sponsors, prizes). Every one needs a reason and can have an end date. Paid memberships still come only through Stripe (Phase 5).

**Why:** Module 1 of the proposal lists complimentary memberships. It also lets member discounts, cards and free play be used before online billing exists.

## D53 — Partial refunds of counter sales

**Decision:** A superadmin can refund part of a cash or card sale with a reason. It needs an open till, and a cash refund takes the money out of the till. Voiding a sale refunds whatever is left. Online (Stripe) payments are refunded through Stripe once the booking site exists.

## Owner answers, 2026-09-14

- **D46 single till:** confirmed.
- **D48 overstay:** owner clarified: **don't charge overstay.** When a booking's time is up, the POS pops up "Table X — time is up" telling the cashier to close the table. Implemented as D48-revised below.
- **Stripe:** a test-mode key was provided and stored in `apps/api/.env.local`, which is git-ignored.
  - Checked read-only: account `acct_1UFVxhLM3ciDZoKt` ("Raceground sandbox"), country AU, currency AUD, no products yet.
  - The key was pasted into chat, so it should be rolled in the Stripe dashboard before go-live. Live keys will be separate anyway.

## D48 (revised) — Booked sessions are never charged for running over ✅ owner 2026-09-14

**Decision:**
- A booked session is prepaid. Closing it records nothing to pay, however late it's closed.
- Member discounts, referral codes and free play only apply to walk-ins.
- Instead of charging, the POS shows a **time-up pop-up** as soon as a booking's end time passes: "Table 1 — time is up. Booking ended at 17:00 (5 min ago). Ask the customer to finish and close the table." The buttons are **Close Table 1** (opens the $0 close directly) and **Remind me in 2 min**.
- The same pop-up appears for any table still open after closing time.
- The tile still shows **Overdue**, and the floor also warns 10 minutes before a booking starts on a table with a walk-in running.

This supersedes the original D48: there's no overstay pricing and no grace period.
