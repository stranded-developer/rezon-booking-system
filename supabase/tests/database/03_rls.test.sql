-- Row-level security and column privileges for browser roles (spec/architecture.md §3).
begin;
select plan(24);

-- ── Fixtures (as postgres, bypassing RLS) ───────────────────────────────────
insert into auth.users (id, email, aud, role) values
  ('00000000-0000-0000-0000-00000000a001', 'owner@test.local', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-00000000a002', 'cashier@test.local', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-00000000a003', 'member@test.local', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-00000000a005', 'other-member@test.local', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-00000000a009', 'exstaff@test.local', 'authenticated', 'authenticated');

insert into staff (id, auth_user_id, display_name, role, pin_hash, active) values
  ('00000000-0000-0000-0000-00000000b001', '00000000-0000-0000-0000-00000000a001', 'Owner', 'superadmin', 'secret-hash', true),
  ('00000000-0000-0000-0000-00000000b002', '00000000-0000-0000-0000-00000000a002', 'Cashier', 'cashier', 'secret-hash', true),
  ('00000000-0000-0000-0000-00000000b009', '00000000-0000-0000-0000-00000000a009', 'Former', 'cashier', 'secret-hash', false);

insert into customers (id, auth_user_id, name, email) values
  ('00000000-0000-0000-0000-00000000c003', '00000000-0000-0000-0000-00000000a003', 'Member One', 'member@test.local'),
  ('00000000-0000-0000-0000-00000000c005', '00000000-0000-0000-0000-00000000a005', 'Member Two', 'other-member@test.local');

insert into members (id, customer_id, tier_id, status, qr_token_hash) values
  ('00000000-0000-0000-0000-00000000d003', '00000000-0000-0000-0000-00000000c003', (select id from membership_tiers where name = 'Gold'), 'active', 'hash-1'),
  ('00000000-0000-0000-0000-00000000d005', '00000000-0000-0000-0000-00000000c005', (select id from membership_tiers where name = 'Silver'), 'active', 'hash-2');

insert into resources (id, resource_type_id, label, sort) values
  ('00000000-0000-0000-0000-0000000bb001', (select id from resource_types where key = 'sim'), 'pgTAP Sim A', 900),
  ('00000000-0000-0000-0000-0000000bb002', (select id from resource_types where key = 'sim'), 'pgTAP Sim B', 901),
  ('00000000-0000-0000-0000-0000000bb003', (select id from resource_types where key = 'billiard'), 'pgTAP Table A', 900);

insert into bookings (resource_id, customer_id, member_id, period, status, hold_expires_at, cancel_token_hash) values
  ('00000000-0000-0000-0000-0000000bb001', '00000000-0000-0000-0000-00000000c003', '00000000-0000-0000-0000-00000000d003',
   '[2099-01-16 10:00+10, 2099-01-16 11:00+10)', 'held', now() + interval '30 min', 'tok-1'),
  ('00000000-0000-0000-0000-0000000bb002', '00000000-0000-0000-0000-00000000c005', '00000000-0000-0000-0000-00000000d005',
   '[2099-01-16 10:00+10, 2099-01-16 11:00+10)', 'held', now() + interval '30 min', 'tok-2');

insert into sessions (resource_id, kind, opened_at, opened_by)
values ('00000000-0000-0000-0000-0000000bb003', 'walk_in', now(), '00000000-0000-0000-0000-00000000b002');

insert into audit_log (actor_staff_id, action, entity) values ('00000000-0000-0000-0000-00000000b001', 'pgtap.rls_marker', 'test');

create or replace function pg_temp.act_as(user_id uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', user_id, 'role', 'authenticated')::text, true);
end;
$$;

-- ── Anonymous visitor (booking site) ────────────────────────────────────────
set local role anon;
select is((select count(*) from resource_types where key in ('billiard', 'sim', 'vr')), 3::bigint, 'anon reads resource types');
select is((select count(*) from opening_hours), 7::bigint, 'anon reads opening hours');
select is((select count(*) from membership_tiers where name in ('Silver', 'Gold', 'Diamond')), 3::bigint, 'anon reads tiers');
select throws_ok($$ select count(*) from customers $$, '42501', null, 'anon cannot read customers');
select throws_ok($$ select count(*) from bookings $$, '42501', null, 'anon cannot read bookings');
select throws_ok($$ select count(*) from venue_settings $$, '42501', null, 'anon cannot read venue settings');
select throws_ok(
  $$ insert into resource_types (key, name, base_rate_cents, min_minutes) values ('hack', 'Hack', 0, 1) $$,
  '42501', null, 'anon cannot write config'
);
select throws_ok($$ update membership_tiers set monthly_price_cents = 0 $$, '42501', null, 'anon cannot change tier prices');
reset role;

-- ── Signed-in member ────────────────────────────────────────────────────────
select pg_temp.act_as('00000000-0000-0000-0000-00000000a003');
select is((select count(*) from customers), 1::bigint, 'member sees only their own customer row');
select is((select count(*) from bookings), 1::bigint, 'member sees only their own bookings');
select is((select member_no from members) is not null, true, 'member reads their own membership (explicit columns)');
select is((select count(*) from members), 1::bigint, 'member sees only their own membership');
select throws_ok($$ select qr_token_hash from members $$, '42501', null, 'member cannot read QR token hashes');
select throws_ok($$ select cancel_token_hash from bookings $$, '42501', null, 'member cannot read cancel token hashes');
select is((select count(*) from sessions), 0::bigint, 'member sees no POS sessions');
select throws_ok(
  $$ insert into member_balance_ledger (member_id, delta_minutes, kind, stripe_invoice_id)
     values ('00000000-0000-0000-0000-00000000d003', 600, 'grant', 'in_fake') $$,
  '42501', null, 'member cannot grant themselves minutes'
);
reset role;

-- ── Cashier ─────────────────────────────────────────────────────────────────
select pg_temp.act_as('00000000-0000-0000-0000-00000000a002');
select is((select count(*) from sessions where resource_id = '00000000-0000-0000-0000-0000000bb003'), 1::bigint, 'cashier reads POS sessions');
select is((select count(*) from bookings where resource_id in ('00000000-0000-0000-0000-0000000bb001', '00000000-0000-0000-0000-0000000bb002')), 2::bigint, 'cashier reads all bookings (both customers)');
select is((select count(*) from staff where active and id in ('00000000-0000-0000-0000-00000000b001', '00000000-0000-0000-0000-00000000b002', '00000000-0000-0000-0000-00000000b009')), 2::bigint, 'cashier reads active staff names for the lock screen');
select throws_ok($$ select pin_hash from staff $$, '42501', null, 'cashier cannot read PIN hashes');
select is((select count(*) from audit_log), 0::bigint, 'cashier cannot read the audit log');
select throws_ok(
  $$ update sessions set status = 'voided', void_reason = 'x' $$,
  '42501', null, 'cashier cannot write sessions directly (API only)'
);
reset role;

-- ── Superadmin and deactivated staff ────────────────────────────────────────
select pg_temp.act_as('00000000-0000-0000-0000-00000000a001');
select is((select count(*) from audit_log where action = 'pgtap.rls_marker'), 1::bigint, 'superadmin reads the audit log');
reset role;

select pg_temp.act_as('00000000-0000-0000-0000-00000000a009');
select is((select count(*) from sessions), 0::bigint, 'deactivated staff lose read access');
reset role;

select * from finish();
rollback;
