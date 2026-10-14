-- Unlink the old Stripe account before switching to a new one (2026-10-13).
-- Run ONCE in Supabase → SQL Editor on the hosted project, BEFORE "Sync with Stripe" on the new account.
-- Only safe because the old account held sandbox (test) data and no real paying members (owner, 2026-10-13).
-- Not a migration: it changes data, not the schema, and must never run again on its own.

begin;

-- 1. Memberships billed by the old account were tests: end them, so nobody keeps a free membership.
update public.members
   set status = 'ended', ended_at = now(), pending_tier_id = null
 where stripe_subscription_id is not null and status <> 'ended';
update public.members set stripe_subscription_id = null where stripe_subscription_id is not null;

-- 2. Customers forget their old Stripe customer; a new one is made on their next online membership.
update public.customers set stripe_customer_id = null where stripe_customer_id is not null;

-- 3. Tiers and their price history forget the old product and price; "Sync with Stripe" refills them.
update public.membership_tiers set stripe_product_id = null, stripe_price_id = null
 where stripe_product_id is not null or stripe_price_id is not null;
update public.tier_prices set stripe_price_id = null where stripe_price_id is not null;

commit;

-- 4. What's left to know about: upcoming bookings paid on the old account. Refunding them would
--    ask the new account about a payment it never took, so cancel these from the back office with
--    a refund of $0.00 and a reason (e.g. "Sandbox test").
select b.ref, lower(b.period) as starts_at, b.total_cents
  from public.bookings b
  join public.payments p on p.booking_id = b.id
 where p.method = 'stripe' and b.status = 'confirmed' and lower(b.period) > now()
 order by lower(b.period);
