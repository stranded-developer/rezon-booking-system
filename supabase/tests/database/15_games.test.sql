-- Pick your game, track and car (D80); VR rigs are simulators (D77); Double Race listed second (D78).
begin;
select plan(14);

update public.opening_hours set open_time = '10:00', close_time = '21:00', closed = false;

-- ── The launch list and the simulators ──────────────────────────────────────
select ok((select count(*) from public.games g join public.resource_types rt on rt.id = g.resource_type_id where rt.key = 'sim' and g.active) >= 1,
  'the simulators have games to choose from');
select ok(not exists (
    select 1 from public.games g
    where g.name in ('Assetto Corsa Competizione', 'Assetto Corsa', 'F1 25')
      and (not exists (select 1 from public.game_tracks t where t.game_id = g.id)
        or not exists (select 1 from public.game_cars c where c.game_id = g.id))
  ), 'every launch game has tracks and cars');
select lives_ok($$ select private.seed_launch_games() $$, 'running the launch list again is harmless');
select is((select count(*)::int from public.games where name = 'Assetto Corsa Competizione'), 1, '...and adds nothing a second time');

select is(
  (select count(*)::int from public.resources r join public.resource_types rt on rt.id = r.resource_type_id
    where rt.key = 'sim' and r.active and r.label in ('VR Sim 1', 'VR Sim 2')),
  2, 'the two VR rigs are simulators (D77)');

-- ── Our own game, so nothing below depends on the launch list ───────────────
insert into public.games (id, resource_type_id, name, sort)
values ('00000000-0000-0000-0000-0000000ee501', (select id from public.resource_types where key = 'sim'), 'pgTAP Game', 999),
       ('00000000-0000-0000-0000-0000000ee502', (select id from public.resource_types where key = 'sim'), 'pgTAP Hidden Game', 999);
update public.games set active = false where id = '00000000-0000-0000-0000-0000000ee502';
insert into public.game_tracks (game_id, name) values ('00000000-0000-0000-0000-0000000ee501', 'pgTAP Ring');

-- ── Who can see and change the list ─────────────────────────────────────────
set local role anon;
select is((select count(*)::int from public.games where name like 'pgTAP%'), 1, 'anon sees active games only');
select is((select count(*)::int from public.game_tracks where name = 'pgTAP Ring'), 1, 'anon reads tracks');
select throws_ok($$ insert into public.games (resource_type_id, name) values ((select id from public.resource_types limit 1), 'x') $$,
  '42501', null, 'anon cannot add a game');
select throws_ok($$ delete from public.game_cars $$, '42501', null, 'anon cannot remove a car');
reset role;

set local role authenticated;
select throws_ok($$ update public.game_tracks set name = 'x' $$, '42501', null, 'a signed-in customer cannot edit tracks');
reset role;

-- Changes to the list are audited like every other configuration table.
insert into auth.users (id, email, aud, role) values ('00000000-0000-0000-0000-00000000a501', 'games@test.local', 'authenticated', 'authenticated');
insert into public.staff (id, auth_user_id, display_name, role, pin_hash)
values ('00000000-0000-0000-0000-00000000b501', '00000000-0000-0000-0000-00000000a501', 'Games', 'superadmin', 'x');
-- What the API sends with a back office write (the same headers 06_admin uses).
select set_config('request.headers',
  json_build_object('x-rg-actor', '00000000-0000-0000-0000-00000000b501',
                    'x-rg-reason-b64', encode(convert_to('New season', 'UTF8'), 'base64'))::text, true);
update public.game_tracks set sort = 5 where name = 'pgTAP Ring';
select is(
  (select a.actor_staff_id::text || ' / ' || a.reason from public.audit_log a
    join public.game_tracks t on a.entity = 'game_tracks' and a.entity_id = t.id::text
   where t.name = 'pgTAP Ring' order by a.id desc limit 1),
  '00000000-0000-0000-0000-00000000b501 / New season',
  'a change to a track is audited with who and why');
select set_config('request.headers', '', true);

-- ── The hold keeps what the customer asked to drive ─────────────────────────
insert into public.resources (id, resource_type_id, label, sort)
values ('00000000-0000-0000-0000-0000000cc501', (select id from public.resource_types where key = 'sim'), 'pgTAP Game Sim', 961);

create function pg_temp.hold_with(p_setup jsonb, p_start text) returns public.bookings language sql as $$
  select public.booking_hold(jsonb_build_object(
    'resourceId', '00000000-0000-0000-0000-0000000cc501',
    'experienceId', (select id from public.experiences where key = 'quick_race'),
    'startsAt', p_start::timestamptz,
    'endsAt', p_start::timestamptz + interval '30 minutes',
    'now', '2030-01-16T08:00:00+11:00'::timestamptz,
    'customer', jsonb_build_object('name', 'Gamer', 'email', 'gamer@test.local'),
    'totalCents', 0, 'gstCents', 0, 'pricing', '{}'::jsonb,
    'cancelTokenHash', md5(random()::text) || md5(random()::text),
    'simSetup', p_setup
  ));
$$;

select is(
  (select sim_setup from pg_temp.hold_with('{"game": "pgTAP Game", "track": "pgTAP Ring"}', '2030-01-16T11:00:00+11:00')),
  '{"game": "pgTAP Game", "track": "pgTAP Ring"}'::jsonb,
  'the hold stores the pick by name');
select is((select sim_setup from pg_temp.hold_with(null, '2030-01-16T12:00:00+11:00')), null::jsonb, 'no pick, nothing stored');
select is((select sim_setup from pg_temp.hold_with('"Monza"', '2030-01-16T13:00:00+11:00')), null::jsonb,
  'anything but an object is not stored');

select * from finish();
rollback;
