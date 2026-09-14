# Phase 6a — Online booking rules in the database ✅

**Date:** 2026-09-14

**Done**

Migration `supabase/migrations/20260914001200_bookings.sql`. Every function is service-role only (the API) and raises `RG:<code>:<message>` like the POS functions.

- **`booking_hold(p)`**: one transaction that
  - sweeps stale holds first
  - checks the resource is active
  - checks the 15-minute grid and the type's minimum
  - checks the start is ≥ 30 min from now
  - checks the booking window (7 days, venue dates)
  - checks opening hours and closed days
  - requires an active/cancelling member, or a guest with name + email/phone (customer reused by email in any case, or by phone)
  - never combines member and referral
  - checks the referral code, counting live holds as reserved uses
  - inserts the `held` booking (an overlap becomes `slot_taken`)
  - takes free minutes from the balance
  - writes an audit row
- **`expire_stale_holds(now)`**: now takes the clock and **returns the free minutes** of every hold it expires. The old version only flipped the status.
- **`booking_attach_checkout`**, **`booking_release_hold`**: store the Stripe Checkout id; release a hold straight away when Checkout expires.
- **`booking_confirm(booking, p)`**:
  - held → confirmed
  - amount paid must equal the total; `free` only for $0; Stripe needs the payment id
  - payment row, not on the till
  - referral use + redemption
  - saves the email Stripe collected for a phone-only guest
  - a repeated webhook returns `duplicate`
  - a payment for an expired hold raises `hold_expired` so the API refunds it
- **`booking_cancel_quote` / `booking_cancel`**: the refund policy, based on the amount paid.
  - **Customer:**
    - ≥ 24 h: 100% + minutes back
    - 2–24 h: 50% (rounded down), minutes kept
    - < 2 h: refused
    - the refund must match the quote the customer saw (`refund_changed` otherwise)
  - **Staff (reason required):**
    - venue fault: 100% + minutes, any time
    - override: any amount up to what was paid, even < 2 h, minutes optional
  - A refund > $0 needs the Stripe refund id. The referral use is never restored. Audited with actor and reason.
- **Trigger `referral_codes_guard_reservations`:** a use added by a POS close or a confirmation may not push uses + live holds over `max_uses`. Going over max on its own is still the existing check constraint.
- **Spec updated:** `data-model.md` (functions, grace, minutes at hold), `booking-site.md` (flow), `membership.md` (when minutes are used).

**Design choices made here (not new business rules)**
1. **Free minutes are taken when the hold is made, not at payment.** Otherwise two open holds could both plan to use the same 60 minutes and the second payment would fail after the customer had paid. They come back if the hold expires or is released.
2. **Hold = 30 min + 10 min grace.** Stripe refuses a Checkout expiry under 30 min from creation, and the webhook can arrive a little after payment. The API will set the Checkout expiry to about 30 min, so the hold outlives it.
3. **Referral reservations are also enforced at the POS** (trigger), not only for online holds. Otherwise a walk-in could use the last use while an online customer was paying for it, and their payment would fail on confirm.
4. **`booking_cancel` needs the Stripe refund id.** The API will quote → refund through Stripe (idempotency key per booking) → cancel. If the database step then fails, the retry reuses the same Stripe refund.

**Verified**
1. `supabase db reset` applied every migration and the seed cleanly.
2. **pgTAP `08_bookings.test.sql`, 82 tests**, covering:
   - every validation, including exact boundaries: 30 min ahead allowed / 1 min less refused; 7th day allowed / 8th refused; ending exactly at close
   - closed day; guest customer reuse; phone-only guest
   - overlap → `slot_taken`
   - minutes taken at hold; minutes double-spend refused; balance limit
   - expiry one second either side, minutes returned once
   - referral reservation blocking a second hold **and** a POS use; release frees it
   - confirm checks (amount, missing payment id, free vs paid), duplicate webhook, Stripe ids and payment row, referral use + redemption, expired hold refused, $0 confirm, email capture
   - quotes at 24 h exactly / 1 s under, 2 h, venue fault
   - cancel checks (stale refund, missing refund id, customer claiming venue fault, too late), full cancel with refund row, cancel once, half cancel keeping minutes, referral not restored, $0 member cancel returning minutes, staff override rules and audit
   - privileges
3. `01_schema_seed` privilege test updated for the new `expire_stale_holds(timestamptz)` signature. `02_constraints` still sees its own check-constraint error for uses above max.
4. **Full pgTAP: 327/327 PASS** (245 before + 82).
5. **Mutation check, 27 deliberate breaks** applied to the live database one at a time, full pgTAP run after each, original restored and re-verified at the end. **26/27 killed** on the first run; the one survivor got a new test and is now killed too (Issues #2).
6. Regenerated DB types (`pnpm --filter @raceground/db gen:types`) include the new functions and the `expire_stale_holds(p_now?)` signature. Gate after a clean `db reset`: turbo typecheck/lint/test **9/9** (pricing 78, API 96), pgTAP **327/327**. No app code changed, so e2e was not re-run.

**Issues found and fixed**
1. **New trigger changed an existing error:** `02_constraints` #29 expected the check-constraint error (23514) for uses above max, but the trigger raised first. The trigger now only acts when live holds make the difference.
2. **Mutation survivor, "half refund returns minutes":** no test cancelled a member booking that used free minutes in the 2–24 h window. Added a member booking (30 free min + $13.50) cancelled 10 h ahead: $6.75 refunded and the balance unchanged. The mutation is now killed.

**Not built yet**
- API endpoints, Stripe Checkout/refunds, emails and the website (6b, 6c).
