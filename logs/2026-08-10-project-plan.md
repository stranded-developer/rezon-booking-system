# Rezon — Booking System + POS: Initial Planning Log

**Date:** 2026-08-10
**Status:** Planning / pre-build. Nothing implemented yet.
**Purpose:** Capture scope, stack decisions, open questions, and build order before writing code.

---

## 1. What we're building

A gaming hall operations platform, two web apps sharing one backend and one database.

**Venue assets (time-billed):**
- 2 × billiard tables
- N × driving simulator rigs (count TBD)

**App A — Booking site** (public subdomain, e.g. `book.rezon.xxx`)
- Public timetable / availability view
- Customer picks resource + time slot + duration
- Discounts apply (happy hour, membership, referral)
- Pays in full at time of booking via payment gateway
- Email confirmation

**App B — POS / back office** (private subdomain, e.g. `pos.rezon.xxx`)
- Login required. Two roles: **Admin** and **Cashier**
- **Cashier:** open/close tables, view live session timers, apply membership (QR scan) or referral code, take payment on the venue's own card terminal, print/email receipt
- **Admin:** everything cashier can do, plus edit rates, happy-hour windows, discount rules, membership tiers, issue/limit referral codes, view reports, void/refund
- **No online payment gateway needed in POS** — payment is taken on the venue's existing physical terminal; POS just records the tender

**Cross-cutting systems:**
- Membership (Silver / Gold / Platinum), QR-card based, recurring annual
- Happy hour (time-window based rate discounts)
- Referral codes (limited-use, expiring)
- Discount stacking engine (shared by both apps — single source of truth)
- Email notifications
- Audit log + reporting

---

## 2. Discount stacking rules (as specified)

| Combination | Stacks? |
|---|---|
| Happy hour + Membership | ✅ Yes |
| Happy hour + Referral | ✅ Yes |
| Membership + Referral | ❌ No |
| Happy hour + Membership + Referral | Partial — happy hour applies, then only one of membership/referral |

All of the above must be **editable from the back office**, not hardcoded. That means the rule set itself is data, and the engine reads it.

**Unresolved sub-questions — see §9 Q1–Q4.** Specifically: what happens when a customer presents *both* a membership and a referral code, and whether stacked discounts are additive or multiplicative.

---

## 3. Stack decisions & rationale

### Database: **Supabase (Postgres)** — recommended over Firebase ✅

This is not a close call. Reasons:

1. **The data is relational.** Bookings ↔ resources ↔ sessions ↔ rate plans ↔ discounts ↔ transactions ↔ members. Firestore would force denormalisation and you'd hand-maintain consistency.
2. **Double-booking prevention.** Postgres can enforce non-overlapping bookings *at the database level* with an exclusion constraint:
   ```sql
   EXCLUDE USING gist (resource_id WITH =, period WITH &&)
   ```
   This makes it structurally impossible to double-book, even under a race. Firestore has no equivalent — you'd be writing transaction logic and hoping.
3. **Money needs transactions.** Closing a table = compute charge + apply discounts + decrement referral use count + write payment + write audit row. That's one atomic transaction or it's a bug.
4. **Reporting.** Revenue by day/resource/discount type is a SQL `GROUP BY`. In Firestore it's a pre-aggregation pipeline you have to build and maintain.
5. Supabase also gives us Auth, Realtime, Storage, and row-level security in the same box.

Firebase would be the better pick if this were chat-like, offline-first, or schemaless. It isn't.

### Frontend: **Next.js (App Router)** for both apps ✅

Over plain React/Vite because:
- Booking site benefits from SSR/SSG for the public timetable (fast first paint, indexable)
- Route handlers give us webhook endpoints (Stripe) without extra infrastructure
- Server components let us keep pricing logic server-side so discount rules never ship to the browser
- Deploys to Vercel with zero config

POS is app-like and could be a SPA, but using Next.js for both means one framework, shared UI package, shared tooling.

### Backend: **Node + TypeScript** — recommended over Go ✅

- Go's advantages (raw throughput, concurrency) are irrelevant at this scale — a handful of resources, tens of transactions a day
- TypeScript end-to-end means the **pricing engine is one package imported by both frontends and the API** — no reimplementation drift, which is the single biggest correctness risk in this project
- Faster to build, easier to hand over

Suggested framework: **Hono** (light, fast, deploys anywhere including Vercel/edge) or **NestJS** if you want more structure and built-in DI. Recommendation: Hono — NestJS is overkill here.

### Repo layout: **Monorepo (Turborepo + pnpm)** ✅ — matches your instinct

```
rezon/
├─ apps/
│  ├─ booking/          # Next.js — public booking site
│  ├─ pos/              # Next.js — POS + back office
│  └─ api/              # Hono — REST API, owns all writes
├─ packages/
│  ├─ pricing/          # ⭐ pure discount/rate engine, heavily unit-tested
│  ├─ db/               # schema, migrations, typed client
│  ├─ types/            # shared DTOs
│  ├─ ui/               # shared components (shadcn/ui)
│  └─ config/           # eslint/tsconfig/tailwind presets
└─ supabase/            # migrations, RLS policies, seed data
```

Separate `apps/api` (rather than putting logic in Next.js route handlers) is the right call for your stated reason — future additions. It also means a future mobile app, kiosk, or customer-display screen plugs into the same API.

**Architectural rule:** frontends never write pricing-relevant data directly to Supabase. All money-touching writes go through `apps/api`, which is the only thing holding the service-role key. RLS is defence-in-depth on top, not the primary control.

### Hosting: **Vercel** ✅ — still the right answer

- `apps/booking` → Vercel project → `book.rezon.xxx`
- `apps/pos` → Vercel project → `pos.rezon.xxx`
- `apps/api` → Vercel project → `api.rezon.xxx`

Turborepo + Vercel handles per-app deploys from one repo natively. Two caveats:
- Use Supabase's **Supavisor** pooler in transaction mode for serverless DB connections
- If we later need long-running processes or websockets we'd move `apps/api` to Fly.io/Railway. Not needed at launch.

---

## 4. Payments (Australia)

### Online (booking site): **Stripe** — recommended ✅

Yes, Stripe is the most common and has by far the best developer experience in AU. It covers everything we need:
- Cards, Apple Pay, Google Pay, Link
- **Stripe Billing** for recurring memberships (annual)
- **BECS Direct Debit** and PayTo for AU bank-account payments if we want cheaper recurring
- Hosted Checkout → we never touch card data → PCI scope drops to SAQ-A (the easy one)
- Refunds via API for cancellations

**Australian alternatives, for the record:**

| Provider | Notes |
|---|---|
| **Square** | Strong in AU hospitality. Compelling *if* you want the same vendor for the physical terminal and online. Weaker API than Stripe. |
| **Tyro** | AU-only, very popular in hospitality/venues, competitive EFTPOS rates, integrates with many POS systems. Terminal-first, weak for online. |
| **Zeller** | AU, growing fast, good terminal hardware, cheaper than the banks. Online offering is younger. |
| **Airwallex** | AU-founded, good rates, better for multi-currency. Less common for small venues. |
| **Pin Payments** | AU, simple, but smaller ecosystem. |

**Recommendation:** Stripe for online. It's a solved problem and the membership subscription piece alone justifies it.

### In-venue (POS): no gateway integration at launch

As you said — payment happens on the venue's own terminal. POS just records tender type (card / cash / EFTPOS ref) and closes the sale. Simple, and it works.

**But flag this:** if the physical terminal supports an integration API (Tyro, Zeller and Square all do, and Stripe Terminal is available in AU with the BBPOS WisePOS E), we can push the amount to the terminal so the cashier can't mistype it. That eliminates a whole class of nightly-reconciliation pain. Worth doing in Phase 2 if the hardware supports it. → **Q9**

### Recurring memberships — is it hard? **No.**

Stripe Billing does the heavy lifting: create a Product + annual Price per tier, subscribe the customer, listen to webhooks. Roughly:

- `checkout.session.completed` → activate membership, issue QR
- `invoice.paid` → extend validity 1 year
- `invoice.payment_failed` → enter grace period, email customer
- `customer.subscription.deleted` → deactivate

The genuinely fiddly parts are the *business* edges, not the code: dunning/grace periods, proration on tier upgrades, and what a lapsed member sees at the counter. Budget time for those, not for the Stripe integration.

**Design note:** annual "1 year validity" can be either an auto-renewing subscription (Stripe Billing) or a one-time purchase with an expiry date. The second is much simpler — no failed-payment handling, no dunning — but no recurring revenue. → **Q10**

### Australian specifics we must handle
- **GST 10%** — display prices GST-inclusive (AU convention), show GST component on receipts
- Receipts over $82.50 must be a valid **Tax Invoice** with ABN
- **Card surcharging** is legal but RBA rules cap it at your actual cost of acceptance — if we surcharge, it must be configurable and accurate
- **Timezone/DST** — see §8

---

## 5. Core domain model (draft)

Generic resources rather than hardcoded "table"/"sim" — so adding a third billiard table or a VR rig is a database row, not a deploy.

```
resource_types      id, name ("Billiard", "Driving Sim"), min_minutes, increment_minutes
resources           id, type_id, label ("Table 1"), status, active
rate_plans          id, resource_type_id, name, effective_from/to
rate_bands          id, rate_plan_id, days_of_week[], start_time, end_time, price_per_hour
happy_hours         id, resource_type_id?, days_of_week[], start_time, end_time,
                    discount_type (pct|fixed|override_rate), value, active
membership_tiers    id, name (Silver|Gold|Platinum), discount_pct, perks_json,
                    annual_price, stripe_price_id
members             id, user_id, tier_id, member_no, qr_token, status,
                    valid_from, valid_until, stripe_customer_id, stripe_subscription_id
referral_codes      id, code, discount_type, value, max_uses, uses_count,
                    valid_from, valid_until, active, created_by
referral_redemptions id, code_id, session_id|booking_id, redeemed_at
discount_rules      id, key, config_json      -- ⭐ the stacking rules, admin-editable
bookings            id, resource_id, period (tstzrange), customer_email, status,
                    quoted_total, discounts_json, stripe_payment_intent_id
sessions            id, resource_id, booking_id?, opened_at, closed_at, opened_by,
                    closed_by, computed_total, discounts_json, status
payments            id, session_id|booking_id, method, amount, gst_amount,
                    external_ref, taken_by
audit_log           id, actor_id, action, entity, before_json, after_json, at
staff               id, email, role (admin|cashier), pin_hash, active
```

Key constraints:
- `EXCLUDE USING gist (resource_id WITH =, period WITH &&)` on `bookings` → double-booking impossible
- Partial unique index on `sessions` → one open session per resource at a time
- `referral_codes.uses_count` incremented under row lock, with `CHECK (uses_count <= max_uses)`

---

## 6. The pricing engine (`packages/pricing`) — most important component

A **pure function**, no I/O, exhaustively unit-tested:

```
price(input: {
  resourceType, startAt, endAt,
  member?: { tier, status },
  referral?: { code, discount },
  rules: DiscountRules,      // loaded from DB
  rateBands: RateBand[],
  happyHours: HappyHour[]
}) → {
  lineItems[], subtotal, discountsApplied[], total, gst, explanation[]
}
```

Both the booking site (quote before payment) and POS (charge on close) call the identical function. If this ever forks into two implementations, we will have a bug that costs real money.

### The non-obvious hard part: **sessions cross rate boundaries**

A customer opens Table 1 at 5:45pm and closes at 7:15pm, with happy hour 6:00–7:00pm.

That's **not one rate** — it's three segments:
- 5:45–6:00 → 15 min at standard rate
- 6:00–7:00 → 60 min at happy-hour rate
- 7:00–7:15 → 15 min at standard rate

The engine must **split the session at every rate-band and happy-hour boundary and price each segment**, then apply member/referral discounts on top of the result. Same applies to bookings that straddle boundaries, and to sessions crossing midnight.

Getting this wrong is the most likely source of "the POS charged me wrong" complaints. It should be built and tested *before* any UI.

`explanation[]` — a human-readable breakdown of how the total was reached — should be on every receipt and every booking confirmation. It's the difference between a customer dispute taking 10 seconds or 10 minutes.

---

## 7. QR / membership scanning

**Critical design rule: the QR contains an opaque token, never the tier or discount.**

If the QR encodes "GOLD-20%OFF", it can be forged with any QR generator. Instead:

```
QR payload → rzn:m:<random-256-bit-token>
POS scans  → API lookup → returns { member_no, name, tier, status, valid_until }
POS applies the discount from the server response
```

Tokens are revocable and rotatable (lost card → issue new token, old one dies). Same mechanism works for referral codes (`rzn:r:<code>`) and for booking check-in (`rzn:b:<ref>` — customer arrives, cashier scans, table opens against the booking; nice touch, low cost).

**Hardware:** a **USB barcode/QR scanner** is the pragmatic choice — it presents as a keyboard, so the POS just needs a focused input field. Zero drivers, zero permissions, works instantly, and cashiers already know how to use one. Camera scanning (`BarcodeDetector` API, or `zxing-js` fallback) as a backup for tablets. → **Q11**

Members get the QR by email as a PNG/PDF and via an "Add to Apple Wallet / Google Wallet" pass — worth doing eventually, it dramatically improves the odds a customer actually has it at the counter.

---

## 8. Things I'd flag as risky or underspecified

1. **Sessions crossing rate boundaries** — §6. Must be per-minute proration, not a flat rate.
2. **Membership + referral conflict** — the rule says they don't stack, but not what happens when a customer presents both. Silent failure here reads as a bug to the cashier.
3. **Stacking math** — 20% happy hour + 10% member = 30% off, or 0.8 × 0.9 = 28% off? Different answers. Also: do we want a maximum-total-discount cap so an admin can't accidentally configure 110% off?
4. **POS offline behaviour** — if the venue internet drops, a purely web-based POS stops working mid-service. Options: (a) accept the risk + 4G failover router (cheap, pragmatic, what most small venues do), (b) local-first PWA with IndexedDB queue and sync (significant extra complexity). I'd recommend (a) at launch. → **Q12**
5. **Overstay on bookings** — booking is 6–7pm but the customer is still playing at 7:20. Does POS auto-charge the extra 20 min at the walk-in rate? Does it block the next booking? Needs a defined policy.
6. **Booking → POS handoff** — the customer arrives with a paid booking; the cashier needs to see today's bookings, mark arrival, and open the table *without re-charging*. This flow is easy to forget and essential on day one.
7. **Cancellations & refunds** — full payment upfront means a refund policy is mandatory (e.g. free >24h, 50% 2–24h, none <2h). Needs to be in T&Cs and enforced in code.
8. **No-shows** — how long is a slot held before it's released for walk-ins?
9. **Timezone & DST** — store everything UTC, render in venue local time. Happy-hour windows are defined in *local* time. Sydney/Melbourne/Adelaide/Hobart observe DST; Brisbane/Perth/Darwin don't. Getting this wrong means happy hour silently shifts by an hour twice a year. → **Q13**
10. **Cash handling** — is there a cash drawer? If so we need shift open/close with a float, expected-vs-counted reconciliation, and per-shift reports. Common gap in v1 builds.
11. **Staff attribution on a shared terminal** — one POS device, multiple cashiers per shift. Recommend a shared device login plus a **4-digit staff PIN** to attribute each action. Cheap to build, invaluable when reconciling a discrepancy.
12. **Audit log** — every rate change, discount rule change, void, refund, and manual price override must be recorded with who/when/before/after. Non-negotiable for a cash-handling business.
13. **Manual override** — cashiers will need to discount or comp occasionally. Build it deliberately (reason required, admin-approval threshold, logged) rather than letting staff invent workarounds.

---

## 9. Open questions — please answer by number

> **Update 2026-08-10:** Q1, Q2, Q5, Q7, Q13, Q15, Q20 answered and locked in
> [Decisions Log #1](./2026-08-10-decisions-01.md). Resolved items marked ✅ below.
>
> **Update 2026-09-14:** Q3, Q4, Q6, Q10, Q14, Q18 answered and Q19 partly answered in
> [Decisions Log #2](./2026-09-14-decisions-02.md). It also supersedes D3 (now 15-min minimum) and D4 (now monthly Silver/Gold/Diamond),
> and adds member free-play balance, member login, and VR seats. **Project renamed to Racegrounds (D20).**
>
> **Update 2026-09-14 (2):** Q8, Q9, Q11, Q12, Q16, Q17, Q19, Q21, Q22, Q23 answered in
> [Decisions Log #3](./2026-09-14-decisions-03.md), along with launch values for tiers, VR rate, happy hour, and a proposed refund policy (D31).

### Business rules
1. ✅ **RESOLVED (D1)** — Mutually exclusive, first-entered wins. UI disables the other input once one is filled.
2. ✅ **RESOLVED (D2)** — Multiplicative.
3. ✅ **RESOLVED (D10)** — No cap. Percentages validated to 0–<100%.
4. ✅ **RESOLVED (D12)** — Referrer earns nothing. Admin-generated 6-char codes with discount % and max uses.
5. ✅ **RESOLVED (D3)** — 1-hour minimum, then per-minute (rounded up to whole minutes).
6. ✅ **RESOLVED (D18)** — Tables $30/hr, sims $60/hr, VR seats TBD. Happy hour values TBD.
7. ✅ **RESOLVED (D4)** — Silver 5%/$10, Gold 10%/$20, Platinum 15%/$30, GST-inclusive, admin-editable. Perks beyond the discount still TBD.
8. ✅ **RESOLVED (D30)** — No member privileges. Rolling 7-day booking window for everyone.

### Payments & operations
9. ✅ **RESOLVED (D32)** — CommBank. No integration; card total reconciled at shift close.
10. ✅ **RESOLVED (D17)** — Monthly auto-renewing subscription via Stripe Billing.
11. 🟡 **PARTLY RESOLVED (D32)** — Both supported; recommendation depends on POS device (TBD).
12. ✅ **RESOLVED (D32)** — 4G failover router; POS online-only.
13. ✅ **RESOLVED (D5)** — Sydney. `Australia/Sydney`, DST handling required.
14. ✅ **RESOLVED (D19)** — 10am–9pm every day, editable.
15. ✅ **RESOLVED (D7)** — Cash accepted. Shift open/close + drawer reconciliation in scope for Phase 3.
16. 🟡 **PROPOSED (D31)** — 100% ≥24h, 50% 2–24h, none <2h. Awaiting approval.
17. ✅ **RESOLVED (D30)** — 7 days ahead; no max session length.

### Scope & scale
18. ✅ **RESOLVED (D18)** — 6 sims, 2 billiard tables, 2 VR seats.
19. ✅ **RESOLVED (D14, D27, D30)** — Guests give name + email or phone; members log in online and use a QR at the POS.
20. ✅ **RESOLVED (D6)** — No F&B. POS sells time only.
21. ✅ **RESOLVED (D30)** — Not for now.
22. ✅ **RESOLVED (D33)** — 1 superadmin + 1 cashier at launch; each staff member has a named account + PIN.
23. ✅ **RESOLVED (D34)** — No logo yet; text wordmark placeholder. Name spelling to confirm.

---

## 10. Build order

Phases are ordered so that each one is independently useful and the riskiest logic is proven earliest.

### Phase 0 — Decisions & specs *(now)*
- Answer §9 questions
- Lock pricing rules, tiers, policies into a written spec
- Confirm domains, register Supabase + Stripe + Resend accounts
- **Exit:** no ambiguity left in the pricing rules

### Phase 1 — Foundations
- Turborepo + pnpm scaffold, three apps, shared packages, CI
- Supabase project, schema + migrations, RLS policies, seed data
- Staff auth (Supabase Auth) + admin/cashier RBAC + PIN attribution
- Vercel projects, subdomains, environment variables, preview deploys
- **Exit:** empty apps deployed and authenticating against real subdomains

### Phase 2 — Pricing engine ⭐
- `packages/pricing` as a pure, dependency-free function
- Rate bands, happy hour, membership, referral, stacking rules from config
- **Boundary-crossing proration** and midnight rollover
- Exhaustive unit tests including every stacking permutation and edge case
- **Exit:** given any session, we can prove the correct price. No UI yet.

### Phase 3 — POS MVP (highest operational value)
- Login, role gate, staff PIN
- Live floor view: resource tiles, open/close, running timers (client-side from `opened_at`, Supabase Realtime for cross-terminal sync)
- Close table → engine computes total → record tender → receipt (print + email)
- Manual override with reason + audit
- **Exit:** the venue could run a full day on this alone

### Phase 4 — Back office
- Rate plans & rate band editor
- Happy hour window editor
- **Discount stacking rule editor** (the rules-as-data requirement)
- Referral code CRUD with use limits, expiry, live usage counter
- Membership tier config
- Audit log viewer, basic daily reports
- **Exit:** admin can change any rule without a developer

### Phase 5 — Membership + QR
- Member records, tiers, number issuance, opaque QR tokens
- Stripe Billing annual subscription + webhook lifecycle (activate/renew/lapse)
- QR delivery by email; POS scan → lookup → auto-discount
- Expiry, grace period, renewal reminder emails
- **Exit:** a member can be sold, scanned, discounted, renewed, and lapsed

### Phase 6 — Booking site
- Public timetable / availability grid per resource
- Slot selection + live price quote (same engine) + discount code entry
- Slot hold with TTL during checkout (prevents two people paying for one slot)
- Stripe Checkout, full payment upfront
- Confirmation email + calendar invite + 24h reminder
- Cancellation & refund flow per policy
- **Booking → POS handoff:** today's bookings visible in POS, mark arrival, open table without re-charging
- **Exit:** a customer can book, pay, arrive, play, and leave with no manual steps

### Phase 7 — Hardening & launch
- Reporting: revenue by day/resource/discount, utilisation %, membership + referral performance, staff shift totals
- Load/edge testing: concurrent bookings, DST rollover, midnight sessions, referral race conditions
- Error monitoring (Sentry), uptime checks, DB backup verification
- Privacy policy, T&Cs, refund policy, GST/tax-invoice compliance
- Staff training + written runbook
- **Exit:** live

### Phase 8 — Post-launch backlog
Terminal integration · Apple/Google Wallet passes · SMS reminders · waitlist & walk-in queue · loyalty points · F&B module · customer-facing display screen · tournament/league bookings · Google Calendar sync

---

## 11. Summary of recommendations

| Question | Recommendation |
|---|---|
| Supabase or Firebase? | **Supabase (Postgres)** — relational data + money + DB-level double-booking prevention |
| Next.js or React? | **Next.js App Router** for both apps |
| Node or Go? | **Node + TypeScript** — shared pricing engine is worth more than Go's performance here |
| Framework for API? | **Hono** (NestJS if more structure is wanted) |
| Monorepo? | **Yes** — Turborepo + pnpm, separate `apps/api` as you suggested |
| Hosting? | **Vercel**, three projects from one repo, three subdomains |
| Payment gateway (AU)? | **Stripe** — most common, best DX, Billing covers recurring memberships |
| POS payments? | **No gateway** — record tender only; revisit terminal integration in Phase 8 |
| Recurring membership hard? | **No** — Stripe Billing + webhooks. The business edge cases cost more time than the code |
| Auth? | **Supabase Auth** — staff accounts + PIN attribution; guest checkout for customers |
| Email? | **Resend + React Email** (Postmark if deliverability becomes a concern) |
| Build first? | **Pricing engine, then POS** — POS is the daily operational core and can go live before the booking site |

---

## 12. Next action

Answer §9. Once the pricing rules and policies are locked, Phase 1 can start immediately — the schema depends almost entirely on questions 1–8.
