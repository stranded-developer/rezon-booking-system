-- A simulator session booked for longer than its package (D118): only an extendable package, only
-- in whole sessions, and the time is still blocked for everyone else.
begin;
select plan(8);

update public.opening_hours set open_time = '10:00', close_time = '21:00', closed = false;
update public.venue_settings set bookings_open_from = null;

select is((select array_agg(key order by key) from public.experiences where extendable and active),
  array['double_race', 'quick_race']::text[], 'Single and Double Session can be booked for longer; Leaderboard Challenge cannot');

insert into public.resources (id, resource_type_id, label, sort)
values ('00000000-0000-0000-0000-0000000cc701', (select id from public.resource_types where key = 'sim'), 'pgTAP Long Sim', 971);

create function pg_temp.hold(p_key text, p_start text, p_minutes int) returns public.bookings language sql as $$
  select public.booking_hold(jsonb_build_object(
    'resourceId', '00000000-0000-0000-0000-0000000cc701',
    'experienceId', (select id from public.experiences where key = p_key),
    'startsAt', p_start::timestamptz,
    'endsAt', p_start::timestamptz + make_interval(mins => p_minutes),
    'now', '2030-01-16T08:00:00+11:00'::timestamptz,
    'customer', jsonb_build_object('name', 'Long', 'email', 'long@test.local'),
    'totalCents', 0, 'gstCents', 0, 'pricing', '{}'::jsonb,
    'cancelTokenHash', md5(random()::text) || md5(random()::text)
  ));
$$;

select is(
  (select upper(period) - lower(period) from pg_temp.hold('double_race', '2030-01-16T12:00:00+11:00', 120)),
  interval '2 hours', 'a Double Session booked for 2 hours holds 2 hours');
select is(
  (select upper(period) - lower(period) from pg_temp.hold('quick_race', '2030-01-16T15:00:00+11:00', 90)),
  interval '90 minutes', 'a Single Session booked for 90 minutes holds 90 minutes');

select throws_like($$ select pg_temp.hold('quick_race', '2030-01-16T13:00:00+11:00', 30) $$,
  '%slot_taken%', 'the second hour of the 2-hour booking is taken');
select throws_like($$ select pg_temp.hold('leaderboard_challenge', '2030-01-16T17:00:00+11:00', 60) $$,
  '%runs for 30 minutes%', 'a package that is not extendable still runs for its own length');
select throws_like($$ select pg_temp.hold('double_race', '2030-01-16T17:00:00+11:00', 75) $$,
  '%runs for 60 minutes%', 'longer is in whole sessions only');
select throws_like($$ select pg_temp.hold('double_race', '2030-01-16T17:00:00+11:00', 30) $$,
  '%runs for 60 minutes%', 'never shorter than the package');

update public.experiences set extendable = false where key = 'double_race';
select throws_like($$ select pg_temp.hold('double_race', '2030-01-16T18:00:00+11:00', 120) $$,
  '%runs for 60 minutes%', 'the owner can switch it off');

select * from finish();
rollback;
