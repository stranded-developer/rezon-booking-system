-- Experiences, tournaments and site events (D65–D70).
--   An experience sets its own fixed length; the session rules do not apply to it.
--   A tournament has a fixed number of spots, and holds waiting for payment count against them.
begin;
select plan(42);

-- These tests are about the booking and till rules, not about what hours the venue keeps.
-- Setting the hours here — and rolling them back with the rest of the transaction — keeps them
-- working whatever the owner sets in the back office (D73).
update public.opening_hours set open_time = '10:00', close_time = '21:00', closed = false;


insert into auth.users (id, email, aud, role) values ('00000000-0000-0000-0000-00000000a301', 'exp@test.local', 'authenticated', 'authenticated');
insert into public.staff (id, auth_user_id, display_name, role, pin_hash)
values ('00000000-0000-0000-0000-00000000b301', '00000000-0000-0000-0000-00000000a301', 'Exp', 'cashier', 'x');

-- Our own simulator and billiard table, so nothing here depends on other tests' rows.
insert into public.resources (id, resource_type_id, label, sort)
values ('00000000-0000-0000-0000-0000000cc301', (select id from public.resource_types where key = 'sim'), 'pgTAP Exp Sim', 951),
       ('00000000-0000-0000-0000-0000000cc302', (select id from public.resource_types where key = 'billiard'), 'pgTAP Exp Table', 952);

insert into public.customers (id, name, email) values ('00000000-0000-0000-0000-00000000c301', 'Exp Member', 'expmember@test.local');
insert into public.members (id, customer_id, tier_id, status, qr_token_hash)
values ('00000000-0000-0000-0000-00000000d301', '00000000-0000-0000-0000-00000000c301',
        (select id from public.membership_tiers where name = 'Gold'), 'active', 'hash-experiences');
insert into public.member_balance_ledger (member_id, delta_minutes, kind, stripe_invoice_id)
values ('00000000-0000-0000-0000-00000000d301', 240, 'grant', 'in_pgtap_experiences');

-- A booking payload for an experience on the simulator, Wed 16 Jan 2030.
create function pg_temp.book_exp(
  p_exp text, p_minutes int, p_free int default 0,
  p_start text default '2030-01-16T10:00:00+11:00',
  p_resource uuid default '00000000-0000-0000-0000-0000000cc301'
) returns jsonb language sql as $$
  select jsonb_build_object(
    'resourceId', p_resource,
    'experienceId', (select id from public.experiences where key = p_exp),
    'startsAt', p_start::timestamptz,
    'endsAt', p_start::timestamptz + make_interval(mins => p_minutes),
    'now', '2030-01-16T08:00:00+11:00'::timestamptz,
    'memberId', case when p_free > 0 then '00000000-0000-0000-0000-00000000d301' else null end,
    'customer', case when p_free > 0 then null else jsonb_build_object('name', 'Guest', 'email', 'guest-exp@test.local') end,
    'freeMinutes', p_free,
    'totalCents', 0, 'gstCents', 0, 'pricing', '{}'::jsonb,
    'cancelTokenHash', md5(random()::text) || md5(random()::text)
  );
$$;

-- ── The launch experiences and their prices ─────────────────────────────────
-- Scoped to the launch keys: a used database also holds other suites' own experiences.
select is((select count(*)::int from public.experiences where active and key in ('quick_race', 'leaderboard_challenge', 'double_race')), 3,
  'three experiences are seeded');
select is((select price_cents from public.experiences where key = 'quick_race'), 3500, 'a Quick Race is $35.00');
select is((select price_cents from public.experiences where key = 'double_race'), 5800, 'a Double Race is $58.00');
select is((select minutes from public.experiences where key = 'double_race'), 60, 'a Double Race runs an hour');
select is(
  (select p.price_cents from public.experience_promos p join public.experiences e on e.id = p.experience_id
    where e.key = 'quick_race' and p.name = 'Happy Hour'),
  2900, 'Happy Hour makes a Quick Race $29.00');
select is(
  (select p.claimed from public.experience_promos p join public.experiences e on e.id = p.experience_id
    where e.key = 'quick_race' and p.name = 'Student'),
  true, 'the student price has to be asked for');

select throws_ok(
  $$ insert into public.experiences (key, resource_type_id, name, minutes, price_cents)
     values ('bad_len', (select id from public.resource_types where key = 'sim'), 'Bad', 40, 1000) $$,
  '23514', null, 'an experience cannot be an odd number of minutes long');
select throws_ok(
  $$ insert into public.experiences (key, resource_type_id, name, minutes, price_cents)
     values ('bad_price', (select id from public.resource_types where key = 'sim'), 'Bad', 30, -1) $$,
  '23514', null, 'an experience cannot cost less than nothing');

-- ── Booking an experience ───────────────────────────────────────────────────
select lives_ok($$ select booking_hold(pg_temp.book_exp('quick_race', 30)) $$,
  'a Quick Race can be booked for its own 30 minutes');
select is(
  (select e.key from public.bookings b join public.experiences e on e.id = b.experience_id
    where b.resource_id = '00000000-0000-0000-0000-0000000cc301' order by b.created_at desc limit 1),
  'quick_race', 'the booking records which experience was sold');

select throws_like($$ select booking_hold(pg_temp.book_exp('quick_race', 60, 0, '2030-01-16T11:00:00+11:00')) $$,
  'RG:invalid_time:Single Session runs for 30 minutes',
  'an experience cannot be booked for a different length');
select throws_like($$ select booking_hold(pg_temp.book_exp('double_race', 30, 0, '2030-01-16T11:00:00+11:00')) $$,
  'RG:invalid_time:Double Session runs for 60 minutes',
  'a Double Race cannot be cut in half');
select lives_ok($$ select booking_hold(pg_temp.book_exp('double_race', 60, 0, '2030-01-16T11:00:00+11:00')) $$,
  'a Double Race can be booked for its hour');

select throws_like(
  $$ select booking_hold(pg_temp.book_exp('quick_race', 30, 0, '2030-01-16T13:00:00+11:00', '00000000-0000-0000-0000-0000000cc302')) $$,
  'RG:invalid:That experience is not available on this resource',
  'a simulator experience cannot be booked onto a billiard table');

update public.experiences set active = false where key = 'leaderboard_challenge';
select throws_like(
  $$ select booking_hold(pg_temp.book_exp('leaderboard_challenge', 30, 0, '2030-01-16T14:00:00+11:00')) $$,
  'RG:experience_unavailable:%', 'an experience that is switched off cannot be booked');
update public.experiences set active = true where key = 'leaderboard_challenge';

-- Free play on an experience is whole sessions, not 15-minute steps.
select throws_like($$ select booking_hold(pg_temp.book_exp('double_race', 60, 45, '2030-01-16T15:00:00+11:00')) $$,
  'RG:invalid:Free play on Double Session is used 30 minutes at a time',
  'free play on an experience comes a whole session at a time');
select lives_ok($$ select booking_hold(pg_temp.book_exp('double_race', 60, 30, '2030-01-16T15:00:00+11:00')) $$,
  'half a Double Race can be covered by free play');
select is((select balance_minutes from public.member_balances where member_id = '00000000-0000-0000-0000-00000000d301'),
  240 - 30, 'the free minutes come off the balance');

-- A plain booking is untouched by any of this.
select lives_ok(
  $$ select booking_hold(jsonb_build_object(
       'resourceId', '00000000-0000-0000-0000-0000000cc302',
       'startsAt', '2030-01-16T10:00:00+11:00'::timestamptz,
       'endsAt', '2030-01-16T10:45:00+11:00'::timestamptz,
       'now', '2030-01-16T08:00:00+11:00'::timestamptz,
       'customer', jsonb_build_object('name', 'Guest', 'email', 'guest-exp2@test.local'),
       'totalCents', 0, 'gstCents', 0, 'pricing', '{}'::jsonb,
       'cancelTokenHash', md5(random()::text) || md5(random()::text))) $$,
  'a booking with no experience still follows the session rules');

-- ── Membership values (D67) ─────────────────────────────────────────────────
select is((select monthly_price_cents from public.membership_tiers where name = 'Silver'), 4800, 'Silver is $48.00 a month');
select is((select discount_bp from public.membership_tiers where name = 'Gold'), 2000, 'Gold takes 20% off');
select is((select monthly_free_tournaments from public.membership_tiers where name = 'Diamond'), 1,
  'Diamond gets one free tournament entry a month, as the membership poster says (D84)');
select ok((select cardinality(perks) > 0 from public.membership_tiers where name = 'Diamond'),
  'a tier lists the perks staff honour by hand');

-- ── Tournaments ─────────────────────────────────────────────────────────────
insert into public.tournaments (id, name, starts_at, spots, entry_fee_cents, published)
values ('00000000-0000-0000-0000-0000000ff301', 'pgTAP Weekly', '2030-02-01T19:00:00+11:00', 2, 2000, true),
       ('00000000-0000-0000-0000-0000000ff302', 'pgTAP Draft', '2030-02-08T19:00:00+11:00', 8, 2000, false);

create function pg_temp.enter(p_tournament uuid, p_email text, p_now text default '2030-01-16T08:00:00+11:00')
returns jsonb language sql as $$
  select jsonb_build_object(
    'tournamentId', p_tournament,
    'now', p_now::timestamptz,
    'customer', jsonb_build_object('name', 'Entrant', 'email', p_email),
    'totalCents', 2000, 'gstCents', 182,
    'cancelTokenHash', md5(random()::text) || md5(random()::text)
  );
$$;

select is(tournament_spots_left('00000000-0000-0000-0000-0000000ff301', '2030-01-16T08:00:00+11:00'::timestamptz), 2,
  'a new tournament has all its spots');
select throws_like($$ select tournament_hold(pg_temp.enter('00000000-0000-0000-0000-0000000ff302', 'a@test.local')) $$,
  'RG:not_found:%', 'an unpublished tournament is not open for sign-ups');
select throws_like(
  $$ select tournament_hold(pg_temp.enter('00000000-0000-0000-0000-0000000ff301', 'a@test.local', '2030-02-02T19:00:00+11:00')) $$,
  'RG:tournament_started:%', 'a tournament that has started is closed');

select lives_ok($$ select tournament_hold(pg_temp.enter('00000000-0000-0000-0000-0000000ff301', 'e1@test.local')) $$,
  'someone can sign up');
select is(tournament_spots_left('00000000-0000-0000-0000-0000000ff301', '2030-01-16T08:00:00+11:00'::timestamptz), 1,
  'a hold waiting for payment holds a spot');
select throws_like($$ select tournament_hold(pg_temp.enter('00000000-0000-0000-0000-0000000ff301', 'e1@test.local')) $$,
  'RG:already_entered:%', 'the same person cannot sign up twice');

select lives_ok($$ select tournament_hold(pg_temp.enter('00000000-0000-0000-0000-0000000ff301', 'e2@test.local')) $$,
  'the last spot can be taken');
select throws_like($$ select tournament_hold(pg_temp.enter('00000000-0000-0000-0000-0000000ff301', 'e3@test.local')) $$,
  'RG:tournament_full:%', 'a full tournament turns people away');

-- ── Every price change is traceable to who made it ──────────────────────────
-- Experiences and their promotional prices ARE prices, and a tournament carries an entry fee,
-- so the same audit trigger every other configuration table has must fire on these too.
create function pg_temp.as_api(p_actor text, p_reason text default null) returns void language sql as $$
  select set_config('request.headers',
    json_build_object('x-rg-actor', p_actor, 'x-rg-reason-b64', encode(convert_to(p_reason, 'UTF8'), 'base64'))::text, true);
$$;
create function pg_temp.no_api() returns void language sql as $$ select set_config('request.headers', '', true); $$;

-- Only look at audit rows written from here on: a used database already has many, including
-- the ones the API integration tests write.
create temp table t_audit_mark as select coalesce(max(id), 0) as id from public.audit_log;

select pg_temp.no_api();
update public.experiences set price_cents = 3600 where key = 'quick_race';
select is(
  (select count(*)::int from public.audit_log
    where entity = 'experiences' and id > (select id from t_audit_mark)), 0,
  'a write outside the API (a migration, the seed, psql) is not audited');

select pg_temp.as_api('00000000-0000-0000-0000-00000000b301', 'Spring price review');
update public.experiences set price_cents = 3900 where key = 'quick_race';
select results_eq(
  $$ select actor_staff_id, action, (before ->> 'price_cents')::int, (after ->> 'price_cents')::int, reason
     from public.audit_log where entity = 'experiences' and action = 'experiences.update' order by id desc limit 1 $$,
  $$ values ('00000000-0000-0000-0000-00000000b301'::uuid, 'experiences.update', 3600, 3900, 'Spring price review') $$,
  'changing an experience price is audited with actor, before and after');

update public.experience_promos set price_cents = 2700
  where experience_id = (select id from public.experiences where key = 'quick_race') and name = 'Happy Hour';
select is(
  (select (after ->> 'price_cents')::int from public.audit_log
    where entity = 'experience_promos' and action = 'experience_promos.update' order by id desc limit 1),
  2700, 'changing a promotional price is audited');

update public.tournaments set entry_fee_cents = 3000 where id = '00000000-0000-0000-0000-0000000ff301';
select is(
  (select (after ->> 'entry_fee_cents')::int from public.audit_log
    where entity = 'tournaments' and action = 'tournaments.update' order by id desc limit 1),
  3000, 'changing a tournament entry fee is audited');

insert into public.site_events (title, detail) values ('pgTAP Event', 'Prize pool');
select is(
  (select after ->> 'title' from public.audit_log where entity = 'site_events' and action = 'site_events.insert' order by id desc limit 1),
  'pgTAP Event', 'adding an event is audited');

-- ── Adding someone at the counter (D75) ─────────────────────────────────────
insert into public.shifts (staff_id, opening_float_cents) values ('00000000-0000-0000-0000-00000000b301', 10000);

create function pg_temp.counter(p_tournament uuid, p_name text, p_email text, p_method text, p_amount int)
returns jsonb language sql as $$
  select public.tournament_counter_entry('00000000-0000-0000-0000-00000000b301', jsonb_build_object(
    'tournamentId', p_tournament,
    'now', '2030-01-16T08:00:00+11:00'::timestamptz,
    'name', p_name, 'email', p_email,
    'method', p_method, 'amountCents', p_amount,
    'cancelTokenHash', md5(random()::text) || md5(random()::text)
  ));
$$;

insert into public.tournaments (id, name, starts_at, spots, entry_fee_cents, published)
values ('00000000-0000-0000-0000-0000000ff303', 'pgTAP Counter Cup', '2030-02-15T19:00:00+11:00', 2, 2500, true);

select throws_like(
  $$ select pg_temp.counter('00000000-0000-0000-0000-0000000ff303', 'Bad Method', 'bm@test.local', 'stripe', 2500) $$,
  'RG:invalid:Choose cash, card or no charge', 'only money the till can hold, or no charge');
select throws_like(
  $$ select pg_temp.counter('00000000-0000-0000-0000-0000000ff303', 'Paid Free', 'pf@test.local', 'free', 2500) $$,
  'RG:invalid:An entry with no charge is $0.00', 'no charge means nothing is taken');
select throws_like(
  $$ select pg_temp.counter('00000000-0000-0000-0000-0000000ff303', 'Zero Cash', 'zc@test.local', 'cash', 0) $$,
  'RG:invalid:Enter the amount taken, or choose no charge', 'taking nothing in cash is not a sale');

select is(
  (pg_temp.counter('00000000-0000-0000-0000-0000000ff303', 'Counter One', 'c1@test.local', 'cash', 2500) ->> 'amountCents')::int,
  2500, 'cash at the counter takes the entry fee');
select is(
  (select amount_cents from public.cash_movements
    where payment_id = (select id from public.payments where tournament_entry_id =
      (select id from public.tournament_entries where customer_id = (select id from public.customers where email = 'c1@test.local')))),
  2500, 'the cash goes into the till');

select is(
  (pg_temp.counter('00000000-0000-0000-0000-0000000ff303', 'Counter Two', 'c2@test.local', 'free', 0) ->> 'spotsLeft')::int,
  0, 'an entry with no charge still takes a spot');

select * from finish();
rollback;
