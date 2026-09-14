# Back Office (inside the POS app, superadmin only)

**Every save** is validated by the API with the `packages/pricing` validators, then written together with an `audit_log` row (before/after):
- **Config tables** (venue settings, opening hours, resource types, resources, rate bands, happy hours, tiers, tier prices, referral codes) are audited by a **database trigger in the same transaction**. The API sends the operator as `x-rg-actor` and an optional reason as `x-rg-reason-b64`. An update that changes nothing, or only bumps a referral code's use count, is not audited.
- **Member, refund and price actions** are single-transaction database functions that write their own audit rows.

The back office lives in the POS app under `/admin` and needs a superadmin operator. Retired rates and happy hours are hidden unless "Show retired" is on.

**Every price field** is labelled **"incl. GST"** and shows `GST $x.xx` (price ÷ 11) beside it.

## Screens

| Screen | Capabilities |
|---|---|
| **Resources** | Add/rename/deactivate resource types and resources. Per type: base hourly rate, minimum minutes. |
| **Rate bands** | Optional day/time overrides per resource type. Overlaps are rejected. |
| **Happy hours** | Name, resource types (or all), days, start/end, % off, on/off. Overlaps on shared types/days are rejected. |
| **Opening hours** | Per day: open/close or closed. |
| **Booking rules** | Booking window days, online cutoff minutes, no-show hold, hold TTL, walk-in last-open minutes. |
| **Membership tiers** | Name, discount %, monthly price, monthly free minutes, balance cap. Price change flow below. |
| **Members** | Search; view tier, status, period end and balance ledger. Actions: manual balance adjustment (±minutes, reason), reissue QR (revokes old; the new code is shown once for printing), **add a complimentary member** (no billing, reason required, optional end date). Tier change and cancel-at-period-end arrive with Stripe (Phase 5). |
| **Referral codes** | Generate (auto 6-char) or bulk generate N. Fields: type (% or $), value, max uses, optional expiry. Live usage `uses_count / max_uses`. Deactivate. Redemption list. |
| **Staff** | Add cashier/superadmin, set/reset PIN, deactivate. A superadmin can't deactivate themselves if they are the last active superadmin. |
| **Business details** | Business name, ABN (shown on receipts / tax invoices), variance threshold. |
| **Sales** | A day's closed and voided sessions: receipt reprint, **partial refund** (cash/card, reason, needs an open till), void (full refund of what's left, free minutes returned). |
| **Bookings** | Search, view, cancel with refund (policy amount pre-filled, override allowed with reason). Arrives with the booking site (Phase 6). |
| **Shifts** | List, flagged shifts, shift report. |
| **Reports** | See below. |
| **Audit log** | Filter by actor, entity, action, date. Read-only. |

## Tier price change flow

1. The superadmin enters the new monthly price and confirms. The screen shows: "N active members will pay $X from their next renewal. They will be emailed."
2. The API creates a new Stripe Price, stores it in `tier_prices` and sets it as the tier's current price.
3. For each active/cancelling subscription on the tier, the API updates the subscription item to the new price with `proration_behavior: none`. This is a batched job that is safe to re-run. *(Until Stripe is connected, the local price and `tier_prices` history are updated and the API returns `stripeSyncPending: true`.)*
4. A **price change email** goes to each affected member, stating the new price and the renewal date it starts from.
5. New sign-ups use the new price immediately.

## Reports (Phase 7)

**Filters:** date range, resource type, resource. **Output:** on screen, plus CSV export.

**Revenue**
- revenue by day, resource type and resource
- tender split
- refunds

**Discounts**
- discounts by type: happy hour, membership (per tier), referral (per code), override

**Usage**
- utilisation %: billed minutes ÷ open minutes, per resource
- bookings: count, no-show rate, cancellations and refund amounts

**Membership**
- active members per tier, new, cancelled, past due
- monthly recurring revenue

**Free play**
- minutes granted / used / forfeited
- **outstanding balance liability** (total minutes held × average rate)

**Staff**
- shift summaries and variances
