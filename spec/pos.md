# POS — `raceground-pos.vercel.app`

Runs in Chrome on a laptop or desktop at the counter, with a USB 2D QR scanner and a 4G failover router. It is online-only.

## 1. Device login and staff switching

- **Device login:** a staff member signs in with email + password (Supabase Auth). The device stays signed in.
- **Operator:** every action is attributed to the current **operator**, chosen on a lock screen by tapping your name and entering a **4-digit PIN**.
  - The operator switches back to the lock screen after **5 minutes idle** or on "Lock".
  - PINs are verified by the API. 5 wrong attempts lock that staff PIN for 5 minutes (`pin_locked_until`), and the lockout is audited.
- **Back office screens** require an operator with role `superadmin`.

## 2. Shifts (one shared till — D46)

- **One till:** at most **one open shift venue-wide**. Any PIN-signed-in operator can take payments on it, and each payment records its staff member. Opener and closer are both recorded.
- **No shift, no payments.** Someone must **open the shift** (declare opening float) before any cash or card payment. A $0 close (free play or prepaid booking) doesn't need a shift.
- The shift can't be closed while any session is open.
- **During the shift:** cash sales and refunds create `cash_movements` automatically. Paid-in and paid-out need a reason.
- **Close shift** shows:
  - **Expected cash** = float + cash sales − cash refunds + paid-in − paid-out. Staff enter the **counted cash**.
  - The **POS card total**. Staff enter the **CommBank terminal end-of-day total**.
  - The variance for each. If either is over `cash_variance_threshold_cents`, the shift is **flagged** for superadmin review.
- **Shift report** (printable and emailable):
  - session count and gross
  - discounts, split by happy hour / membership / referral / override
  - free minutes used
  - tender split and both variances

## 3. Floor view

A grid of resource tiles grouped by type. Each tile shows:
- **State:** Free · In use (walk-in) · In use (booking) · Booked soon · Overdue
- **Running timer** from `opened_at`, computed on the client and synced across terminals via Supabase Realtime
- **Live running price** (engine quote to "now")
- **Next booking:** "Next booking 16:00 · Jane S."
- **Alerts:**
  - 10 min before a booking starts on a tile with a walk-in running
  - at `close − 15 min` and at close for any open session
  - a booked session running past its end time (**Overdue**)

## 4. Sessions

### Open a walk-in
- **Blocked when:**
  - the resource already has an open session (DB unique index)
  - `now > close_time − walkin_last_open_minutes`
  - the venue is closed today
- **Warning (not blocking):** a booking starts on this resource within 60 minutes. The dialog shows "Free until 16:00".

### Open from a booking (arrival handoff)
- **Today's bookings** list: search by ref, name, email or phone, or scan the booking QR (`rg:b:<ref>`).
- **Mark arrived** → a session opens with `kind = booking` and `booking_id` set. It is **already paid**, so closing charges nothing unless there's an overstay.
- **Late arrival:** the session still ends at the booked end.
- **No-show:** available once `now ≥ start + no_show_hold_minutes`. Marks the booking `no_show` and frees the resource. No refund.

### Close a session
1. **Customer identification** (optional, one only):
   - **Scan member QR** (`rg:m:<token>`), or search a member by phone or email. The POS shows name, tier, status and balance.
     - The **cashier must confirm the member's name** with the customer.
     - If the member is not `active`, the POS shows "Inactive — payment failed" or "Membership ended" and gives no discount or balance.
   - **Or enter/scan a referral code** (`rg:r:<code>`). This field is hidden once a member is attached, and the member field is hidden once a code is applied. Either can be cleared, which is audited.
2. **Use free play?** Shown if a member has balance: "Use up to N min" (defaults to the maximum usable).
3. The **engine quotes** the total and the POS shows the full explanation. The quote **freezes the close time** (D47).
   - Payment must be completed within **2 minutes**, otherwise the POS re-quotes.
   - The POS sends the total it displayed, and the API refuses the close (`quote_changed`) if the total is now different.
4. **Manual override** (optional): new amount + reason.
   - A cashier also needs a **superadmin PIN** on the same screen.
   - Writes `price_overrides` and `audit_log`.
5. **Tender:** Cash (enter amount given → change shown) · Card (CommBank terminal, optional terminal receipt no.) · Free (total $0).
6. **Commit (API, single DB transaction):**
   - close the session and save `pricing_snapshot`
   - write the payment
   - write the ledger `use` entry
   - increment the referral use (with row lock) and write the redemption
   - write the cash movement and the audit entry
7. **Receipt:** print (browser print, 80 mm layout) and/or email.
   - Shows the explanation, GST, business name and ABN.
   - Receipts over $82.50 are titled **"Tax Invoice"**.

### Overstay (booked session past its end)
- If the next slot is free, the cashier can **extend**. When the session closes, the extra minutes (`booked end → closed_at`) are priced with `applyMinimum = false`, using member, balance or referral as usual, and charged at the POS **on the booking's own session** (D48). A booking closed on time records nothing to pay.
- If the next slot is booked, the tile shows **Overdue** and staff must end the session. Overstay minutes still bill.

### Void
Superadmin only, with a reason. It is audited. If a payment was taken, a refund is required.

## 5. Selling a membership at the counter

1. Enter customer name + email (+ phone) and pick a tier.
2. The API creates a Stripe Checkout Session (subscription mode) linked to that customer.
3. The **POS shows a QR** code of the Checkout URL. The customer scans it with their phone and pays there.
4. The POS polls the member's status and shows **"Active ✓"** when the webhook lands.
5. The customer receives the welcome email: a set-password link and their member QR.

## 6. Refunds at the POS

Superadmin only.
- **Cash or terminal payments:** the refund is recorded and staff refund on the terminal or from the drawer.
- **Stripe payments:** the refund is made through the Stripe API.

All refunds need a reason and are audited.
