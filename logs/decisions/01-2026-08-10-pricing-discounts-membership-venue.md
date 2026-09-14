# Decisions Log #1 — Pricing, Discounts, Membership, Venue

**Date:** 2026-08-10
**Supersedes:** open questions Q1, Q2, Q5, Q7, Q13, Q15, Q20 in [2026-08-10-project-plan.md](../planning/2026-08-10-project-plan.md) §9
**Status:** Locked unless re-opened. Items marked ⚠️ need a one-line confirmation.

---

## D1 — Membership vs Referral: mutually exclusive, first-entered wins

**Decision:** At both checkout (booking site) and point of sale, the UI presents *both* input options — membership scan and referral code. As soon as one is filled, the other is disabled. Only one customer-level discount is ever applied.

⚠️ **Wording check:** the answer given was "membership+referral stacks, whichever is inputted first," but the mechanic described — "once one is filled the other can't" — is mutual **exclusion**, not stacking, and matches the original rule (membership + referral ❌). Implementing as mutually exclusive. Confirm this reading.

**Implications accepted:**
- The customer may end up with the *worse* of the two discounts. A Platinum member (15%) who types a 10% referral code first gets 10%. This is intentional per the rule; it is not a bug.
- Because of that, the field must be **clearable**. Cashier/customer can remove the entered discount, which re-enables the other input. In POS, clearing after a discount has been applied is recorded in the audit log with the staff PIN.
- The UI must show, at the moment of entry, what each option is worth — so nobody locks in the worse one blindly. On the booking site: "Referral code applied: 10% off. Members save up to 15% — remove code to use your membership instead."

**Precedence rule for code:** `applied_discount = first_entered(membership, referral)`. Never `max()`. Never both.

---

## D2 — Stacking math: multiplicative

**Decision:** Multiplicative, and it falls out of the architecture naturally:
- **Happy hour** modifies the *hourly rate* of the affected time segments
- **Membership or referral** multiplies the resulting *subtotal*

```
total = Σ(segment_minutes × discounted_rate / 60) × (1 − customer_discount_pct)
```

**Worked example** — standard $30/hr, happy hour 20% off, Gold member 10%, 1 hour entirely inside happy hour:

| Method | Calculation | Total |
|---|---|---|
| Additive (rejected) | $30 × (1 − 0.30) | $21.00 |
| **Multiplicative (chosen)** | ($30 × 0.80) × 0.90 | **$21.60** |

The difference is small per session and material over a year. It also makes a >100% discount arithmetically impossible.

⚠️ **Still recommend a max-discount cap** (original Q3, unanswered) as a safety rail — a configurable floor, e.g. "never below 50% of rack rate," so a mistyped admin value can't zero out a day's revenue. Cheap to add now, painful to retrofit. Default suggestion: 50%.

---

## D3 — Billing granularity: 1-hour minimum, then per-minute

**Decision:**
- **Minimum billable time = 60 minutes.** 16 minutes of play bills as 1 hour.
- **Beyond 60 minutes, bill per actual minute** (partial minutes round up to the next whole minute).

| Actual play | Billed |
|---|---|
| 16 min | 60 min |
| 59 min | 60 min |
| 61 min | 61 min |
| 90 min 20 sec | 91 min |

### Derived decision — how the minimum hour interacts with happy hour ⚠️

This wasn't specified and had to be resolved. Scenario: customer opens Table 1 at **5:50pm**, closes at **6:06pm** (16 min actual). Happy hour starts at 6:00pm. They're billed for a full hour — but at *which* rate mix? Only 6 of their played minutes were in happy hour.

**Chosen approach — notional period.** Build the billable period as
`[opened_at, max(closed_at, opened_at + 60min)]`
and then segment *that* across rate bands. The example above prices as if they played **5:50–6:50pm**: 10 min standard + 50 min happy hour.

Chosen because:
- It's explainable in one sentence at the counter: *"You're charged for one hour from when you started."*
- It's consistent — the same start time always produces the same minimum charge, regardless of when they walked out
- The alternatives (pricing 16 real minutes then padding 44 minutes at some arbitrary rate) are impossible to explain and arbitrary to implement

Say the word if you'd rather the padded time bill at the standard rate instead — it's a one-line change in the engine, but it *does* mean two customers who started at the same time can be charged differently, and the counter conversation is harder.

**Follow-on:** minimum booking length on the booking site is therefore also **1 hour**, in 1-hour-then-per-minute increments. Bookings will most likely be sold in clean 30-min blocks (1h, 1.5h, 2h…) — confirm in a later pass.

---

## D4 — Membership tiers (launch values, admin-editable)

| Tier | Discount | Price |
|---|---|---|
| Silver | 5% | $10 |
| Gold | 10% | $20 |
| Platinum | 15% | $30 |

- Prices are **GST-inclusive** (AU convention). GST component = price ÷ 11.
- All four values live in the `membership_tiers` table and are editable in the back office without a deploy — as are the tier names.
- Assumed **annual** validity, per the original brief ("say a year validity").

⚠️ **Recommendation on renewal (original Q10, still open).** At $10–$30/year, an auto-renewing Stripe subscription is poor value: AU domestic card fees (~1.7% + $0.30) eat ~6% of a $10 Silver membership, and you inherit failed-payment dunning, card-expiry chasing, and subscription-cancellation support for a $10 product.

**Suggest instead:** one-time purchase with a `valid_until` date, plus an automated renewal reminder email at 30/7/1 days. Simpler to build, cheaper to run, nothing to cancel, and members re-buy in two clicks. Recurring can be added later if the price points rise. Your call.

---

## D5 — Venue timezone: Australia/Sydney (DST applies)

**Decision:** `Australia/Sydney`. AEST (UTC+10) / AEDT (UTC+11), switching on the first Sunday of October and the first Sunday of April.

**Engineering rules that follow — non-negotiable:**
1. All timestamps stored as `timestamptz`, i.e. UTC. No naive local times in the database, ever.
2. Rate bands and happy-hour windows are stored as **local wall-clock times** (`TIME` + days-of-week), and matched by converting the session timestamp into `Australia/Sydney` at evaluation time. "Happy hour is 6–7pm" must stay 6–7pm on both sides of a DST switch.
3. Duration is always computed from **UTC instants**, never from local wall-clock arithmetic. On the April transition, 2:00–3:00am local happens twice — a session spanning it is genuinely 60 minutes longer than the clock suggests, and the customer must be billed for real elapsed time.
4. On the October transition, 2:00–3:00am local does not exist. Band-splitting must not emit a zero-or-negative-length segment.
5. Every displayed time is rendered in venue-local time regardless of the viewer's device timezone — including for a customer booking from overseas.
6. DST transition cases go into the pricing engine's test suite as fixtures. Both directions.

The venue is almost certainly shut at 2am, but the engine must be correct anyway — this is the kind of bug that surfaces once a year and is impossible to diagnose after the fact.

---

## D6 — No food & beverage

**Decision:** POS sells **time only**. No product catalogue, no stock control, no order lines, no modifiers, no kitchen flow.

Removes a large amount of scope. The schema keeps a generic `line_items` concept on sessions so F&B could be added later without a migration of existing data, but nothing is built for it now.

---

## D7 — Cash accepted → shift & drawer reconciliation required

**Decision:** Cash is a tender type, which means the POS needs proper cash controls. Confirmed in scope for **Phase 3**:

- **Shift open:** staff member logs in, declares opening float
- **Cash movements:** payments in, refunds out, plus manual paid-in / paid-out with a required reason
- **Shift close:** system shows expected cash, staff counts and enters actual, system records the variance
- **Shift report:** per staff member — session count, gross, discounts given (broken out by happy hour / membership / referral), tender split, variance
- Every cash event attributed to a staff member via the 4-digit PIN
- Variances above a configurable threshold flagged for admin review

Without this, cash discrepancies are undetectable and unattributable. It's the single most common gap in v1 POS builds and it is not optional once cash is on the table.

---

## D8 — Confirmed: proceed with the three flagged designs

Approved as recommended in the plan doc:

1. **Boundary-splitting pricing engine** — sessions split at every rate-band and happy-hour boundary and priced per segment (§6 of plan). Now also handles the D3 notional-hour rule.
2. **Opaque QR tokens** — the QR contains a random 256-bit token only. Tier and discount are resolved server-side on scan. Forgery-proof and revocable.
3. **Mutual exclusion of membership/referral** — resolved as D1.

---

## Locked pricing algorithm

Reference implementation order for `packages/pricing`. This is the contract both apps compile against.

```
INPUT: opened_at, closed_at, resource_type,
       member? | referral?  (never both — D1),
       rate_bands[], happy_hours[], rules

1. billable_period = [opened_at, max(closed_at, opened_at + 60min)]      # D3
   duration rounded up to whole minutes

2. boundaries = all rate-band and happy-hour edges within billable_period,
   evaluated in Australia/Sydney local time                              # D5
   segments = split(billable_period, boundaries)

3. for each segment:
     base_rate  = matching rate_band.price_per_hour
     rate       = happy_hour applies ? apply(happy_hour, base_rate) : base_rate
     amount    += segment_minutes × rate / 60
   → subtotal                                                            # D2

4. customer_pct = first_entered(membership.pct, referral.pct) or 0       # D1
   total = subtotal × (1 − customer_pct)                                 # D2

5. total = max(total, subtotal × (1 − max_discount_cap))                 # D2 ⚠️ pending

6. gst = total / 11        # GST-inclusive pricing                        # D4

7. emit explanation[]      # human-readable, printed on every receipt
                           # and shown on every booking confirmation
```

Step 7 is not decorative. A per-segment breakdown on the receipt is the difference between a billing dispute taking ten seconds and taking ten minutes.

---

## Still open

Not blocking Phase 1 unless marked 🔴.

| # | Question | Impact |
|---|---|---|
| Q3 | Max discount cap — yes/no, and what floor? | 🔴 Engine safety rail; recommend 50% |
| Q4 | Does the *referrer* earn anything, or only the new customer? | 🔴 Adds a rewards table if yes |
| Q6 | Do billiard tables and driving sims have different rates? Different happy hours? | 🔴 Schema supports both; need launch values |
| Q10 | Membership: auto-renew subscription, or one-time with expiry? | 🔴 See D4 — recommend one-time |
| Q18 | Exactly how many driving simulators? | 🔴 Seed data |
| Q14 | Opening hours — same every day? | 🔴 Rate bands + booking availability |
| Q8 | Do members get earlier/extended booking access? | Booking rules |
| Q9 | Which card terminal (Tyro / Zeller / Square / bank)? | Possible Phase 8 integration |
| Q11 | USB QR scanner, or camera scanning? | POS input handling |
| Q12 | Offline tolerance — is 4G failover acceptable? | POS architecture |
| Q16 | Refund / cancellation policy for online bookings? | Booking flow + T&Cs |
| Q17 | How far ahead can customers book? Max session length? | Booking rules |
| Q19 | Guest checkout only, or customer accounts? | Auth scope |
| Q21 | Walk-in waitlist needed? | Phase 8 |
| Q22 | How many staff accounts? | Trivial |
| Q23 | Existing branding / design assets? | UI work |

---

## Next action

The six 🔴 items above (Q3, Q4, Q6, Q10, Q18, Q14) are what stand between here and starting Phase 1 — they determine the schema and the seed data. Everything else can be answered while foundations are being built.
