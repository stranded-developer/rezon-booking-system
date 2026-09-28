-- Sessions (D63): a booking is at least one 30-minute session, then 15-minute steps.
-- Walk-ins keep their own smaller minimum, and free play is spent the way the time is sold.
begin;
select plan(16);

-- These tests are about the booking and till rules, not about what hours the venue keeps.
-- Setting the hours here — and rolling them back with the rest of the transaction — keeps them
-- working whatever the owner sets in the back office (D73).
update public.opening_hours set open_time = '10:00', close_time = '21:00', closed = false;


insert into auth.users (id, email, aud, role) values ('00000000-0000-0000-0000-00000000a201', 'sess@test.local', 'authenticated', 'authenticated');
insert into public.staff (id, auth_user_id, display_name, role, pin_hash)
values ('00000000-0000-0000-0000-00000000b201', '00000000-0000-0000-0000-00000000a201', 'Sess', 'cashier', 'x');

insert into public.resources (id, resource_type_id, label, sort)
values ('00000000-0000-0000-0000-0000000cc201', (select id from public.resource_types where key = 'billiard'), 'pgTAP Session Table', 950);

insert into public.customers (id, name, email) values ('00000000-0000-0000-0000-00000000c201', 'Session Member', 'sessions@test.local');
insert into public.members (id, customer_id, tier_id, status, qr_token_hash)
values ('00000000-0000-0000-0000-00000000d201', '00000000-0000-0000-0000-00000000c201',
        (select id from public.membership_tiers where name = 'Gold'), 'active', 'hash-sessions');
insert into public.member_balance_ledger (member_id, delta_minutes, kind, stripe_invoice_id)
values ('00000000-0000-0000-0000-00000000d201', 240, 'grant', 'in_pgtap_sessions');

-- A booking payload on the session table, Wed 16 Jan 2030, with the length given in minutes.
create function pg_temp.book(p_minutes int, p_free int default 0, p_start text default '2030-01-16T10:00:00+11:00')
returns jsonb language sql as $$
  select jsonb_build_object(
    'resourceId', '00000000-0000-0000-0000-0000000cc201',
    'startsAt', p_start::timestamptz,
    'endsAt', p_start::timestamptz + make_interval(mins => p_minutes),
    'now', '2030-01-16T08:00:00+11:00'::timestamptz,
    'memberId', case when p_free > 0 then '00000000-0000-0000-0000-00000000d201' else null end,
    'customer', case when p_free > 0 then null else jsonb_build_object('name', 'Guest', 'email', 'guest-sessions@test.local') end,
    'freeMinutes', p_free,
    'totalCents', 0, 'gstCents', 0, 'pricing', '{}'::jsonb,
    'cancelTokenHash', md5(random()::text) || md5(random()::text)
  );
$$;

-- ── The venue setting ───────────────────────────────────────────────────────
select is((select session_minutes from public.venue_settings), 30, 'a session is 30 minutes');
select throws_ok(
  $$ update public.venue_settings set session_minutes = 20 $$, '23514', null,
  'a session has to be a whole number of quarter hours');

-- ── Bookings: one session minimum, then 15-minute steps ─────────────────────
select throws_like($$ select booking_hold(pg_temp.book(15)) $$,
  'RG:invalid_time:A booking is at least one 30-minute session', 'half a session cannot be booked');
select throws_like($$ select booking_hold(pg_temp.book(29)) $$,
  'RG:invalid_time:%', 'anything under a session is refused');
select throws_like($$ select booking_hold(pg_temp.book(40)) $$,
  'RG:invalid_time:Bookings start on the quarter hour and last in 15-minute steps',
  'lengths off the quarter hour are still refused');

select lives_ok($$ select booking_hold(pg_temp.book(30, 0, '2030-01-16T10:00:00+11:00')) $$, 'one session can be booked');
select lives_ok($$ select booking_hold(pg_temp.book(45, 0, '2030-01-16T11:00:00+11:00')) $$, 'a session and a half can be booked');
select lives_ok($$ select booking_hold(pg_temp.book(120, 0, '2030-01-16T13:00:00+11:00')) $$, 'longer bookings are unchanged');

-- ── Free play on a booking: a whole session, then 15-minute steps ───────────
select throws_like($$ select booking_hold(pg_temp.book(60, 15, '2030-01-16T15:00:00+11:00')) $$,
  'RG:invalid:Free play on a booking starts at 30 minutes, then 15-minute steps',
  'half a session of free play cannot be used on a booking');
select throws_like($$ select booking_hold(pg_temp.book(60, 40, '2030-01-16T15:00:00+11:00')) $$,
  'RG:invalid:Free play on a booking starts at 30 minutes, then 15-minute steps',
  'free play off the quarter hour is refused');
select lives_ok($$ select booking_hold(pg_temp.book(60, 30, '2030-01-16T15:00:00+11:00')) $$,
  'a whole session of free play can be used');
select lives_ok($$ select booking_hold(pg_temp.book(60, 45, '2030-01-16T16:30:00+11:00')) $$,
  'a session and a half of free play can be used');
select is((select balance_minutes from public.member_balances where member_id = '00000000-0000-0000-0000-00000000d201'),
  240 - 75, 'the minutes used come off the balance');

-- ── Walk-ins keep the smaller minimum ───────────────────────────────────────
select is((select min_minutes from public.resource_types where key = 'billiard'), 15,
  'a walk-in can still be half a session');

insert into public.shifts (staff_id, opening_float_cents) values ('00000000-0000-0000-0000-00000000b201', 10000);
insert into public.sessions (id, resource_id, kind, opened_at, opened_by, member_id)
values ('00000000-0000-0000-0000-0000000ee201', '00000000-0000-0000-0000-0000000cc201', 'walk_in',
        '2030-01-17T10:00:00+11:00', '00000000-0000-0000-0000-00000000b201', '00000000-0000-0000-0000-00000000d201');

select throws_like(
  $$ select pos_close_session('00000000-0000-0000-0000-0000000ee201', '00000000-0000-0000-0000-00000000b201',
       jsonb_build_object('closedAt', '2030-01-17T10:20:00+11:00', 'pricing', '{}'::jsonb, 'computedTotalCents', 0,
                          'totalCents', 0, 'gstCents', 0, 'method', 'free', 'freeMinutes', 20)) $$,
  'RG:invalid:Free play is used in 15-minute blocks', 'free play at the counter comes in 15-minute blocks');

select lives_ok(
  $$ select pos_close_session('00000000-0000-0000-0000-0000000ee201', '00000000-0000-0000-0000-00000000b201',
       jsonb_build_object('closedAt', '2030-01-17T10:15:00+11:00', 'pricing', '{}'::jsonb, 'computedTotalCents', 0,
                          'totalCents', 0, 'gstCents', 0, 'method', 'free', 'freeMinutes', 15)) $$,
  'half a session of free play can be used at the counter');

select * from finish();
rollback;
