# Membership

## 1. Tiers

| Tier | Discount | Monthly (incl. GST) | Free play / month | Balance cap |
|---|---|---|---|---|
| Silver | 5% | $100 | 60 min | 600 min |
| Gold | 10% | $200 | 60 min | 600 min |
| Diamond | 15% | $300 | 60 min | 600 min |

All values are editable. Benefits are the discount and free play. There are **no booking privileges**: same 7-day window, same cutoff.

## 2. Stripe Billing setup

- **Per tier:** one Stripe Product, plus one monthly recurring AUD Price with tax behaviour **inclusive**.
- **Checkout Session** in `subscription` mode, used for both online and POS sign-ups.
- **Customer Portal:** members can update their card, view invoices and cancel. Cancellation is set to **at period end**. Plan switching is **disabled** in the portal; tier changes go through our app (§5).
- **Smart Retries** on, with Stripe's failed-payment emails on. After retries fail, Stripe **cancels the subscription**.
- **Invoices:** show business name and ABN, so each charge is a valid Tax Invoice (every tier is over $82.50).

## 3. State machine

```
pending ──checkout.session.completed──▶ active
active ──invoice.payment_failed──▶ past_due
past_due ──invoice.paid──▶ active
active ──customer.subscription.updated (cancel_at_period_end=true)──▶ cancelling
cancelling ──customer.subscription.updated (cancel_at_period_end=false)──▶ active
active | past_due | cancelling ──customer.subscription.deleted──▶ ended
ended ──new checkout within 30 days──▶ active   (balance restored — §4)
```

| Status | Discount | Use balance | QR at POS shows |
|---|---|---|---|
| pending | ❌ | ❌ | "Payment not completed" |
| active | ✅ | ✅ | ✅ name, tier, balance |
| past_due | ❌ | ❌ (frozen) | "Inactive — payment failed" |
| cancelling | ✅ until period end | ✅ | ✅ + "Ends {date}" |
| ended | ❌ | ❌ (frozen 30 days, then forfeited) | "Membership ended" |

## 4. Free-play balance

- **Ledger:** `member_balance_ledger`. Balance = sum of entries.
- **Grant:** on every `invoice.paid` for the subscription (first payment included). The allowance for that month is:
  ```
  grant = max(0, min(tier.monthly_free_minutes, tier.max_balance_minutes − balance))
  ```
  - It's idempotent: `stripe_invoice_id` is unique.
  - If the grant works out to 0 (already at the cap), no ledger row is written. The invoice counts as processed through its `stripe_events` row.
  - If `pending_tier_id` is set, the new tier is applied **before** the grant is calculated.
- **Use:** at booking payment (online) or at session close (POS).
  - The member chooses minutes, up to `min(balance, billed minutes)`.
  - Free minutes cover the **first** minutes of the session.
  - Written under a row lock on the member.
- **Return:** a customer cancellation ≥ 24h before start, or a venue cancellation at any time, returns the minutes used. A return may exceed the cap.
- **Adjust:** superadmin only, ± minutes with a reason. It is audited and may exceed the cap.
- **Forfeit:** a daily job finds members `ended` for more than `balance_forfeit_days` (30) with balance > 0 and writes `forfeit −balance`.
- **Rejoin within 30 days:** the existing member record is reactivated (same `member_no`, balance intact). After 30 days a rejoin keeps the same record, but the balance is 0.

## 5. Tier changes and cancellation

- **Upgrade/downgrade** (member account page, POS or back office):
  - On Stripe, update the subscription item price with `proration_behavior: none`, so the next invoice is at the new price.
  - Locally, set `pending_tier_id`. Until the next `invoice.paid`, the current tier's discount and allowance remain.
  - On `invoice.paid`, set `tier_id = pending_tier_id`, clear the pending tier, then grant.
- **Cancel:** set `cancel_at_period_end = true`. Benefits continue until `current_period_end`, then the `customer.subscription.deleted` event moves the member to `ended`.
- **Tier price change by the admin:** see [back-office.md](./back-office.md#tier-price-change-flow). Existing members pay the new price from their next renewal and are emailed.

## 6. Identification

- **Online:** member login with **email + password** (Supabase Auth), with "Forgot password".
- **In venue:** a **member QR** containing `rg:m:<token>`.
  - The token is 32 random bytes, base64url. Only its sha256 is stored.
  - It is shown on the member account page and in the welcome email. No physical cards at launch.
  - **Reissue** (member or superadmin) generates a new token and the old one stops working immediately.
- **POS fallback:** search the member by phone or email.

## 7. Webhooks handled by the API (`POST /webhooks/stripe`)

- The signature is verified.
- **Idempotency:** the event id is inserted into `stripe_events` first. A duplicate returns 200 and does nothing.
- Events are processed in a transaction. **Out-of-order safety:** state is re-read from the Stripe subscription object rather than trusting event order.

| Event | Action |
|---|---|
| `checkout.session.completed` (mode=subscription) | link customer + subscription, `active`, issue QR, send welcome email |
| `checkout.session.completed` (mode=payment) | confirm booking (see booking-site.md) |
| `checkout.session.expired` | expire booking hold |
| `invoice.paid` | apply pending tier → `active` → set `current_period_end` → grant minutes |
| `invoice.payment_failed` | `past_due` |
| `customer.subscription.updated` | sync `cancel_at_period_end` → `cancelling`/`active`, sync period end |
| `customer.subscription.deleted` | `ended`, `ended_at = now()` |
| `charge.refunded` | reconcile refund rows for Stripe-initiated refunds |

## 8. Emails

- Welcome (set password + QR)
- Payment failed (in addition to Stripe's email: explains that benefits are paused)
- Membership ending / ended
- Price change notice
- QR reissued
