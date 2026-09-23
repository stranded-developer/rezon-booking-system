-- Experiences, tournaments and site events (D65–D70).
--   An experience sets its own fixed length; the session rules do not apply to it.
--   A tournament has a fixed number of spots, and holds waiting for payment count against them.
begin;
select plan(31);

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
select is((select count(*)::int from public.experiences where active), 3, 'three experiences are seeded');
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
  'RG:invalid_time:Quick Race runs for 30 minutes',
  'an experience cannot be booked for a different length');
select throws_like($$ select booking_hold(pg_temp.book_exp('double_race', 30, 0, '2030-01-16T11:00:00+11:00')) $$,
  'RG:invalid_time:Double Race runs for 60 minutes',
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
  'RG:invalid:Free play on Double Race is used 30 minutes at a time',
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
select is((select monthly_free_tournaments from public.membership_tiers where name = 'Diamond'), 0,
  'free tournament entry is built but switched off');
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

select * from finish();
rollback;
