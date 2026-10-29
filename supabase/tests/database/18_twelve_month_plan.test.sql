-- D114: a 12-month plan paid monthly. Its planned end is not a cancellation.
begin;
select plan(10);

insert into auth.users (id, email, aud, role) values ('00000000-0000-0000-0000-00000000a001', 'owner@test.local', 'authenticated', 'authenticated');
insert into staff (id, auth_user_id, display_name, role, pin_hash) values
  ('00000000-0000-0000-0000-00000000b001', '00000000-0000-0000-0000-00000000a001', 'Owner', 'superadmin', 'x');
update membership_tiers set stripe_price_id = 'price_pgtap_' || lower(name::text) where name in ('Silver', 'Gold', 'Diamond');

create temp table t as select membership_checkout_prepare('00000000-0000-0000-0000-00000000b001', 'Tess Term', 'tess@test.local', null,
  (select id from membership_tiers where name = 'Silver')) as r;
grant select on t to public;
create function pg_temp.m() returns uuid language sql as $$ select (r ->> 'memberId')::uuid from t $$;

select is(
  membership_apply_invoice(pg_temp.m(), '{"invoiceId": "in_term_1", "subscriptionId": "sub_term", "amountPaidCents": 10000, "periodEnd": "2030-02-16T00:00:00Z"}') ->> 'status',
  'active', 'the first payment activates the plan'
);
select is(
  membership_sync_subscription(pg_temp.m(), '{"subscriptionId": "sub_term", "stripeStatus": "active", "cancelAtPeriodEnd": false,
    "cancelAt": "2031-01-16T00:00:00Z", "termEndsAt": "2031-01-16T00:00:00Z", "periodEnd": "2030-02-16T00:00:00Z"}'),
  'active', 'Stripe stopping it at the end of the 12 months is not a cancellation'
);
select is((select term_ends_at from members where id = pg_temp.m()), '2031-01-16T00:00:00Z'::timestamptz, 'the end of the plan is recorded');
select is(
  membership_apply_invoice(pg_temp.m(), '{"invoiceId": "in_term_2", "subscriptionId": "sub_term", "amountPaidCents": 10000}') ->> 'status',
  'active', 'a monthly payment keeps it active'
);
select is(
  membership_sync_subscription(pg_temp.m(), '{"subscriptionId": "sub_term", "stripeStatus": "active", "cancelAtPeriodEnd": true,
    "cancelAt": "2030-03-16T00:00:00Z", "termEndsAt": "2031-01-16T00:00:00Z"}'),
  'cancelling', 'ended early by staff (at the period end) → cancelling'
);
select is(
  membership_sync_subscription(pg_temp.m(), '{"subscriptionId": "sub_term", "stripeStatus": "active", "cancelAtPeriodEnd": false,
    "cancelAt": "2030-03-16T00:00:00Z", "termEndsAt": "2031-01-16T00:00:00Z"}'),
  'cancelling', 'any end date other than the plan''s own is a cancellation'
);
select is(
  membership_sync_subscription(pg_temp.m(), '{"subscriptionId": "sub_term", "stripeStatus": "active", "cancelAtPeriodEnd": false,
    "cancelAt": "2031-01-16T00:00:00Z", "termEndsAt": "2031-01-16T00:00:00Z"}'),
  'active', 'back to the plan''s own end → active again'
);
select is(
  membership_sync_subscription(pg_temp.m(), '{"subscriptionId": "sub_term", "stripeStatus": "canceled", "cancelAt": "2031-01-16T00:00:00Z", "termEndsAt": "2031-01-16T00:00:00Z"}'),
  'ended', 'after the last payment Stripe ends it → ended'
);
select is(
  membership_sync_subscription(pg_temp.m(), '{"subscriptionId": "sub_rolling", "stripeStatus": "active", "cancelAt": "2032-01-16T00:00:00Z"}'),
  'cancelling', 'rejoined on a rolling plan: an end date set is a cancellation, as before'
);
select is((select term_ends_at from members where id = pg_temp.m()), null::timestamptz, '…and the old plan''s end is cleared');

select * from finish();
rollback;
