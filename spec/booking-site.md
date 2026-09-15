# Booking Site — `raceground.vercel.app`

Public, mobile-first. Every time is shown in **venue time (Sydney)** regardless of the visitor's device timezone. Every price is shown incl. GST.

## 1. Pages

| Route | Purpose |
|---|---|
| `/` | Venue intro, rates, happy hour, membership teaser, "Book now" |
| `/book` | Timetable + booking flow |
| `/booking/[ref]` | Booking status / confirmation (access via signed link) |
| `/booking/[ref]/cancel` | Cancellation with refund preview (signed link) |
| `/membership` | Tiers, sign up |
| `/login`, `/forgot-password`, `/reset-password` | Member auth |
| `/account` | Member: tier, status, renewal date, balance + ledger, QR, bookings, change tier, manage billing (Stripe Portal) |
| `/terms`, `/privacy`, `/refund-policy` | Legal |

## 2. Availability

The timetable is a grid per resource type for a chosen date, with **15-minute columns** from open to close.

**A start time is offered only if:**
- the date is within `today … today + booking_window_days` (venue-local dates, inclusive)
- `start ≥ now + online_cutoff_minutes`
- `start ≥ open_time` and `end ≤ close_time` on that date, and the day isn't closed
- no `held` (unexpired), `confirmed` or `arrived` booking overlaps on that resource

**Walk-ins don't block online availability.** A walk-in has no end time, so staff get the POS alert and must wrap up the walk-in before the booking.

**Durations** are offered in 15-minute steps from 15 min up to the time remaining until close. There is no maximum session length.

The customer picks a resource type, then a specific resource or "any available" (the API assigns the lowest-sorted free one).

## 3. Booking flow

```
1. Choose type → date → start → duration → (resource)
2. Details: name + (email or phone, at least one)
3. "Are you a member?"
     No  → optional referral code → apply → live quote
     Yes → log in (email + password)
           → member status must be active/cancelling, else "membership inactive" and continue as non-member
           → discount shown; if balance > 0: "Use free play? [0 … min(balance, duration)] min"
           → live quote
4. Review: full explanation (segments, discount, free minutes, total, GST) + policy summary + accept terms
5. "Pay" → API POST /bookings/hold
     - in one transaction: expire stale holds, insert booking `held` (exclusion constraint guards
       the slot), reserve referral use (count includes live holds), take free minutes (ledger `use`),
       hold_expires_at = now + 30 min + 10 min grace
     - if total > 0 → create Stripe Checkout (mode=payment, AUD, expires_at = hold_expires_at,
       customer_email prefilled if given) → redirect
     - if total = 0 → confirm immediately (step 6) without Stripe
6. Confirm (webhook checkout.session.completed, or immediate for $0), in one transaction:
     booking → confirmed; payment row; referral uses_count++ + redemption
7. Confirmation page + email with .ics invite, booking QR (rg:b:<ref>), cancel link
```

**Quote freshness.** The quote is recalculated on the server at hold time. If the price changed since the customer saw it (for example an admin edit), the customer is shown the new total before Stripe.

**Contact without email.** Stripe Checkout collects an email for the receipt, and that email is saved to the customer for the confirmation. A $0 booking with phone only shows the confirmation on screen only, and the page says so.

**Hold expiry.** On `checkout.session.expired`, or when a later hold finds it stale, the booking becomes `expired`, the slot frees up, free minutes are returned and any reserved referral use is released. A payment that arrives for an already expired hold is refunded in full.

### Referral code checks (server)
- The code exists, is active, and is not past `valid_until`.
- `uses_count + live held reservations < max_uses`.
- The customer is not logged in as a member.

## 4. Cancellation and refund policy

Customers cancel through the signed link in their email.

| Cancelled by | When | Refund | Free minutes | Referral use |
|---|---|---|---|---|
| Customer | ≥ 24 h before start | 100% | Returned | Not restored |
| Customer | 2–24 h before | 50% | Not returned | Not restored |
| Customer | < 2 h before | Cancel not offered; no refund | — | — |
| No-show | 15 min after start, marked at POS | None | Not returned | Not restored |
| Venue (fault, closure) | Any time | 100% | Returned | Not restored |

- Refunds go to the original card through the Stripe Refunds API. The amount is based on the **amount paid** (`total_cents`).
- Stripe keeps its processing fee on refunds.
- **Late arrival:** the session ends at the booked end time.
- **Overstay:** not charged. Staff are prompted to end the session when the booking time is up.
- A superadmin can issue any refund, full or partial, with a reason. It is audited.

## 5. Emails

| Email | When |
|---|---|
| Booking confirmation + .ics + booking QR + cancel link | On confirm |
| Reminder | 24 h before start |
| Cancellation + refund amount | On cancel |

## 6. API implementation notes (Phase 6b)

- **Times are sent as venue date + wall time** (`date`, `startTime`, `durationMinutes`), never device-local instants. A time that doesn't exist on a DST change day is refused.
- **Availability** returns, per 15-minute start from the cutoff to close: how many resources are free and the longest length on each (up to the next booking or close). Unexpired holds block; expired ones don't, even before cleanup.
- **"Any available"** tries resources in sort order and takes the first free one.
- **Checkout:** payment mode, AUD, **cards only** (so a completed checkout is always paid), Adaptive Pricing off, expires about 1 minute after the 30-minute hold time (Stripe's minimum). The database hold lasts 10 minutes longer.
- **Booking link token:** 32 random bytes; only its sha256 is stored. It is carried in the Checkout session metadata so the webhook can email the link.
- **Late payment:** if the hold is gone (or the amount differs) when `checkout.session.completed` arrives, the full payment is refunded through Stripe, audited, and the customer is emailed. Retries never refund twice (idempotency key per booking).
- **Customer cancel:** refund quote → Stripe refund (idempotency key per booking + amount; an earlier refund made for this cancel is reused) → `booking_cancel` with the refund id → email.
- **Emails** (console transport until Resend): confirmation with `.ics` invite, check-in code `rg:b:<ref>` and link; cancellation with refund amount; late-payment refund.

## 7. Legal pages content (drafted in Phase 7)

- **Terms:** booking rules and the refund policy above, conduct, and the fact that time played is billed per minute.
- **Privacy policy:** name, email and phone collected. Payments are handled by Stripe, and no card data is stored.
