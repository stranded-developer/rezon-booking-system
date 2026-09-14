# Raceground — Decisions Log #4 — Final Answers Before Build

**Date:** 2026-09-14
**Supersedes:** D20 and D34 (name spelling). Resolves the "Still open" table in [Decisions Log #3](./03-2026-09-14-launch-values-policies-staff-hosting.md).
**Status:** Locked. The consolidated, current rules live in [`spec/`](../../spec/README.md). From here on, the spec is the source of truth and the logs are history.

---

## D35 — Name: Raceground

The venue, brand and project are **Raceground** (singular). This supersedes "Racegrounds" in D20.

| Item | Value |
|---|---|
| Package scope | `@raceground/*` |
| QR prefixes | `rg:m:` (member), `rg:r:` (referral), `rg:b:` (booking) |
| URLs (for now) | `raceground.vercel.app`, `raceground-pos.vercel.app`, `raceground-api.vercel.app` |

The GitHub repo and local folder are still named `rezon-booking-system`. They can be renamed later without affecting the code.

## D36 — Launch free-play allowance

**60 minutes per month for all three tiers** (Silver, Gold, Diamond). Editable per tier.

## D37 — Balance when payment fails or membership ends (developer recommendation, accepted)

| Membership state | Balance |
|---|---|
| `active` | Usable. Monthly grants happen on each `invoice.paid`. |
| `past_due` (payment failed) | **Frozen.** Not usable, no grants. Unfrozen automatically if the payment is recovered. |
| `ended` (subscription deleted) | **Frozen for 30 days.** Re-joining within 30 days restores it. After 30 days a scheduled job writes a `forfeit` ledger entry that brings the balance to 0. |

## D38 — Balance cap: 10 hours

- `membership_tiers.max_balance_minutes = 600` for all tiers at launch, editable.
- **Monthly grants never push the balance over the cap:** `grant = max(0, min(allowance, cap − balance))`. A member already at 600 minutes receives nothing that month.
- **Minutes returned from a cancelled booking** (D31, ≥24h) and **superadmin manual adjustments** may exceed the cap. They restore minutes the member already had, or are a deliberate, audited override.

## D39 — Refund, no-show and overstay policy approved

D31 is approved as written, including the 30-minute cutoff for online bookings.

## D40 — POS membership sale via on-screen Stripe Checkout QR approved

**Works in Sydney:** yes. Stripe supports Australian accounts in AUD, and Checkout handles subscriptions with Visa, Mastercard, Amex, Apple Pay and Google Pay on the customer's phone.

**Before taking real payments, Stripe needs:**
- an Australian business profile (legal name, ABN or sole-trader details)
- a bank account for payouts

Test mode needs none of this, so building is not blocked.

## D41 — Cancellation and tier changes

- **Cancelling:** benefits last until the end of the paid month. Uses Stripe `cancel_at_period_end = true`.
- **Upgrade/downgrade:** takes effect at the next renewal. There is no proration.
  - **Stripe side:** the subscription item's price is updated with `proration_behavior: none`.
  - **Our side:** the new tier is stored as `members.pending_tier_id` and applied when the next `invoice.paid` arrives, so the discount and allowance switch at the same moment the new price is charged.

## D42 — Happy hour applies to all three resource types

Billiard, driving sim and VR all share the launch happy hour: Mon–Fri 10:00–15:00, 10% off.

## D43 — GST display and price-change emails

- **All prices are GST-inclusive.** Every price field in the back office is labelled **"incl. GST"** and shows the GST component (price ÷ 11) next to it.
- **Price-change email:** yes. When a tier price changes, affected members get an email saying the new price and the renewal date it starts from.

## D44 — Manual price override

- **Cashier:** allowed only with **superadmin PIN approval** entered on the same POS screen.
- **Superadmin:** can override directly.
- A reason is always required, and every override is audited: who requested, who approved, and the before/after amounts.

## D45 — POS hardware

- **USB 2D QR scanner**, so the POS is assumed to run on a **laptop or desktop** in Chrome.
- Camera scanning is still built as a fallback.

---

## Not blocking the build (needed before go-live)

| Item | Needed for |
|---|---|
| Business/trading name + ABN | Stripe live mode, tax invoices on receipts and membership invoices |
| Stripe account (AU) | Test keys for Phase 5/6 development; live activation at launch |
| Supabase project | Hosted database (local development uses Docker) |
| Resend account + sending domain | Emails. `.vercel.app` can't be used as a sending domain, so the test sender is used until a custom domain exists. |
| GitHub repo access / Vercel project linking | CI and deploys |
