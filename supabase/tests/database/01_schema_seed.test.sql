-- Schema presence, RLS coverage, and launch seed values.
begin;
select plan(20);

select tables_are(
  'public',
  array[
    'venue_settings', 'opening_hours', 'resource_types', 'resources', 'rate_bands', 'happy_hours',
    'staff', 'customers', 'membership_tiers', 'tier_prices', 'members',
    'referral_codes', 'bookings', 'sessions', 'member_balance_ledger', 'referral_redemptions',
    'shifts', 'payments', 'refunds', 'cash_movements', 'price_overrides',
    'stripe_events', 'audit_log', 'email_log', 'rate_limits', 'venue_photos',
    'experiences', 'experience_promos', 'tournaments', 'tournament_entries', 'site_events'
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

select results_eq(
  $$ select day_of_week, open_time, close_time, closed from opening_hours order by day_of_week $$,
  $$ values (1::smallint, '12:00'::time, '22:00'::time, false),
            (2::smallint, '12:00'::time, '22:00'::time, false),
            (3::smallint, '12:00'::time, '22:00'::time, false),
            (4::smallint, '12:00'::time, '22:00'::time, false),
            (5::smallint, '12:00'::time, '24:00'::time, false),
            (6::smallint, '11:00'::time, '24:00'::time, false),
            (7::smallint, '11:00'::time, '22:00'::time, false) $$,
  'open noon to 10pm Mon–Thu, to midnight Fri, 11am–midnight Sat, 11am–10pm Sun (D73)'
);

select results_eq(
  $$ select key, base_rate_cents, min_minutes from resource_types where key in ('billiard', 'sim', 'vr') order by sort $$,
  $$ values ('billiard', 2500, 15), ('sim', 6000, 15), ('vr', 5000, 15) $$,
  'resource types and rates: $25 / $60 / $50 per hour, 15 min minimum'
);

select results_eq(
  $$ select rt.key, count(*) from resources r join resource_types rt on rt.id = r.resource_type_id
     where r.active and r.label ~ '^(Table|Sim|VR) [0-9]+$'
     group by rt.key, rt.sort order by rt.sort $$,
  $$ values ('billiard', 2::bigint), ('sim', 6::bigint), ('vr', 2::bigint) $$,
  '2 tables, 6 sims, 2 VR seats'
);

-- D74: one happy hour, 12:00–15:00 every day, as a flat price. On the hourly types that is a
-- rate band; on the experiences it is a promotional price. There is deliberately no percentage
-- happy hour, because a percentage on top of a flat rate in the same window would discount twice.
select is(
  (select count(*) from happy_hours where active), 0::bigint,
  'no percentage happy hour: the venue prices happy hour as a flat amount'
);

select results_eq(
  $$ select rt.key, rb.days_of_week, rb.start_time, rb.end_time, rb.rate_cents
       from rate_bands rb join resource_types rt on rt.id = rb.resource_type_id
      where rb.active order by rt.sort $$,
  $$ values ('billiard', '{1,2,3,4,5,6,7}'::smallint[], '12:00'::time, '15:00'::time, 2000),
            ('vr', '{1,2,3,4,5,6,7}'::smallint[], '12:00'::time, '15:00'::time, 4000) $$,
  'happy hour 12:00–15:00 every day: billiards $20/hr, VR $40/hr'
);

select results_eq(
  $$ select name::text, discount_bp, monthly_price_cents, monthly_free_minutes, max_balance_minutes
     from membership_tiers order by sort $$,
  $$ values ('Silver', 1000, 4800, 60, 600), ('Gold', 2000, 7800, 120, 1200), ('Diamond', 2000, 12800, 240, 2400) $$,
  'tiers: 10/20/20% off, $48/$78/$128, free play 2/4/8 sessions a month, capped at ten months'
);

select is((select session_minutes from venue_settings), 30, 'a session is 30 minutes');

select is((select count(distinct tier_id) from tier_prices), 3::bigint, 'every tier has price history');

select matches(private.random_code(6), '^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{6}$', 'random_code uses the unambiguous alphabet');
select is(
  (select count(distinct private.random_code(6)) from generate_series(1, 500)),
  500::bigint,
  '500 generated codes are unique'
);

select has_function('public', 'expire_stale_holds', 'expire_stale_holds exists');
select function_privs_are('public', 'expire_stale_holds', array['timestamp with time zone'], 'anon', array[]::text[],
  'anon cannot execute expire_stale_holds');

select results_eq(
  $$ select key, minutes, price_cents from experiences
     where key in ('quick_race', 'leaderboard_challenge', 'double_race') order by sort $$,
  $$ values ('quick_race', 30, 3500), ('leaderboard_challenge', 30, 3500), ('double_race', 60, 5800) $$,
  'experiences: Quick Race and Leaderboard Challenge $35 for 30 min, Double Race $58 for an hour'
);

select results_eq(
  $$ select e.key, p.name, p.start_time, p.end_time, p.price_cents, p.claimed
     from experience_promos p join experiences e on e.id = p.experience_id
     where e.key in ('quick_race', 'leaderboard_challenge', 'double_race')
     order by e.sort, p.sort $$,
  $$ values ('quick_race', 'Happy Hour', '12:00'::time, '15:00'::time, 2900, false),
            ('quick_race', 'Student', '00:00'::time, '24:00'::time, 3200, true),
            ('leaderboard_challenge', 'Happy Hour', '12:00'::time, '15:00'::time, 2900, false),
            ('leaderboard_challenge', 'Student', '00:00'::time, '24:00'::time, 3200, true),
            ('double_race', 'Happy Hour', '12:00'::time, '15:00'::time, 4900, false),
            ('double_race', 'Student', '00:00'::time, '24:00'::time, 5200, true) $$,
  'Happy Hour 12:00–15:00 automatically, the student price all hours but only on request'
);

select * from finish();
rollback;
