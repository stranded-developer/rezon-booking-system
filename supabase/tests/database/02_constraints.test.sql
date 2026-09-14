-- Business-critical constraints and triggers (spec/data-model.md).
begin;
select plan(48);

-- ── Fixtures ────────────────────────────────────────────────────────────────
insert into auth.users (id, email, aud, role) values
  ('00000000-0000-0000-0000-00000000a001', 'owner@test.local', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-00000000a002', 'cashier@test.local', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-00000000a003', 'member@test.local', 'authenticated', 'authenticated');

insert into staff (id, auth_user_id, display_name, role, pin_hash) values
  ('00000000-0000-0000-0000-00000000b001', '00000000-0000-0000-0000-00000000a001', 'Owner', 'superadmin', 'x'),
  ('00000000-0000-0000-0000-00000000b002', '00000000-0000-0000-0000-00000000a002', 'Cashier', 'cashier', 'x');

insert into customers (id, auth_user_id, name, email) values
  ('00000000-0000-0000-0000-00000000c003', '00000000-0000-0000-0000-00000000a003', 'Mem Ber', 'member@test.local'),
  ('00000000-0000-0000-0000-00000000c004', null, 'Guest', 'guest@test.local');

insert into members (id, customer_id, tier_id, status) values
  ('00000000-0000-0000-0000-00000000d003', '00000000-0000-0000-0000-00000000c003',
   (select id from membership_tiers where name = 'Gold'), 'active');

-- Private fixture resources so tests never collide with real sessions/bookings on seeded resources.
insert into resources (id, resource_type_id, label, sort) values
  ('00000000-0000-0000-0000-0000000aa001', (select id from resource_types where key = 'billiard'), 'pgTAP Table A', 900),
  ('00000000-0000-0000-0000-0000000aa002', (select id from resource_types where key = 'billiard'), 'pgTAP Table B', 901);

create temp table ids as
select
  '00000000-0000-0000-0000-0000000aa001'::uuid as table1,
  '00000000-0000-0000-0000-0000000aa002'::uuid as table2,
  '00000000-0000-0000-0000-00000000b001'::uuid as owner,
  '00000000-0000-0000-0000-00000000b002'::uuid as cashier,
  '00000000-0000-0000-0000-00000000c004'::uuid as guest,
  '00000000-0000-0000-0000-00000000c003'::uuid as member_customer,
  '00000000-0000-0000-0000-00000000d003'::uuid as member;
grant select on ids to public;

-- ── Bookings: no double-booking ─────────────────────────────────────────────
select lives_ok(
  $$ insert into bookings (id, resource_id, customer_id, period, status, hold_expires_at)
     select '00000000-0000-0000-0000-0000000e0001', table1, guest,
            '[2099-01-16 10:00+10, 2099-01-16 11:00+10)', 'held', now() + interval '30 min' from ids $$,
  'hold a 10:00–11:00 slot'
);

select throws_ok(
  $$ insert into bookings (resource_id, customer_id, period, status, hold_expires_at)
     select table1, guest, '[2099-01-16 10:59+10, 2099-01-16 11:30+10)', 'held', now() + interval '30 min' from ids $$,
  '23P01', null,
  'overlapping hold on the same resource is rejected (exclusion constraint)'
);

select lives_ok(
  $$ insert into bookings (resource_id, customer_id, period, status, hold_expires_at)
     select table1, guest, '[2099-01-16 11:00+10, 2099-01-16 12:00+10)', 'held', now() + interval '30 min' from ids $$,
  'adjacent slot 11:00–12:00 is allowed (half-open ranges)'
);

select lives_ok(
  $$ insert into bookings (resource_id, customer_id, period, status, hold_expires_at)
     select table2, guest, '[2099-01-16 10:00+10, 2099-01-16 11:00+10)', 'held', now() + interval '30 min' from ids $$,
  'same time on a different resource is allowed'
);

select throws_ok(
  $$ insert into bookings (resource_id, customer_id, period, status, hold_expires_at)
     select table1, guest, '[2099-01-16 13:00+10, 2099-01-16 13:00+10)', 'held', now() from ids $$,
  '23514', null,
  'empty booking period is rejected'
);

select throws_ok(
  $$ insert into bookings (resource_id, customer_id, period, status)
     select table1, guest, '[2099-01-16 14:00+10, 2099-01-16 15:00+10)', 'held' from ids $$,
  '23514', null,
  'a hold without an expiry is rejected'
);

select throws_ok(
  $$ insert into bookings (resource_id, customer_id, period, status)
     select table1, guest, '[2099-01-16 14:00+10, 2099-01-16 15:00+10)', 'confirmed' from ids $$,
  '23514', null,
  'a confirmed booking without price snapshot is rejected'
);

insert into referral_codes (id, discount_type, discount_value, max_uses)
values ('00000000-0000-0000-0000-000000000c00', 'percent', 1000, 1);

select throws_ok(
  $$ insert into bookings (resource_id, customer_id, member_id, referral_code_id, period, status, hold_expires_at)
     select table1, member_customer, member, '00000000-0000-0000-0000-000000000c00',
            '[2099-01-17 14:00+10, 2099-01-17 15:00+10)', 'held', now() + interval '30 min'
     from ids $$,
  '23514', null,
  'member + referral on one booking is rejected'
);

-- Stale holds
select lives_ok(
  $$ insert into bookings (id, resource_id, customer_id, period, status, hold_expires_at)
     select '00000000-0000-0000-0000-0000000e0002', table1, guest,
            '[2099-01-18 10:00+10, 2099-01-18 11:00+10)', 'held', now() - interval '1 min' from ids $$,
  'insert a hold that has already expired'
);
select throws_ok(
  $$ insert into bookings (resource_id, customer_id, period, status, hold_expires_at)
     select table1, guest, '[2099-01-18 10:30+10, 2099-01-18 11:30+10)', 'held', now() + interval '30 min' from ids $$,
  '23P01', null,
  'a stale hold still blocks until expired'
);
select ok(public.expire_stale_holds() >= 1, 'expire_stale_holds expires the stale hold (others may exist in a used database)');
select is((select status from bookings where id = '00000000-0000-0000-0000-0000000e0002'), 'expired', 'stale hold is now expired');
select lives_ok(
  $$ insert into bookings (resource_id, customer_id, period, status, hold_expires_at)
     select table1, guest, '[2099-01-18 10:30+10, 2099-01-18 11:30+10)', 'held', now() + interval '30 min' from ids $$,
  'the slot is bookable after expiring the stale hold'
);

-- Status transitions
select lives_ok(
  $$ update bookings set status = 'confirmed', total_cents = 3000, gst_cents = 273, pricing_snapshot = '{}'
     where id = '00000000-0000-0000-0000-0000000e0001' $$,
  'held → confirmed'
);
select throws_ok(
  $$ update bookings set status = 'held' where id = '00000000-0000-0000-0000-0000000e0001' $$,
  '23514', null,
  'confirmed → held is rejected'
);
select throws_ok(
  $$ update bookings set status = 'completed' where id = '00000000-0000-0000-0000-0000000e0001' $$,
  '23514', null,
  'confirmed → completed (skipping arrival) is rejected'
);
select lives_ok(
  $$ update bookings set status = 'cancelled', cancelled_at = now(), refund_cents = 3000
     where id = '00000000-0000-0000-0000-0000000e0001' $$,
  'confirmed → cancelled'
);
select lives_ok(
  $$ insert into bookings (resource_id, customer_id, period, status, hold_expires_at)
     select table1, guest, '[2099-01-16 10:00+10, 2099-01-16 11:00+10)', 'held', now() + interval '30 min' from ids $$,
  'a cancelled booking frees its slot'
);

-- ── Sessions ────────────────────────────────────────────────────────────────
select lives_ok(
  $$ insert into sessions (id, resource_id, kind, opened_at, opened_by)
     select '00000000-0000-0000-0000-0000000f0001', table2, 'walk_in', now() - interval '20 min', cashier from ids $$,
  'open a walk-in on fixture table B'
);
select throws_ok(
  $$ insert into sessions (resource_id, kind, opened_at, opened_by)
     select table2, 'walk_in', now(), cashier from ids $$,
  '23505', null,
  'a second open session on the same resource is rejected'
);
select throws_ok(
  $$ insert into sessions (resource_id, kind, opened_at, opened_by)
     select table1, 'booking', now(), cashier from ids $$,
  '23514', null,
  'a booking session without booking_id is rejected'
);
select throws_ok(
  $$ update sessions set status = 'closed' where id = '00000000-0000-0000-0000-0000000f0001' $$,
  '23514', null,
  'closing without total, closer and snapshot is rejected'
);
select lives_ok(
  $$ update sessions set status = 'closed', closed_at = now(), closed_by = (select cashier from ids),
       total_cents = 1000, gst_cents = 91, pricing_snapshot = '{}'
     where id = '00000000-0000-0000-0000-0000000f0001' $$,
  'close the session'
);
select throws_ok(
  $$ update sessions set total_cents = 1 where id = '00000000-0000-0000-0000-0000000f0001' $$,
  '23001', null,
  'a closed session total cannot be edited'
);
select lives_ok(
  $$ update sessions set status = 'voided', void_reason = 'test' where id = '00000000-0000-0000-0000-0000000f0001' $$,
  'a closed session can be voided'
);
select throws_ok(
  $$ update sessions set void_reason = 'changed' where id = '00000000-0000-0000-0000-0000000f0001' $$,
  '23001', null,
  'a voided session cannot be changed'
);

-- ── Referral codes ──────────────────────────────────────────────────────────
insert into referral_codes (id, discount_type, discount_value, max_uses)
values ('00000000-0000-0000-0000-000000000c01', 'fixed', 500, 2);

select matches(
  (select code::text from referral_codes where id = '00000000-0000-0000-0000-000000000c01'),
  '^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{6}$',
  'referral code auto-generated as 6 unambiguous characters'
);
select lives_ok(
  $$ update referral_codes set uses_count = 2 where id = '00000000-0000-0000-0000-000000000c01' $$,
  'uses up to max_uses allowed'
);
select throws_ok(
  $$ update referral_codes set uses_count = 3 where id = '00000000-0000-0000-0000-000000000c01' $$,
  '23514', null,
  'uses_count above max_uses is rejected'
);
select throws_ok(
  $$ insert into referral_codes (discount_type, discount_value, max_uses) values ('percent', 10000, 5) $$,
  '23514', null,
  'a 100% referral code is rejected'
);
select throws_ok(
  $$ insert into referral_codes (code, discount_type, discount_value, max_uses) values ('ABCDE0', 'fixed', 100, 5) $$,
  '23514', null,
  'a code with an ambiguous character is rejected'
);

-- ── Free-play ledger ────────────────────────────────────────────────────────
select lives_ok(
  $$ insert into member_balance_ledger (member_id, delta_minutes, kind, stripe_invoice_id)
     select member, 60, 'grant', 'in_test_1' from ids $$,
  'monthly grant of 60 minutes'
);
select throws_ok(
  $$ insert into member_balance_ledger (member_id, delta_minutes, kind, stripe_invoice_id)
     select member, 60, 'grant', 'in_test_1' from ids $$,
  '23505', null,
  'the same invoice cannot grant twice'
);
select lives_ok(
  $$ insert into member_balance_ledger (member_id, delta_minutes, kind, booking_id)
     select member, -45, 'use', '00000000-0000-0000-0000-0000000e0001' from ids $$,
  'use 45 minutes'
);
select is((select balance_minutes from member_balances where member_id = '00000000-0000-0000-0000-00000000d003'), 15, 'balance is 15 minutes');
select throws_ok(
  $$ insert into member_balance_ledger (member_id, delta_minutes, kind, booking_id)
     select member, -16, 'use', '00000000-0000-0000-0000-0000000e0001' from ids $$,
  '23514', null,
  'using more than the balance is rejected'
);
select throws_ok(
  $$ insert into member_balance_ledger (member_id, delta_minutes, kind) select member, 10, 'adjust' from ids $$,
  '23514', null,
  'a manual adjustment without actor and reason is rejected'
);
select throws_ok(
  $$ update member_balance_ledger set delta_minutes = 600 $$,
  '23001', null,
  'the ledger is append-only'
);

-- ── Money ───────────────────────────────────────────────────────────────────
select throws_ok(
  $$ insert into payments (session_id, method, amount_cents, gst_cents, staff_id)
     select '00000000-0000-0000-0000-0000000f0001', 'cash', 1000, 91, cashier from ids $$,
  '23514', null,
  'a cash payment without a shift is rejected'
);

insert into shifts (id, staff_id, opening_float_cents)
values ('00000000-0000-0000-0000-000000005001', '00000000-0000-0000-0000-00000000b002', 20000);
insert into payments (id, session_id, method, amount_cents, gst_cents, staff_id, shift_id)
values ('00000000-0000-0000-0000-000000009001', '00000000-0000-0000-0000-0000000f0001', 'cash', 1000, 91,
        '00000000-0000-0000-0000-00000000b002', '00000000-0000-0000-0000-000000005001');

select throws_ok(
  $$ update payments set amount_cents = 1 $$,
  '23001', null,
  'payments are append-only'
);
select lives_ok(
  $$ insert into refunds (payment_id, amount_cents, reason) values ('00000000-0000-0000-0000-000000009001', 600, 'partial') $$,
  'partial refund within the payment'
);
select throws_ok(
  $$ insert into refunds (payment_id, amount_cents, reason) values ('00000000-0000-0000-0000-000000009001', 401, 'too much') $$,
  '23514', null,
  'refunds cannot exceed the payment in total'
);
select throws_ok(
  $$ update shifts set closed_at = now(), closed_by = '00000000-0000-0000-0000-00000000b002', expected_cash_cents = 21000, counted_cash_cents = 20500,
       cash_variance_cents = 0, pos_card_total_cents = 0, terminal_card_total_cents = 0, card_variance_cents = 0
     where id = '00000000-0000-0000-0000-000000005001' $$,
  '23514', null,
  'closing a shift with an incorrect variance is rejected'
);
select lives_ok(
  $$ update shifts set closed_at = now(), closed_by = '00000000-0000-0000-0000-00000000b002', expected_cash_cents = 21000, counted_cash_cents = 20500,
       cash_variance_cents = -500, pos_card_total_cents = 0, terminal_card_total_cents = 0, card_variance_cents = 0
     where id = '00000000-0000-0000-0000-000000005001' $$,
  'close shift with correct variances'
);
select throws_ok(
  $$ update shifts set counted_cash_cents = 21000, cash_variance_cents = 0 where id = '00000000-0000-0000-0000-000000005001' $$,
  '23001', null,
  'a closed shift cannot be edited'
);

-- ── Staff and audit ─────────────────────────────────────────────────────────
-- Other superadmins may exist in a used local database; deactivate them inside this rolled-back transaction.
update staff set active = false
where role = 'superadmin' and active and id <> '00000000-0000-0000-0000-00000000b001';
select throws_ok(
  $$ update staff set active = false where id = '00000000-0000-0000-0000-00000000b001' $$,
  '23514', null,
  'the last active superadmin cannot be deactivated'
);
select is(
  (select member_no from members where id = '00000000-0000-0000-0000-00000000d003') ~ '^RG-[0-9]{6}$',
  true,
  'member number format RG-000000'
);
insert into audit_log (actor_staff_id, action, entity) values ('00000000-0000-0000-0000-00000000b001', 'test', 'test');
select throws_ok($$ delete from audit_log $$, '23001', null, 'the audit log is append-only');

select * from finish();
rollback;
