-- D115: walk-in packages at the counter, paid up front.
begin;
select plan(10);

select results_eq(
  $$ select e.key, rt.key::text, e.minutes, e.price_cents, e.online, e.at_counter
     from experiences e join resource_types rt on rt.id = e.resource_type_id
     where e.key in ('billiard_30', 'billiard_60', 'billiard_120', 'sim_120') order by e.minutes, rt.key $$,
  $$ values ('billiard_30', 'billiard', 30, 1250, false, true),
            ('billiard_60', 'billiard', 60, 2500, false, true),
            ('billiard_120', 'billiard', 120, 5000, false, true),
            ('sim_120', 'sim', 120, 11600, false, true) $$,
  'launch counter packages: billiards at the hourly rate, 2-hour sim at two Double Sessions, not online'
);
select is(
  (select count(*) from experiences where key in ('quick_race', 'double_race', 'leaderboard_challenge') and online and at_counter),
  3::bigint, 'the website''s simulator packages are sold at the counter too'
);

insert into auth.users (id, email, aud, role) values ('00000000-0000-0000-0000-00000000a001', 'owner@test.local', 'authenticated', 'authenticated');
insert into staff (id, auth_user_id, display_name, role, pin_hash) values
  ('00000000-0000-0000-0000-00000000b001', '00000000-0000-0000-0000-00000000a001', 'Owner', 'superadmin', 'x');
create temp table r as select id from resources where label = 'Table 1';
grant select on r to public;

select throws_ok(
  $$ insert into sessions (resource_id, kind, opened_at, opened_by, experience_id)
     values ((select id from r), 'walk_in', now(), '00000000-0000-0000-0000-00000000b001', (select id from experiences where key = 'billiard_60')) $$,
  '23514', null, 'a package session needs its end time'
);
select throws_ok(
  $$ insert into sessions (resource_id, kind, opened_at, opened_by, experience_id, package_ends_at)
     values ((select id from r), 'walk_in', now(), '00000000-0000-0000-0000-00000000b001', (select id from experiences where key = 'billiard_60'), now() - interval '1 minute') $$,
  '23514', null, 'a package ends after it starts'
);

update experiences set at_counter = false where key = 'billiard_60';
select throws_like(
  $$ select pos_open_package('00000000-0000-0000-0000-00000000b001', jsonb_build_object(
       'resourceId', (select id from r), 'experienceId', (select id from experiences where key = 'billiard_60'),
       'pricing', '{}'::jsonb, 'totalCents', 0, 'gstCents', 0)) $$,
  'RG:package_unavailable:%', 'a package not sold at the counter is refused'
);
update experiences set at_counter = true where key = 'billiard_60';
select throws_like(
  $$ select pos_open_package('00000000-0000-0000-0000-00000000b001', jsonb_build_object(
       'resourceId', (select id from r), 'experienceId', (select id from experiences where key = 'sim_120'),
       'pricing', '{}'::jsonb, 'totalCents', 0, 'gstCents', 0)) $$,
  'RG:package_unavailable:%', 'a simulator package can''t be sold on a billiard table'
);
select throws_like(
  $$ select pos_open_package('00000000-0000-0000-0000-00000000b001', jsonb_build_object(
       'resourceId', (select id from r), 'experienceId', (select id from experiences where key = 'billiard_60'),
       'pricing', '{}'::jsonb, 'totalCents', 2500, 'gstCents', 1)) $$,
  'RG:gst_mismatch:%', 'GST is checked'
);
select throws_like(
  $$ select pos_open_package('00000000-0000-0000-0000-00000000b001', jsonb_build_object(
       'resourceId', (select id from r), 'experienceId', (select id from experiences where key = 'billiard_60'),
       'pricing', '{}'::jsonb, 'totalCents', 0, 'gstCents', 0, 'freeMinutes', 30)) $$,
  'RG:invalid:%', 'free minutes need a member'
);
select throws_like(
  $$ select pos_open_package('00000000-0000-0000-0000-00000000b001', jsonb_build_object(
       'resourceId', (select id from r), 'experienceId', (select id from experiences where key = 'billiard_60'),
       'pricing', '{}'::jsonb, 'totalCents', 0, 'gstCents', 0, 'freeMinutes', 15)) $$,
  'RG:invalid:%', 'free play on a package is whole sessions'
);

select ok(
  not has_function_privilege('anon', 'public.pos_open_package(uuid, jsonb)', 'execute')
  and not has_function_privilege('authenticated', 'public.pos_open_package(uuid, jsonb)', 'execute'),
  'only the API can sell a package'
);

select * from finish();
rollback;
