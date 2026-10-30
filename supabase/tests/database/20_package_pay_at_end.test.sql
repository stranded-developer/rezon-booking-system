-- D116: a walk-in package paid at the end.
begin;
select plan(9);

insert into auth.users (id, email, aud, role) values ('00000000-0000-0000-0000-00000000a001', 'owner@test.local', 'authenticated', 'authenticated');
insert into staff (id, auth_user_id, display_name, role, pin_hash) values
  ('00000000-0000-0000-0000-00000000b001', '00000000-0000-0000-0000-00000000a001', 'Owner', 'superadmin', 'x');
create temp table r as select id, label from resources where label in ('Table 1', 'Table 2');
create temp table s (id uuid);
grant select on r, s to public;

select throws_ok(
  $$ insert into sessions (resource_id, kind, opened_at, opened_by, package_pay_at_end)
     values ((select id from r where label = 'Table 1'), 'walk_in', now(), '00000000-0000-0000-0000-00000000b001', true) $$,
  '23514', null, 'only a package can be paid at the end'
);

-- A Wednesday at noon, inside opening hours.
insert into s select (pos_open_package_pay_at_end('00000000-0000-0000-0000-00000000b001', jsonb_build_object(
  'resourceId', (select id from r where label = 'Table 1'), 'experienceId', (select id from experiences where key = 'billiard_60'),
  'now', '2030-01-23T12:00:00+11:00', 'pricing', '{"payAtEnd": true}'::jsonb)) ->> 'sessionId')::uuid;
select results_eq(
  $$ select package_pay_at_end, package_ends_at, status::text from sessions where id = (select id from s) $$,
  $$ values (true, '2030-01-23T13:00:00+11:00'::timestamptz, 'open') $$,
  'it starts with the package''s end time and is to be paid at the end'
);
select is((select count(*) from payments where session_id = (select id from s)), 0::bigint, 'no money is taken when it starts');

select throws_like(
  $$ select pos_close_session((select id from s), '00000000-0000-0000-0000-00000000b001', '{"closedAt": "2030-01-23T13:20:00+11:00"}'::jsonb) $$,
  'RG:invalid:%', 'closing it is charged, not waved through as prepaid'
);
select throws_like(
  $$ select pos_close_session((select id from s), '00000000-0000-0000-0000-00000000b001', jsonb_build_object(
       'closedAt', '2030-01-23T13:20:00+11:00', 'pricing', '{}'::jsonb, 'computedTotalCents', 0, 'totalCents', 0, 'gstCents', 0, 'freeMinutes', 15)) $$,
  'RG:invalid:Free play on a package%', 'free play on it is whole sessions'
);
select throws_like(
  $$ select pos_close_session((select id from s), '00000000-0000-0000-0000-00000000b001', jsonb_build_object(
       'closedAt', '2030-01-23T13:20:00+11:00', 'pricing', '{}'::jsonb, 'computedTotalCents', 0, 'totalCents', 0, 'gstCents', 0, 'freeMinutes', 90)) $$,
  'RG:invalid:Free play on a package%', 'and no more than the package'
);
select pos_close_session((select id from s), '00000000-0000-0000-0000-00000000b001', jsonb_build_object(
  'closedAt', '2030-01-23T13:20:00+11:00', 'pricing', '{"mode": "package"}'::jsonb, 'computedTotalCents', 0, 'totalCents', 0, 'gstCents', 0, 'method', 'free'));
select results_eq(
  $$ select status::text, total_cents, (select count(*) from payments where session_id = (select id from s)) from sessions where id = (select id from s) $$,
  $$ values ('closed', 0, 1::bigint) $$,
  'closing records its one payment'
);

select is(
  (pos_void_session(
     (pos_open_package_pay_at_end('00000000-0000-0000-0000-00000000b001', jsonb_build_object(
        'resourceId', (select id from r where label = 'Table 2'), 'experienceId', (select id from experiences where key = 'billiard_30'),
        'now', '2030-01-23T12:00:00+11:00')) ->> 'sessionId')::uuid,
     '00000000-0000-0000-0000-00000000b001', 'wrong table') ->> 'refundCents')::int,
  0, 'voiding one not yet paid refunds nothing'
);

select ok(
  not has_function_privilege('anon', 'public.pos_open_package_pay_at_end(uuid, jsonb)', 'execute')
  and not has_function_privilege('authenticated', 'public.pos_open_package_pay_at_end(uuid, jsonb)', 'execute'),
  'only the API can start one'
);

select * from finish();
rollback;
