-- rate_limit_hit: fixed windows, per key, privileges.
begin;
select plan(9);

select results_eq(
  $$ select allowed, hits, reset_at from rate_limit_hit('pgtap:rl:a', 2, 60, '2030-01-14T10:00:10Z') $$,
  $$ values (true, 1, '2030-01-14T10:01:00Z'::timestamptz) $$, 'first hit allowed, window resets on the minute');
select is((select allowed from rate_limit_hit('pgtap:rl:a', 2, 60, '2030-01-14T10:00:20Z')), true, 'second hit allowed');
select results_eq(
  $$ select allowed, hits from rate_limit_hit('pgtap:rl:a', 2, 60, '2030-01-14T10:00:59Z') $$,
  $$ values (false, 3) $$, 'third hit in the same window refused');
select is((select allowed from rate_limit_hit('pgtap:rl:b', 2, 60, '2030-01-14T10:00:59Z')), true, 'other keys are counted separately');
select results_eq(
  $$ select allowed, hits from rate_limit_hit('pgtap:rl:a', 2, 60, '2030-01-14T10:01:00Z') $$,
  $$ values (true, 1) $$, 'a new window starts again at 1');
select throws_like($$ select rate_limit_hit('pgtap:rl:a', 0, 60) $$, 'RG:invalid:%', 'limit must be positive');
select function_privs_are('public', 'rate_limit_hit', array['text', 'integer', 'integer', 'timestamp with time zone'], 'anon', array[]::text[], 'anon cannot count hits');
select table_privs_are('public', 'rate_limits', 'anon', array[]::text[], 'anon has no access to counters');
select table_privs_are('public', 'rate_limits', 'authenticated', array[]::text[], 'signed-in users have no access to counters');

select * from finish();
rollback;
