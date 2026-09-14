-- Membership billing lifecycle functions.
begin;
select plan(45);

insert into auth.users (id, email, aud, role) values ('00000000-0000-0000-0000-00000000a001', 'owner@test.local', 'authenticated', 'authenticated');
insert into staff (id, auth_user_id, display_name, role, pin_hash) values
  ('00000000-0000-0000-0000-00000000b001', '00000000-0000-0000-0000-00000000a001', 'Owner', 'superadmin', 'x');

-- Tiers with Stripe prices for this test (rolled back).
update membership_tiers set stripe_price_id = 'price_pgtap_' || lower(name::text) where name in ('Silver', 'Gold', 'Diamond');
create temp table tiers as select name::text as name, id from membership_tiers where name in ('Silver', 'Gold', 'Diamond');
grant select on tiers to public;
create function pg_temp.tier(n text) returns uuid language sql as $$ select id from tiers where name = n $$;

-- ── Checkout prepare ────────────────────────────────────────────────────────
select throws_like(
  $$ select membership_checkout_prepare('00000000-0000-0000-0000-00000000b001', 'No Email', '', null, pg_temp.tier('Gold')) $$,
  'RG:invalid:%', 'a membership needs an email'
);
update membership_tiers set stripe_price_id = null where name = 'Silver';
select throws_like(
  $$ select membership_checkout_prepare('00000000-0000-0000-0000-00000000b001', 'X', 'x@test.local', null, pg_temp.tier('Silver')) $$,
  'RG:tier_unavailable:%', 'a tier without a Stripe price cannot be sold'
);
update membership_tiers set stripe_price_id = 'price_pgtap_silver' where name = 'Silver';

create temp table t as select membership_checkout_prepare('00000000-0000-0000-0000-00000000b001', 'Mia Member', 'Mia@Test.Local', '0400111222', pg_temp.tier('Gold')) as r;
grant select on t to public;
create function pg_temp.m() returns uuid language sql as $$ select (r ->> 'memberId')::uuid from t $$;
select results_eq(
  $$ select status, tier_id from members where id = pg_temp.m() $$,
  $$ values ('pending', pg_temp.tier('Gold')) $$,
  'new customer gets a pending Gold member'
);
select is(
  (select (membership_checkout_prepare('00000000-0000-0000-0000-00000000b001', 'Mia', 'mia@test.local', null, pg_temp.tier('Silver')) ->> 'memberId')::uuid),
  pg_temp.m(), 'the same email (any case) reuses the pending member'
);
select is((select tier_id from members where id = pg_temp.m()), pg_temp.tier('Silver'), '…with the newly chosen tier');
select is((select count(*) from customers where email = 'mia@test.local'), 1::bigint, 'no duplicate customer');

-- ── First invoice ───────────────────────────────────────────────────────────
select is(
  membership_apply_invoice(pg_temp.m(), '{"invoiceId": "in_pgtap_1", "subscriptionId": "sub_pgtap_1", "amountPaidCents": 10000, "periodEnd": "2030-02-16T00:00:00Z"}') ->> 'grantedMinutes',
  '60', 'first payment grants 60 minutes'
);
select results_eq(
  $$ select status, stripe_subscription_id, current_period_end from members where id = pg_temp.m() $$,
  $$ values ('active', 'sub_pgtap_1', '2030-02-16T00:00:00Z'::timestamptz) $$,
  'member active with subscription and period end'
);
select results_eq(
  $$ select method, amount_cents, gst_cents, shift_id from payments where external_ref = 'in_pgtap_1' $$,
  $$ values ('stripe', 10000, 909, null::uuid) $$,
  'membership payment recorded with GST, not on the till'
);
select is(
  membership_apply_invoice(pg_temp.m(), '{"invoiceId": "in_pgtap_1", "subscriptionId": "sub_pgtap_1", "amountPaidCents": 10000}') ->> 'applied',
  'false', 'the same invoice delivered twice has no second effect'
);
select is((select balance_minutes from member_balances where member_id = pg_temp.m()), 60, 'balance still 60');
select throws_like(
  $$ select membership_checkout_prepare('00000000-0000-0000-0000-00000000b001', 'Mia', 'mia@test.local', null, pg_temp.tier('Gold')) $$,
  'RG:already_member:%', 'an active member cannot start a second membership'
);

-- ── Renewals and the cap ────────────────────────────────────────────────────
update membership_tiers set max_balance_minutes = 100 where name = 'Silver';
select is(
  membership_apply_invoice(pg_temp.m(), '{"invoiceId": "in_pgtap_2", "subscriptionId": "sub_pgtap_1", "amountPaidCents": 10000}') ->> 'grantedMinutes',
  '40', 'renewal grant is limited by the balance cap (60 + 40 = 100)'
);
select is(
  membership_apply_invoice(pg_temp.m(), '{"invoiceId": "in_pgtap_3", "subscriptionId": "sub_pgtap_1", "amountPaidCents": 10000}') ->> 'grantedMinutes',
  '0', 'at the cap nothing is granted'
);
select is((select count(*) from member_balance_ledger where member_id = pg_temp.m() and kind = 'grant'), 2::bigint, 'no zero-minute ledger rows');
select is((select count(*) from payments where member_id = pg_temp.m()), 3::bigint, 'every paid invoice is recorded');
update membership_tiers set max_balance_minutes = 600 where name = 'Silver';

-- ── Tier change at renewal ──────────────────────────────────────────────────
select is(
  membership_change_tier(pg_temp.m(), '00000000-0000-0000-0000-00000000b001', pg_temp.tier('Diamond'), 'upgrade') ->> 'mode',
  'next_renewal', 'a paid member upgrades at the next renewal'
);
select results_eq(
  $$ select tier_id, pending_tier_id from members where id = pg_temp.m() $$,
  $$ values (pg_temp.tier('Silver'), pg_temp.tier('Diamond')) $$,
  'current tier unchanged until renewal'
);
select is(
  membership_apply_invoice(pg_temp.m(), '{"invoiceId": "in_pgtap_4", "subscriptionId": "sub_pgtap_1", "amountPaidCents": 30000}') ->> 'tierId',
  pg_temp.tier('Diamond')::text, 'renewal applies the pending tier'
);
select is((select pending_tier_id from members where id = pg_temp.m()), null, 'pending tier cleared');
select is(
  membership_change_tier(pg_temp.m(), '00000000-0000-0000-0000-00000000b001', pg_temp.tier('Diamond'), 'no-op') ->> 'mode',
  'cleared', 'choosing the current tier just clears any pending change'
);

-- ── Failed payment, recovery ────────────────────────────────────────────────
select is(membership_payment_failed(pg_temp.m(), 'sub_other'), 'active', 'a failure for another subscription is ignored');
select is(membership_payment_failed(pg_temp.m(), 'sub_pgtap_1'), 'past_due', 'a failed renewal cuts benefits off');
select is(
  (select count(*) from audit_log where action = 'member.status_change' and entity_id = pg_temp.m()::text and after ->> 'status' = 'past_due'),
  1::bigint, 'status change audited'
);
select is(
  membership_apply_invoice(pg_temp.m(), '{"invoiceId": "in_pgtap_5", "subscriptionId": "sub_pgtap_1", "amountPaidCents": 30000}') ->> 'status',
  'active', 'a recovered payment reinstates the member'
);

-- ── Subscription sync ───────────────────────────────────────────────────────
select is(
  membership_sync_subscription(pg_temp.m(), '{"subscriptionId": "sub_pgtap_1", "stripeStatus": "active", "cancelAtPeriodEnd": true, "periodEnd": "2030-06-16T00:00:00Z"}'),
  'cancelling', 'cancel at period end → cancelling'
);
select is(
  membership_apply_invoice(pg_temp.m(), '{"invoiceId": "in_pgtap_6", "subscriptionId": "sub_pgtap_1", "amountPaidCents": 30000}') ->> 'status',
  'cancelling', 'an invoice while cancelling keeps it cancelling'
);
select is(
  membership_sync_subscription(pg_temp.m(), '{"subscriptionId": "sub_pgtap_1", "stripeStatus": "active", "cancelAtPeriodEnd": false}'),
  'active', 'resuming → active'
);
select is(
  membership_sync_subscription(pg_temp.m(), '{"subscriptionId": "sub_old", "stripeStatus": "canceled"}'),
  'active', 'an old subscription being cancelled does not end the current membership'
);
select is(
  membership_sync_subscription(pg_temp.m(), '{"subscriptionId": "sub_pgtap_1", "stripeStatus": "past_due"}'),
  'past_due', 'Stripe past_due → past_due'
);
select is(
  membership_sync_subscription(pg_temp.m(), '{"subscriptionId": "sub_pgtap_1", "stripeStatus": "canceled"}'),
  'ended', 'subscription cancelled → ended'
);
select ok((select ended_at is not null from members where id = pg_temp.m()), 'ended_at recorded');
select throws_like(
  $$ select membership_change_tier(pg_temp.m(), '00000000-0000-0000-0000-00000000b001', pg_temp.tier('Gold'), 'x') $$,
  'RG:member_inactive:%', 'no tier changes after the membership ends'
);

-- ── Re-joining and forfeit ──────────────────────────────────────────────────
create temp table bal as select balance_minutes as b from member_balances where member_id = pg_temp.m();
grant select on bal to public;
select is(
  (select (membership_checkout_prepare('00000000-0000-0000-0000-00000000b001', 'Mia', 'mia@test.local', null, pg_temp.tier('Gold')) ->> 'status')),
  'ended', 'an ended member can start a new checkout and stays ended until paid'
);
select is(membership_forfeit_balances(now()), 0, 'nothing is forfeited within 30 days');
select is(
  membership_apply_invoice(pg_temp.m(), '{"invoiceId": "in_pgtap_7", "subscriptionId": "sub_pgtap_2", "amountPaidCents": 20000}') ->> 'status',
  'active', 're-joining with a new subscription reactivates the same member'
);
select results_eq(
  $$ select stripe_subscription_id, ended_at, tier_id from members where id = pg_temp.m() $$,
  $$ values ('sub_pgtap_2', null::timestamptz, pg_temp.tier('Gold')) $$,
  'new subscription, not ended, Gold'
);
select ok((select balance_minutes from member_balances where member_id = pg_temp.m()) >= (select b from bal), 'balance kept on re-joining (plus the new grant)');

select membership_sync_subscription(pg_temp.m(), '{"subscriptionId": "sub_pgtap_2", "stripeStatus": "canceled"}');
update members set ended_at = now() - interval '31 days' where id = pg_temp.m();
select is(membership_forfeit_balances(now()), 1, 'balance forfeited 31 days after ending');
select is((select balance_minutes from member_balances where member_id = pg_temp.m()), 0, 'balance is now 0');
select is(membership_forfeit_balances(now()), 0, 'forfeit is idempotent');

-- ── Complimentary tier change and first card ────────────────────────────────
create temp table comp as select * from admin_create_member('00000000-0000-0000-0000-00000000b001',
  jsonb_build_object('name', 'Comp', 'email', 'comp7@test.local', 'tierId', pg_temp.tier('Silver')), 'perk');
grant select on comp to public;
select is(
  membership_change_tier((select id from comp), '00000000-0000-0000-0000-00000000b001', pg_temp.tier('Gold'), 'upgrade') ->> 'mode',
  'immediate', 'a complimentary member changes tier immediately'
);
select lives_ok(
  $$ select membership_issue_first_card((select id from comp), '00000000-0000-0000-0000-00000000b001', repeat('c', 64)) $$,
  'the counter can issue the first card'
);
select throws_like(
  $$ select membership_issue_first_card((select id from comp), '00000000-0000-0000-0000-00000000b001', repeat('d', 64)) $$,
  'RG:card_exists:%', 'a second card must be a back office reissue'
);

select function_privs_are('public', 'membership_apply_invoice', array['uuid', 'jsonb'], 'authenticated', array[]::text[], 'browser users cannot apply invoices');

select * from finish();
rollback;
