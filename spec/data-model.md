# Data Model — Supabase Postgres

Conventions:
- Primary keys are `uuid` unless noted.
- All instants are `timestamptz` (stored in UTC).
- Wall-clock times are `time`, local to `venue_settings.timezone`.
- Money is `integer` cents, and percentages are `integer` basis points.
- Every table has `created_at timestamptz default now()`. Mutable config tables also have `updated_at`.
- Soft-delete uses `active boolean`. Rows referenced by money records are never hard-deleted.

## Venue configuration

```
venue_settings            -- single row (id = 1)
  timezone                 text      'Australia/Sydney'
  business_name            text      null until provided
  abn                      text      null until provided
  booking_window_days      int       7
  online_cutoff_minutes    int       30
  no_show_hold_minutes     int       15
  hold_ttl_minutes         int       30     -- matches Stripe Checkout minimum expiry
  walkin_last_open_minutes int       15     -- no walk-in opens within 15 min of close
  cash_variance_threshold_cents int  2000
  balance_forfeit_days     int       30

opening_hours
  day_of_week   smallint  1..7 (ISO), unique
  open_time     time
  close_time    time      check (close_time > open_time)
  closed        boolean   default false
```

## Resources and rates

```
resource_types
  key            text unique     'billiard' | 'sim' | 'vr'
  name           text            'Billiard Table'
  base_rate_cents int  check ≥ 0
  min_minutes    int   check > 0
  sort, active

resources
  resource_type_id → resource_types
  label          text            'Table 1', unique per type
  sort, active

rate_bands                        -- optional overrides of base rate (none at launch)
  resource_type_id → resource_types
  days_of_week   smallint[]      values 1..7
  start_time, end_time           check (end_time > start_time)
  rate_cents     int check ≥ 0
  active

happy_hours
  name           text
  resource_type_ids uuid[] null   -- null = all types
  days_of_week   smallint[]
  start_time, end_time
  discount_bp    int check (discount_bp > 0 and discount_bp < 10000)
  active
```
Overlap rules for rate bands and happy hours are enforced by the API using `packages/pricing` validators. Array overlaps are awkward as DB constraints.

## People

```
staff
  auth_user_id   uuid unique → auth.users
  display_name   text
  role           text check in ('superadmin','cashier')
  pin_hash       text            -- scrypt (N=16384, r=8, p=1, 16-byte salt) of the 4-digit PIN
  pin_failed_count int, pin_locked_until timestamptz
  active

customers                          -- guests and members
  auth_user_id   uuid null unique → auth.users   -- only members have logins
  name           text
  email          citext null
  phone          text null
  check (email is not null or phone is not null)
  stripe_customer_id text null unique
```

## Membership

```
membership_tiers
  name                 text unique       'Silver' | 'Gold' | 'Diamond'
  discount_bp          int check 0 ≤ x < 10000
  monthly_price_cents  int check ≥ 0      -- incl. GST
  monthly_free_minutes int check ≥ 0
  max_balance_minutes  int check ≥ 0
  stripe_product_id    text
  stripe_price_id      text               -- current price; old prices kept in tier_prices
  sort, active

tier_prices                                -- history, one row per Stripe Price
  tier_id → membership_tiers
  amount_cents, stripe_price_id unique, effective_from timestamptz

members
  customer_id      → customers unique
  member_no        text unique            'RG-000123'
  tier_id          → membership_tiers
  pending_tier_id  → membership_tiers null  -- applied on next invoice.paid
  status           text check in ('pending','active','past_due','cancelling','ended')
  qr_token_hash    text unique            -- sha256 of the random token; token never stored
  current_period_end timestamptz null
  ended_at         timestamptz null
  stripe_subscription_id text unique null

member_balance_ledger
  member_id        → members
  delta_minutes    int  (≠ 0)
  kind             text check in ('grant','use','return','adjust','forfeit')
  booking_id       → bookings null
  session_id       → sessions null
  stripe_invoice_id text null unique       -- idempotent monthly grants
  actor_staff_id   → staff null
  reason           text null               -- required for 'adjust'
```
Balance = `sum(delta_minutes)` per member. Balance writes lock the member row (`select … for update`) to prevent double-spend.

## Referral codes

```
referral_codes
  code            citext unique  -- 6 chars from 23456789ABCDEFGHJKMNPQRSTUVWXYZ
  discount_type   text check in ('percent','fixed')
  discount_value  int            -- bp if percent (0<x<10000), cents if fixed (>0)
  max_uses        int check > 0
  uses_count      int default 0, check (uses_count <= max_uses)
  valid_until     timestamptz null
  active, created_by → staff

referral_redemptions
  code_id → referral_codes
  booking_id → bookings null, session_id → sessions null
  check (num_nonnulls(booking_id, session_id) = 1)
  discount_cents int
```

## Bookings and sessions

```
bookings
  ref              text unique       6-char, same alphabet as referral codes
  resource_id      → resources
  customer_id      → customers
  member_id        → members null
  period           tstzrange         [start, end)
  status           text check in ('held','confirmed','arrived','completed','cancelled','no_show','expired')
  hold_expires_at  timestamptz null
  free_minutes_used int default 0
  referral_code_id → referral_codes null
  pricing_snapshot jsonb             -- full engine output at time of payment
  total_cents, gst_cents
  stripe_checkout_session_id text unique null
  stripe_payment_intent_id   text unique null
  cancel_token_hash text             -- for the email cancel link
  cancelled_at, cancelled_by_staff_id, cancel_reason, refund_cents

  EXCLUDE USING gist (resource_id WITH =, period WITH &&)
    WHERE (status IN ('held','confirmed','arrived'))
```
Before creating a hold, the same transaction marks any `held` rows with `hold_expires_at < now()` as `expired`. A cron job isn't needed for correctness.

```
sessions
  resource_id      → resources
  booking_id       → bookings null
  kind             text check in ('walk_in','booking','overstay')
  opened_at, closed_at null
  opened_by, closed_by → staff
  status           text check in ('open','closed','voided')
  member_id → members null, referral_code_id → referral_codes null
  free_minutes_used int default 0
  pricing_snapshot jsonb, total_cents, gst_cents
  closed_in_shift_id → shifts null   -- the till open when it was closed (per-shift reporting)
  void_reason

  UNIQUE (resource_id) WHERE status = 'open'
```

## Money

```
shifts
  staff_id → staff
  opened_at, closed_at null
  opening_float_cents
  expected_cash_cents, counted_cash_cents, cash_variance_cents
  pos_card_total_cents, terminal_card_total_cents, card_variance_cents
  flagged boolean
  closed_by → staff                       -- staff_id = opened by
  UNIQUE ((true)) WHERE closed_at IS NULL  -- one open shift venue-wide (D46)

payments
  booking_id → bookings null, session_id → sessions null, member_id → members null
  method       text check in ('cash','card_terminal','stripe','free')
  amount_cents, gst_cents
  external_ref text null         -- terminal receipt no. / Stripe PI / invoice id
  receipt_no   bigint identity unique  -- sequential receipt / tax invoice number
  staff_id → staff null, shift_id → shifts null

refunds
  payment_id → payments
  amount_cents, reason
  stripe_refund_id text null unique
  staff_id → staff null, shift_id → shifts null

cash_movements
  shift_id → shifts
  kind  text check in ('sale','refund','paid_in','paid_out')
  amount_cents (signed), reason, payment_id null, refund_id null, staff_id

price_overrides
  session_id → sessions
  original_cents, new_cents, reason
  requested_by → staff, approved_by → staff
```

## Functions (service role only)

| Function | Purpose |
|---|---|
| `expire_stale_holds()` | Marks `held` bookings past `hold_expires_at` as `expired`. Returns the count. |
| `pos_open_shift`, `pos_cash_movement`, `pos_shift_totals`, `pos_close_shift` | Shared till: open with float, paid in/out with reason, expected cash/card totals, close with variances and flagging (refused while sessions are open). |
| `pos_open_walk_in`, `pos_arrive_booking`, `pos_mark_no_show` | Opening hours and last-open check, booked-now check, one open session per resource; check-in from 15 min before start; no-show after the hold. |
| `pos_close_session(session, staff, payload)` | One transaction: re-checks session/member/referral (row locks), increments referral use, tender rules, closes session, completes booking, ledger use, payment, cash movement, redemption, override, audit. |
| `pos_void_session` | Open walk-in: void. Closed: full refund of the remaining payment (cash-out movement for cash), return free minutes, void, audit. |
| `register_pin_attempt(staff_id, success, max_attempts, lock_minutes)` | Under a row lock: refuses when locked, resets on success, counts failures, locks for `lock_minutes` on the Nth failure. Returns `(accepted, locked_until, just_locked, failed_count)`. |

## Platform

```
stripe_events         id text PK (Stripe event id), type, payload jsonb, processed_at null
audit_log             actor_staff_id, approver_staff_id null, action, entity, entity_id,
                      before jsonb, after jsonb, reason, ip, created_at
                      -- insert-only: no UPDATE/DELETE grants
email_log             to, template, entity, entity_id, provider_id, status, created_at
```

## Security (RLS)

- **RLS is enabled on every table.** The API uses the service role and is the only writer of money and rules data.
- The **booking site** reads public config directly (`opening_hours`, `resource_types`, `resources`, `happy_hours`, active tier names/prices) through an anon-readable view. It does not read `rate_bands` internals beyond what quotes need, and quotes come from the API anyway.
- **Members** can read their own `customers`, `members`, `member_balance_ledger` and `bookings` rows (`auth.uid()` match).
- **Staff** read via the API only.

## Launch seed

| Table | Rows |
|---|---|
| `venue_settings` | timezone `Australia/Sydney`, defaults above |
| `opening_hours` | days 1–7, 10:00–21:00 |
| `resource_types` | billiard $30.00 / 15 min · sim $60.00 / 15 min · vr $50.00 / 15 min |
| `resources` | Table 1–2 · Sim 1–6 · VR 1–2 |
| `happy_hours` | "Weekday Happy Hour", all types, days 1–5, 10:00–15:00, 1000 bp |
| `membership_tiers` | Silver 500 bp $100.00 60 min cap 600 · Gold 1000 bp $200.00 60/600 · Diamond 1500 bp $300.00 60/600 |
| `staff` | 1 superadmin, 1 cashier (created via setup script, not committed credentials) |
