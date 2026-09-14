# Racegrounds — Decisions Log #2 — Stacking, Admin Control, Membership Balance, Booking Flow

**Date:** 2026-09-14
**Supersedes:** D3 (1-hour minimum), D4 (tier names, annual validity) in [Decisions Log #1](./01-2026-08-10-pricing-discounts-membership-venue.md); resolves Q3, Q4, Q6, Q10, Q14, Q18 and part of Q19 in [2026-08-10-project-plan.md](../planning/2026-08-10-project-plan.md) §9
**Status:** Locked unless re-opened. Items marked ⚠️ are assumptions that need a one-line confirmation.
**Follow-up:** the "Still open" items below were answered in [Decisions Log #3](./03-2026-09-14-launch-values-policies-staff-hosting.md).

---

## D9 — Stacking matrix confirmed (fixed, not admin-editable)

| Combination | Stacks? |
|---|---|
| Happy hour + Membership | ✅ Yes |
| Happy hour + Referral | ✅ Yes |
| Membership + Referral | ❌ No, only one applies |

- The math is still **multiplicative** (D2). Happy hour changes the rate, then the membership or referral % applies to the subtotal.
- The owner asked to edit **values** (prices, happy hour, codes, tiers), not the stacking **rules**. So the matrix is fixed in `packages/pricing`, and there is no back office screen for choosing a stacking mode or editing an exclusivity matrix. This removes the most complex part of the original Module 2.

⚠️ **Precedence when both are possible.** In the new booking flow (D14) the membership question comes first. Assumption: **a logged-in member does not see the referral field. Only non-members can enter a referral code.** At the POS the same rule applies: if a member is scanned, the referral input is disabled. This replaces the D1 "first-entered wins" rule.

---

## D10 — No maximum discount cap (Q3)

**Decision:** No cap. Step 5 of the D2 algorithm is removed.

With multiplicative stacking, the lowest possible total is still above $0 unless an admin sets a happy hour or referral discount to 100%. **Back office validation must reject any percentage that is ≥ 100% or < 0%.** That is the only safety rail.

---

## D11 — Everything commercial is editable in the back office

The admin can change all of these at any time without a deploy. Every change is written to `audit_log` with before and after values.

| Setting | Editable fields |
|---|---|
| Rates | Price per hour per resource type, per day and time window (rate bands) |
| Happy hour | Days of week, start/end time, discount %, per resource type, on/off |
| Referral codes | See D12 |
| Membership tiers | Name, discount %, monthly price, monthly free-play allowance (see D13, D15) |
| Minimum session | `resource_types.min_minutes` (launch value 15, see D16) |

---

## D12 — Referral codes (Q4)

**Decision:**
- Codes are created by the admin in the back office. **The referrer earns nothing.** A code is just a promo code under the name "referral".
- The code is **auto-generated, 6 characters, letters and digits**. The admin sets the **discount %** and the **maximum uses** (e.g. 10).
- When `uses_count = max_uses`, the code is rejected at the website and the POS.
- The admin can deactivate a code at any time.

**Engineering rules:**
1. Generate from an alphabet with no look-alike characters (no `0/O`, `1/I/L`). Codes are case-insensitive and have a unique constraint.
2. A use is counted **when payment succeeds**, not when the code is typed. The `uses_count` increment and the payment write happen in one transaction under a row lock, with `CHECK (uses_count <= max_uses)`.
3. While a checkout is open, the code is held with the same TTL as the slot hold, so two customers can't both redeem the 10th use.
4. If a booking is cancelled and refunded, the use is **restored**. ⚠️ Confirm.

⚠️ **Assumed, confirm:** percentage discount only (no fixed-$ codes); no expiry date (the use limit is the only limit); usable both online and at the POS; no limit per customer.

---

## D13 — Membership tiers: Silver / Gold / Diamond, monthly (supersedes D4)

| Tier | Discount | Monthly price |
|---|---|---|
| Silver | 5% | ⚠️ TBD |
| Gold | 10% | ⚠️ TBD |
| Diamond | 15% | ⚠️ TBD |

- "Platinum" is renamed to **Diamond**. Names, discounts and prices are all editable (D11).
- Prices include GST.
- The membership is a **monthly recurring subscription** (resolves Q10), see D17.

---

## D14 — Booking website flow (resolves Q19 in part)

```
1. Pick resource + date + start time + duration (15-min minimum)
2. Enter name (+ email and phone ⚠️, needed for confirmation and reminders)
3. "Are you a member?"
     ├─ No  → optional referral code field → live quote
     └─ Yes → log in (email + password) → membership discount applied
              → if free-play balance > 0: "Use 45 min of your balance?" [Yes / No]
              → live quote
4. Stripe Checkout for the remaining amount
     └─ if the total is $0 (balance covers everything) → skip Stripe, confirm directly
5. Confirmation email + calendar invite
```

**Accounts:** non-members check out as guests. Members have an account.

**Recommendation:** use email + password (Supabase Auth) with "forgot password". A magic link means leaving checkout to open email, which adds friction mid-booking.

---

## D15 — Membership free-play balance (new feature)

**Decision:** Each tier includes a monthly allowance of free play, set in the back office (example: 1 hour/month). It is tracked in **minutes**. Using 15 minutes leaves 45 minutes.

**Proposed model:**
```
membership_tiers.monthly_free_minutes   int, admin-editable
member_balance_ledger  id, member_id, delta_minutes (+grant / −use / +refund / ±adjust),
                       reason, booking_id?, session_id?, actor_id?, at
member balance = SUM(delta_minutes)   -- ledger, never a mutable counter
```
A ledger instead of a single number means every grant, use and correction can be traced. Admin manual adjustments go through the same ledger and are audited.

**Pricing interaction.** Free minutes are removed from the billable period **before** rates and discounts are applied. The member discount then applies to the paid minutes that remain.

⚠️ **Assumptions to confirm:**
1. **Allowance per tier**, so Silver, Gold and Diamond can each have a different allowance.
2. **No rollover.** On each monthly renewal the balance resets to the tier allowance.
3. **Resets on the subscription renewal date** (the Stripe `invoice.paid` webhook), not on the 1st of the month.
4. **Free minutes cover the start of the session.** "Your first 45 minutes were free." The alternative is to cover the most expensive minutes (e.g. outside happy hour), which is better for the customer but harder to explain.
5. **Usable on any resource.** A free minute on a driving sim is worth the same as a free minute on a billiard table, even if the sim's hourly rate is higher.
6. **Usable at the POS** for walk-ins as well as online bookings. The cashier asks "use balance?" at close.
7. **Returned to the balance** if a booking that used free minutes is cancelled within the refund policy.
8. **Ends when membership lapses.** If the subscription is cancelled or payment fails, the remaining balance is forfeited.

---

## D16 — Minimum session 15 minutes (supersedes D3's 60 minutes)

**Decision:** Sessions have a **15-minute minimum**, then are billed per minute (partial minutes round up).

| Actual play | Billed |
|---|---|
| 5 min | 15 min |
| 15 min | 15 min |
| 16 min 10 sec | 17 min |

- The D3 notional-period rule still applies, with 15 minutes: `billable_period = [opened_at, max(closed_at, opened_at + 15min)]`.
- The minimum is stored as `resource_types.min_minutes`, so it is editable in the back office and can differ between tables and sims.

⚠️ **Assumed, confirm:** the same 15-minute minimum applies to **POS walk-ins**, not only to online bookings. The booking timetable uses a **15-minute grid** (start times and durations in 15-min steps).

---

## D17 — Recurring memberships via Stripe Billing (Q10)

**Decision:** Monthly auto-renewing subscriptions using **Stripe Billing**. This is the easiest path, because Stripe provides most of the lifecycle work that Module 1 would otherwise build from scratch:

| Need | Stripe provides |
|---|---|
| Sign-up and card capture | **Checkout** in subscription mode |
| Card updates, cancellation, invoice history | **Customer Portal**, hosted by Stripe, no UI to build |
| Failed payment retries and emails | **Smart Retries** + built-in dunning emails |
| Receipts | Stripe invoice emails |

**What we still build:**
- Webhook handler (signature verification, idempotent by event id):
  - `checkout.session.completed` → activate member, issue QR
  - `invoice.paid` → extend `valid_until` by 1 month and **reset the free-play balance** (D15)
  - `invoice.payment_failed` → mark `past_due`. Discount and balance are suspended ⚠️ (or a grace period of N days?)
  - `customer.subscription.deleted` → lapse membership and forfeit the balance
- A back office tier editor that keeps local tiers and Stripe Prices in sync.

⚠️ **Price changes.** Stripe Prices can't be edited, so changing a tier's price creates a new Stripe Price. Decide whether **existing members keep their old price** (simplest, common) or are **moved to the new price at their next renewal**.

⚠️ **Fees note.** AU card fees are about 1.7% + $0.30 per charge, taken every month. On a $10/month tier that is roughly 4.7% of revenue.

---

## D18 — Venue resources and launch rates (Q6, Q18)

**Decision:** Three resource types at launch. Each type has its own rate, and all values are seed data that can be edited in the back office (D11).

| Resource type | Units | Labels (seed) | Launch rate | Min session |
|---|---|---|---|---|
| Billiard table | 2 | Table 1–2 | **$30/hr** | 15 min |
| Driving simulator | 6 | Sim 1–6 | **$60/hr** | 15 min |
| VR seat | 2 | VR 1–2 | ⚠️ **TBD** | 15 min |

- **VR seats are new.** No code is needed: they are a new row in `resource_types` plus two `resources` rows, with their own rate band. They can be booked online and opened/closed at the POS like everything else.
- Rates include GST. At launch each type has one flat rate band covering all opening hours. The admin can add more bands later (e.g. weekend pricing).
- Happy hour can be set separately per resource type (schema supports it). ⚠️ No launch happy hour values yet: which types, which days, what hours, what %?

---

## D19 — Opening hours (Q14)

**Decision:** **10:00am – 9:00pm**, same every day, `Australia/Sydney`. Editable in the back office.

**Proposed model:**
```
opening_hours  id, day_of_week (0–6), open_time, close_time   -- local wall-clock (D5)
closures       id, date, reason, all_day | open_time/close_time -- public holidays, private events
```

**Engineering rules:**
1. The booking timetable only offers slots that **end by closing time**. The last 15-min booking is 8:45–9:00pm.
2. Rate bands only need to cover opening hours. The engine still prices any minute outside opening hours at the nearest band rather than failing (e.g. a walk-in that runs past 9pm).

⚠️ **Confirm:**
- Can the POS keep a walk-in session open past 9pm, or does the POS warn staff at closing time?
- Is a per-date closures table (public holidays) wanted at launch?

---

## D20 — Project and venue name: Racegrounds

**Decision:** The venue and the whole project are called **Racegrounds**. "Rezon" in earlier docs refers to the same project.

**Rename applies to everything built from here on:**

| Item | Was | Now |
|---|---|---|
| Monorepo root / package scope | `rezon/`, `@rezon/*` | `racegrounds/`, `@racegrounds/*` |
| Subdomains | `book.` / `pos.` / `api.rezon.xxx` | `book.` / `pos.` / `api.racegrounds.xxx` ⚠️ domain TBD |
| QR payload prefix | `rzn:m:` / `rzn:r:` / `rzn:b:` | `rg:m:` / `rg:r:` / `rg:b:` |
| Stripe products, emails, receipts, tax invoices | Rezon | Racegrounds |

**Left as-is on purpose:**
- Earlier logs are historical records and are not rewritten.
- Invoice `REZ-2026-002` has already been issued, so its number and wording don't change.
- The local folder `rezon-booking-system` can be renamed whenever convenient. Nothing depends on it yet.

⚠️ **Confirm:** the domain name (e.g. `racegrounds.com.au`), and whether the legal/trading name on tax invoices is also "Racegrounds" (plus ABN).

---

## Updated pricing algorithm (replaces the one in Decisions Log #1)

```
INPUT: opened_at, closed_at, resource_type,
       member? | referral?  (never both — D9),
       use_balance_minutes? (member only, ≤ available balance — D15),
       rate_bands[], happy_hours[]

1. billable_period = [opened_at, max(closed_at, opened_at + min_minutes)]   # D16
   duration rounded up to whole minutes

2. free_period = first use_balance_minutes of billable_period               # D15 ⚠️
   paid_period = billable_period − free_period

3. boundaries = rate-band and happy-hour edges within paid_period,
   evaluated in Australia/Sydney local time                                 # D5
   segments = split(paid_period, boundaries)

4. for each segment:
     base_rate = matching rate_band.price_per_hour
     rate      = happy_hour applies ? base_rate × (1 − hh_pct) : base_rate
     subtotal += segment_minutes × rate / 60                                # D2

5. customer_pct = member ? member.tier.discount_pct
                : referral ? referral.discount_pct : 0                      # D9
   total = subtotal × (1 − customer_pct)                                    # D2
   (no cap)                                                                 # D10

6. gst = total / 11                                                         # GST-inclusive

7. emit explanation[]  — incl. "45 min free-play balance used, 15 min remaining"
```

---

## Scope impact vs invoice REZ-2026-002

| Requirement | Where it sits in the quote |
|---|---|
| Admin-editable happy hour windows and rates | Module 2 |
| Referral code engine (generation, use caps, atomic enforcement) | Module 2 |
| Recurring monthly membership | Module 1 |
| Configurable stacking mode + exclusivity matrix + discount floor + rule simulator | Module 2, **no longer needed** (D9, D10) |
| Member free-play balance + ledger | **Not quoted** (new) |
| Member login on the booking website | **Not quoted.** The quote assumed guest checkout. |
| VR seats as a third resource type | Covered by core A5. Adding a resource type is configuration, not new scope. |

This is effectively **Option B**, minus the parts of Module 2 that aren't needed, plus two new features. Under term 5 of the invoice, those two need a separate quote.

---

## Still open

| # | Question | Impact |
|---|---|---|
| — | "Membership is …": the sentence was cut off | ? |
| — | Domain name, and legal/trading name + ABN for tax invoices (D20) | Vercel, Stripe, receipts |
| — | Monthly price per tier (D13) | 🔴 Stripe Prices, seed data |
| — | Free-play balance assumptions 1–8 (D15) | 🔴 Schema + engine |
| — | Existing members on a price change: keep old price or migrate? (D17) | Stripe sync |
| — | Failed payment: suspend immediately, or N-day grace period? (D17) | Webhook logic |
| — | Where can a membership be bought: website only, or sold at POS too? Still want QR cards? | Membership + POS flows |
| — | Referral assumptions (D12) | Engine + schema |
| — | VR seat hourly rate (D18) | 🔴 Seed data |
| — | Launch happy hour: which resource types, days, hours, % (D18) | 🔴 Seed data |
| — | Walk-ins past 9pm allowed? Public holiday closures at launch? (D19) | POS + availability |
| Q8 | Do members get earlier/extended booking access? | Booking rules |
| Q9 | Which card terminal? | Phase 8 integration |
| Q11 | USB QR scanner or camera? | POS input |
| Q12 | Is a 4G failover router acceptable for offline tolerance? | POS architecture |
| Q16 | Cancellation / refund policy for online bookings | Booking flow + T&Cs |
| Q17 | How far ahead can customers book? Maximum session length? | Booking rules |
| Q21 | Walk-in waitlist? | Phase 8 |
| Q22 | How many staff accounts? | Trivial |
| Q23 | Existing branding / design assets? | UI |
