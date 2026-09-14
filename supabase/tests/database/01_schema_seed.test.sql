-- Schema presence, RLS coverage, and launch seed values.
begin;
select plan(16);

select tables_are(
  'public',
  array[
    'venue_settings', 'opening_hours', 'resource_types', 'resources', 'rate_bands', 'happy_hours',
    'staff', 'customers', 'membership_tiers', 'tier_prices', 'members',
    'referral_codes', 'bookings', 'sessions', 'member_balance_ledger', 'referral_redemptions',
    'shifts', 'payments', 'refunds', 'cash_movements', 'price_overrides',
    'stripe_events', 'audit_log', 'email_log'
  ],
  'public schema has exactly the spec tables'
);

select is(
  (select count(*) from pg_tables where schemaname = 'public' and not rowsecurity),
  0::bigint,
  'RLS is enabled on every public table'
);

select is(
  (select count(*) from information_schema.table_privileges
   where table_schema = 'public' and grantee in ('anon', 'authenticated')
     and privilege_type in ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE')),
  0::bigint,
  'browser roles have no write privileges on any public table'
);

select is((select timezone from venue_settings), 'Australia/Sydney', 'venue timezone');
select is((select booking_window_days from venue_settings), 7, 'booking window 7 days');
select is((select online_cutoff_minutes from venue_settings), 30, 'online cutoff 30 min');

select is(
  (select count(*) from opening_hours where open_time = '10:00' and close_time = '21:00' and not closed),
  7::bigint,
  'open 10:00–21:00 all seven days'
);

select results_eq(
  $$ select key, base_rate_cents, min_minutes from resource_types where key in ('billiard', 'sim', 'vr') order by sort $$,
  $$ values ('billiard', 3000, 15), ('sim', 6000, 15), ('vr', 5000, 15) $$,
  'resource types and rates: $30 / $60 / $50 per hour, 15 min minimum'
);

select results_eq(
  $$ select rt.key, count(*) from resources r join resource_types rt on rt.id = r.resource_type_id
     where r.active and r.label ~ '^(Table|Sim|VR) [0-9]+$'
     group by rt.key, rt.sort order by rt.sort $$,
  $$ values ('billiard', 2::bigint), ('sim', 6::bigint), ('vr', 2::bigint) $$,
  '2 tables, 6 sims, 2 VR seats'
);

select results_eq(
  $$ select resource_type_ids is null, days_of_week, start_time, end_time, discount_bp from happy_hours where name = 'Happy Hour' $$,
  $$ values (true, '{1,2,3,4,5}'::smallint[], '10:00'::time, '15:00'::time, 1000) $$,
  'happy hour Mon–Fri 10:00–15:00, 10%, all types'
);

select results_eq(
  $$ select name::text, discount_bp, monthly_price_cents, monthly_free_minutes, max_balance_minutes
     from membership_tiers order by sort $$,
  $$ values ('Silver', 500, 10000, 60, 600), ('Gold', 1000, 20000, 60, 600), ('Diamond', 1500, 30000, 60, 600) $$,
  'tiers: Silver/Gold/Diamond, 5/10/15%, $100/$200/$300, 60 min, cap 600'
);

select is((select count(distinct tier_id) from tier_prices), 3::bigint, 'every tier has price history');

select matches(private.random_code(6), '^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{6}$', 'random_code uses the unambiguous alphabet');
select is(
  (select count(distinct private.random_code(6)) from generate_series(1, 500)),
  500::bigint,
  '500 generated codes are unique'
);

select has_function('public', 'expire_stale_holds', 'expire_stale_holds exists');
select function_privs_are('public', 'expire_stale_holds', array[]::text[], 'anon', array[]::text[],
  'anon cannot execute expire_stale_holds');

select * from finish();
rollback;
