# Phase 5a — Membership billing core (Stripe) ✅

**Date:** 2026-09-14

**Done**
- **Migration `…1100_membership`** (service role only, each one transaction):

  | Function | What it does |
  |---|---|
  | `membership_checkout_prepare` | new pending member, or reuse a pending/ended one (an ended member stays ended until paid, so the forfeit clock is kept); refuses active/cancelling/past-due; tier must have a Stripe price |
  | `membership_set_stripe_customer` | links the Stripe customer |
  | `membership_sync_subscription` | Stripe status → active / cancelling / past_due / ended; ignores stale subscriptions |
  | `membership_apply_invoice` | idempotent per invoice: pending tier → active → period end → stripe payment row with GST → monthly grant capped at the balance cap (no 0-minute rows) → audit |
  | `membership_payment_failed` | → past_due, only for the current subscription |
  | `membership_change_tier` | paid: at next renewal; complimentary: immediate |
  | `membership_issue_first_card` | counter can issue the first card only |
  | `membership_forfeit_balances` | the daily job |

- **API:**

  | Area | Contents |
  |---|---|
  | `stripe` SDK 22.6.2 | API version `2026-08-26.dahlia`. Import style, test clocks and webhook signing were checked against the real account first. |
  | `services/billing.ts` | Catalog sync: fixed product id `rg_tier_<uuid>`, price found by lookup key, AUD monthly `tax_behavior: inclusive`, idempotent. Counter checkout: Stripe customer reused per customer, Checkout in subscription mode with member metadata, 31-min expiry. `handleStripeEvent`: `stripe_events` idempotency; subscriptions always re-read from Stripe; invoice.paid / payment_failed / subscription created/updated/deleted / checkout.session.completed. Tier change sets the Stripe price with no proration, and reverts it if the DB step fails. Cancel/resume at period end with audit. Tier price change migrates billed members to the new price and emails them. First card. |
  | `services/email.ts` | console transport: `email_log` (once per template + entity) + print |
  | `routes/system.ts` | `POST /webhooks/stripe` (raw body signature check; 400 on bad signature; 500 lets Stripe retry), `POST /cron/forfeit` (Bearer `CRON_SECRET`, timing-safe), `/checkout/complete` and `/checkout/cancelled` pages |
  | Routes | `POST /pos/memberships/checkout`, `GET /pos/memberships/:id`, `POST /pos/memberships/:id/card`; `POST /admin/billing/sync-catalog`, `/admin/members/:id/tier|cancel|resume`; tier price change now syncs Stripe + migrates |
  | Env | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `CHECKOUT_SUCCESS_URL/CANCEL_URL`, `CRON_SECRET`, `EMAIL_TRANSPORT/FROM` |

**Verified**
1. **pgTAP `07_membership`: 45 tests.**
   - checkout validation; case-insensitive reuse; no duplicate customer
   - first invoice: 60 min, active, period end, payment with GST off the till; duplicate invoice has no effect
   - cannot start a second membership
   - cap: 60 + 40 = 100, then 0, with no zero rows
   - tier change at renewal → applied → cleared
   - failed payment for another subscription ignored → past_due → audited → recovered
   - sync: cancelling / active / stale subscription ignored / past_due / ended
   - no tier change after ended
   - re-join keeps the member and balance
   - forfeit: none within 30 days → forfeited → idempotent
   - complimentary member: immediate tier change; first card; second card refused
   - privileges
2. **Bug found by those tests:** the customer email lookup was **case-sensitive**. `citext`'s case-insensitive `=` isn't visible inside functions with an empty `search_path`, so "Mia@Test.Local" created a second customer. Fixed with an explicit lower-case compare. Checked that no other function compares citext this way.
3. **Stripe test mode, `stripe.integration.test.ts`: 4 tests, 77 s,** refuses to run against live mode.
   - **Catalog:** synced twice with the same price ids; AUD / monthly / inclusive / right amount / right product checked in Stripe.
   - **Counter checkout:** real Checkout session (subscription, client_reference_id, price, customer email); same email in upper case reuses the member.
   - **Security:** bad signature → 400, nothing stored.
   - **Full lifecycle on a Stripe test clock with genuine Stripe events, signed and delivered:**
     - first payment → active, 60 min, $100 recorded, welcome email
     - duplicate event → no effect
     - upgrade → Stripe item now the Diamond price, local tier unchanged
     - renewal → Diamond, 120 min, $300 charged
     - declining card → past_due, email, POS shows ineligible
     - card fixed and invoice paid → active, 180 min
     - cancel → cancelling (still eligible)
     - period end → ended, email, balance kept
     - cron: 401 without secret; nothing within 30 days; forfeited after
     - audit contains every lifecycle action
   - **DB evidence afterwards:** 3 real Stripe invoices (10000, 30000, 30000), ledger grant 60 ×3 then forfeit −180, 35 real events processed.
4. **Mutation check (billing):**

   | Injected bug | Result |
   |---|---|
   | Signature not verified | caught |
   | Tier change not sent to Stripe | caught |
   | Payment failure ignored | caught |
   | Cancel-at-period-end not synced | **survived** |

   The survivor was investigated: Stripe (this API version) also sets `cancel_at` to the period end when `cancel_at_period_end` is set, and the DB treats either as cancelling. This was confirmed with a real subscription, and removing both signals then fails the test.

**Owner setup needed before live billing** (Stripe dashboard):
- Smart Retries on, with "cancel the subscription" after the final retry
- business details + ABN on invoices
- live keys
- a webhook endpoint pointing at the deployed API
