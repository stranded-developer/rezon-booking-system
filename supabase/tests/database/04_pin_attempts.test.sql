-- register_pin_attempt: counting, lockout, reset, privileges.
begin;
select plan(12);

insert into auth.users (id, email, aud, role) values
  ('00000000-0000-0000-0000-00000000a002', 'cashier@test.local', 'authenticated', 'authenticated');
insert into staff (id, auth_user_id, display_name, role, pin_hash) values
  ('00000000-0000-0000-0000-00000000b002', '00000000-0000-0000-0000-00000000a002', 'Cashier', 'cashier', 'x');

select results_eq(
  $$ select accepted, just_locked, failed_count from register_pin_attempt('00000000-0000-0000-0000-00000000b002', false) $$,
  $$ values (false, false, 1) $$, 'first failure counts 1'
);
select register_pin_attempt('00000000-0000-0000-0000-00000000b002', false);
select register_pin_attempt('00000000-0000-0000-0000-00000000b002', false);
select results_eq(
  $$ select accepted, just_locked, failed_count from register_pin_attempt('00000000-0000-0000-0000-00000000b002', false) $$,
  $$ values (false, false, 4) $$, 'fourth failure counts 4'
);
select results_eq(
  $$ select accepted, just_locked, locked_until > now() + interval '4 min' from register_pin_attempt('00000000-0000-0000-0000-00000000b002', false) $$,
  $$ values (false, true, true) $$, 'fifth failure locks for 5 minutes'
);
select is((select pin_failed_count from staff where id = '00000000-0000-0000-0000-00000000b002'), 0, 'counter resets when locking');
select results_eq(
  $$ select accepted, just_locked from register_pin_attempt('00000000-0000-0000-0000-00000000b002', true) $$,
  $$ values (false, false) $$, 'a correct PIN is refused while locked'
);
select results_eq(
  $$ select accepted, just_locked from register_pin_attempt('00000000-0000-0000-0000-00000000b002', false) $$,
  $$ values (false, false) $$, 'failures while locked do not extend or re-lock'
);

update staff set pin_locked_until = now() - interval '1 second' where id = '00000000-0000-0000-0000-00000000b002';
select results_eq(
  $$ select accepted, failed_count from register_pin_attempt('00000000-0000-0000-0000-00000000b002', true) $$,
  $$ values (true, 0) $$, 'a correct PIN is accepted after the lock expires'
);
select is((select pin_locked_until from staff where id = '00000000-0000-0000-0000-00000000b002'), null, 'lock cleared on success');

select register_pin_attempt('00000000-0000-0000-0000-00000000b002', false);
select register_pin_attempt('00000000-0000-0000-0000-00000000b002', true);
select is((select pin_failed_count from staff where id = '00000000-0000-0000-0000-00000000b002'), 0, 'success resets the failure counter');

update staff set active = false where id = '00000000-0000-0000-0000-00000000b002';
select results_eq(
  $$ select accepted from register_pin_attempt('00000000-0000-0000-0000-00000000b002', true) $$,
  $$ values (false) $$, 'inactive staff are never accepted'
);
select results_eq(
  $$ select accepted from register_pin_attempt('00000000-0000-0000-0000-0000000000ff', true) $$,
  $$ values (false) $$, 'unknown staff are never accepted'
);
select function_privs_are('public', 'register_pin_attempt', array['uuid', 'boolean', 'integer', 'integer'],
  'authenticated', array[]::text[], 'browser users cannot call register_pin_attempt');

select * from finish();
rollback;
