-- Memberships paid for at the counter (D61) and the optional reason on complimentary members (D62).
begin;
select plan(34);

-- Isolation (rolled back): the single till must be free for this test.
update public.sessions set status = 'voided', closed_at = greatest(now(), opened_at), closed_by = opened_by,
  total_cents = 0, gst_cents = 0, pricing_snapshot = '{}', void_reason = 'pgtap isolation'
where status = 'open';
update public.shifts set closed_at = now(), closed_by = staff_id, expected_cash_cents = 0, counted_cash_cents = 0,
  cash_variance_cents = 0, pos_card_total_cents = 0, terminal_card_total_cents = 0, card_variance_cents = 0
where closed_at is null;

insert into auth.users (id, email, aud, role) values ('00000000-0000-0000-0000-00000000a101', 'till@test.local', 'authenticated', 'authenticated');
insert into public.staff (id, auth_user_id, display_name, role, pin_hash)
values ('00000000-0000-0000-0000-00000000b101', '00000000-0000-0000-0000-00000000a101', 'Till', 'cashier', 'x');

create temp table t_ids as select
  (select id from public.membership_tiers where name = 'Silver') as silver,
  (select id from public.membership_tiers where name = 'Gold') as gold;
grant select on t_ids to public;

-- ── The till has to be open ─────────────────────────────────────────────────
select throws_like(
  $$ select pos_sell_membership('00000000-0000-0000-0000-00000000b101',
       jsonb_build_object('name', 'No Till', 'email', 'notill@test.local', 'tierId', (select silver from t_ids),
                          'months', 1, 'method', 'cash', 'amountCents', 10000)) $$,
  'RG:no_shift:%', 'the till must be open to sell a membership');

select pos_open_shift('00000000-0000-0000-0000-00000000b101', 20000);

-- ── What it refuses ─────────────────────────────────────────────────────────
select throws_like(
  $$ select pos_sell_membership('00000000-0000-0000-0000-00000000b101',
       jsonb_build_object('name', 'Bad Months', 'email', 'bad@test.local', 'tierId', (select silver from t_ids),
                          'months', 2, 'method', 'cash', 'amountCents', 20000)) $$,
  'RG:invalid:Choose 1, 3, 6, 9 or 12 months', 'only whole terms are sold');

select throws_like(
  $$ select pos_sell_membership('00000000-0000-0000-0000-00000000b101',
       jsonb_build_object('name', 'Bad Method', 'email', 'bad@test.local', 'tierId', (select silver from t_ids),
                          'months', 1, 'method', 'stripe', 'amountCents', 10000)) $$,
  'RG:invalid:Pay by cash or card at the counter', 'only money taken at the counter');

select throws_like(
  $$ select pos_sell_membership('00000000-0000-0000-0000-00000000b101',
       jsonb_build_object('name', 'Wrong Price', 'email', 'bad@test.local', 'tierId', (select silver from t_ids),
                          'months', 3, 'method', 'cash', 'amountCents', 10000)) $$,
  'RG:amount_mismatch:This membership costs 30000 cents', 'the price is recomputed here, not trusted');

select throws_like(
  $$ select pos_sell_membership('00000000-0000-0000-0000-00000000b101',
       jsonb_build_object('email', 'noname@test.local', 'tierId', (select silver from t_ids),
                          'months', 1, 'method', 'cash', 'amountCents', 10000)) $$,
  'RG:invalid:Name is required', 'a new member needs a name');

select throws_like(
  $$ select pos_sell_membership('00000000-0000-0000-0000-00000000b101',
       jsonb_build_object('name', 'No Contact', 'tierId', (select silver from t_ids),
                          'months', 1, 'method', 'cash', 'amountCents', 10000)) $$,
  'RG:invalid:An email or phone number is required', 'a new member needs an email or phone');

-- ── Selling three months of Silver for cash ─────────────────────────────────
create temp table t_sale as select pos_sell_membership('00000000-0000-0000-0000-00000000b101',
  jsonb_build_object('name', 'Cash Member', 'email', 'cash@test.local', 'tierId', (select silver from t_ids),
                     'months', 3, 'method', 'cash', 'amountCents', 30000, 'qrTokenHash', 'hash-counter-1',
                     'now', '2030-03-04T02:00:00Z')) as r;
grant select on t_sale to public;

select is((select (r ->> 'newMember')::boolean from t_sale), true, 'a new member is created');
select is((select (r ->> 'amountCents')::int from t_sale), 30000, '3 x $100 taken');
select is((select (r ->> 'gstCents')::int from t_sale), 2727, 'GST is the price divided by eleven');
select is((select (r ->> 'minutesGranted')::int from t_sale), 180, '3 months of free play granted at once');
select is(
  (select (r ->> 'currentPeriodEnd')::timestamptz from t_sale), '2030-06-04T02:00:00Z'::timestamptz,
  'the membership runs three months from the sale');

select is(
  (select status from public.members where id = (select (r ->> 'memberId')::uuid from t_sale)), 'active',
  'the member is active');
select is(
  (select stripe_subscription_id from public.members where id = (select (r ->> 'memberId')::uuid from t_sale)), null,
  'nothing is billed online, so nothing can fail to renew');
select is(
  (select balance_minutes from public.member_balances where member_id = (select (r ->> 'memberId')::uuid from t_sale)), 180,
  'the balance shows the granted minutes');

select results_eq(
  $$ select method, amount_cents, gst_cents, member_id is not null, session_id is null, shift_id is not null
     from public.payments where id = (select (r ->> 'paymentId')::uuid from t_sale) $$,
  $$ values ('cash', 30000, 2727, true, true, true) $$,
  'the payment is against the member, on the open shift');

select is(
  (select amount_cents from public.cash_movements where payment_id = (select (r ->> 'paymentId')::uuid from t_sale)), 30000,
  'cash goes into the till');

select is(
  (select count(*)::int from public.audit_log where action = 'member.sell_counter'
     and entity_id = (select r ->> 'memberId' from t_sale)), 1,
  'the sale is audited');

-- ── One grant per payment ───────────────────────────────────────────────────
select throws_ok(
  $$ insert into public.member_balance_ledger (member_id, delta_minutes, kind, payment_id)
     select (r ->> 'memberId')::uuid, 60, 'grant', (r ->> 'paymentId')::uuid from t_sale $$,
  '23505', null, 'the same payment cannot grant minutes twice');

select throws_ok(
  $$ insert into public.member_balance_ledger (member_id, delta_minutes, kind)
     select (r ->> 'memberId')::uuid, 60, 'grant' from t_sale $$,
  '23514', null, 'a grant still needs a source: an invoice or a payment');

-- ── Card terminal, and renewing early adds to the time left ────────────────
create temp table t_renew as select pos_sell_membership('00000000-0000-0000-0000-00000000b101',
  jsonb_build_object('customerId', (select customer_id from public.members where id = (select (r ->> 'memberId')::uuid from t_sale)),
                     'tierId', (select gold from t_ids), 'months', 1, 'method', 'card_terminal',
                     'amountCents', 20000, 'now', '2030-04-04T02:00:00Z')) as r;
grant select on t_renew to public;

select is((select (r ->> 'newMember')::boolean from t_renew), false, 'the same member is renewed, not duplicated');
select is(
  (select (r ->> 'currentPeriodEnd')::timestamptz from t_renew), '2030-07-04T02:00:00Z'::timestamptz,
  'renewing early adds a month to the time already paid for');
select is(
  (select tier_id from public.members where id = (select (r ->> 'memberId')::uuid from t_renew)), (select gold from t_ids),
  'the tier can change at renewal');
select is(
  (select count(*)::int from public.cash_movements where payment_id = (select (r ->> 'paymentId')::uuid from t_renew)), 0,
  'a card payment puts nothing in the cash drawer');

-- ── The balance cap still holds ─────────────────────────────────────────────
create temp table t_cap as select pos_sell_membership('00000000-0000-0000-0000-00000000b101',
  jsonb_build_object('customerId', (select customer_id from public.members where id = (select (r ->> 'memberId')::uuid from t_sale)),
                     'tierId', (select gold from t_ids), 'months', 12, 'method', 'cash',
                     'amountCents', 240000, 'now', '2030-04-05T02:00:00Z')) as r;
grant select on t_cap to public;

-- Gold now carries up to 1200 minutes (ten months of 4 sessions), and the cap still binds.
select is(
  (select balance_minutes from public.member_balances where member_id = (select (r ->> 'memberId')::uuid from t_sale)), 1200,
  'free play never goes over the tier cap');

-- ── An online membership is not touched here ────────────────────────────────
insert into public.customers (id, name, email) values ('00000000-0000-0000-0000-00000000c101', 'Online Member', 'online@test.local');
insert into public.members (id, customer_id, tier_id, status, stripe_subscription_id, current_period_end)
values ('00000000-0000-0000-0000-00000000d101', '00000000-0000-0000-0000-00000000c101', (select silver from t_ids), 'active', 'sub_test_1', '2030-01-01T00:00:00Z');

select throws_like(
  $$ select pos_sell_membership('00000000-0000-0000-0000-00000000b101',
       jsonb_build_object('customerId', '00000000-0000-0000-0000-00000000c101', 'tierId', (select silver from t_ids),
                          'months', 1, 'method', 'cash', 'amountCents', 10000)) $$,
  'RG:stripe_billed:%', 'a membership billed online cannot be sold over the counter');

-- ── Expiry ──────────────────────────────────────────────────────────────────
-- Scoped to this test's own member: a used database has other memberships in it.
select is(membership_expire_venue('2030-06-01T00:00:00Z') >= 0, true, 'expiry runs');
select is(
  (select status from public.members where id = (select (r ->> 'memberId')::uuid from t_sale)), 'active',
  'nothing expires while the period is still running');

-- Paid up to 2030-07-04, then 12 more months bought early: 2031-07-04.
select is(membership_expire_venue('2031-08-01T00:00:00Z') >= 1, true, 'the counter membership expires once its period is over');
select results_eq(
  $$ select status, ended_at from public.members where id = (select (r ->> 'memberId')::uuid from t_sale) $$,
  $$ values ('ended', '2031-07-04T02:00:00Z'::timestamptz) $$,
  'it ends exactly when it was paid up to');

select is(
  (select status from public.members where id = '00000000-0000-0000-0000-00000000d101'), 'active',
  'an online membership past its period is left to Stripe, not expired here');

-- ── Complimentary members no longer need a reason (D62) ─────────────────────
select lives_ok(
  $$ select admin_create_member('00000000-0000-0000-0000-00000000b101',
       jsonb_build_object('name', 'No Reason', 'email', 'noreason@test.local',
                          'tierId', (select silver from t_ids), 'qrTokenHash', 'hash-no-reason'), null) $$,
  'a complimentary member can be created without a reason');
select is(
  (select reason from public.audit_log where action = 'member.create_complimentary'
     and after ->> 'name' = 'No Reason'), null,
  'the audit row still records who and when, with no reason given');

-- ── Privileges ──────────────────────────────────────────────────────────────
select function_privs_are('public', 'pos_sell_membership', array['uuid', 'jsonb'], 'anon', array[]::text[],
  'visitors cannot sell themselves a membership');
select function_privs_are('public', 'membership_expire_venue', array['timestamp with time zone'], 'authenticated', array[]::text[],
  'signed-in users cannot expire memberships');

select * from finish();
rollback;
