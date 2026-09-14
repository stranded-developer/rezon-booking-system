-- Back office: automatic config audit, member admin, tier price, partial refunds.
begin;
select plan(35);

-- Isolation (rolled back): finish any open work in a used database.
update sessions set status = 'voided', closed_at = greatest(now(), opened_at), closed_by = opened_by,
  total_cents = 0, gst_cents = 0, pricing_snapshot = '{}', void_reason = 'pgtap isolation'
where status = 'open';
update shifts s set closed_at = now(), closed_by = s.staff_id,
  expected_cash_cents = t.e, counted_cash_cents = t.e, cash_variance_cents = 0,
  pos_card_total_cents = t.c, terminal_card_total_cents = t.c, card_variance_cents = 0
from (select id, (pos_shift_totals(id)).expected_cash_cents as e, (pos_shift_totals(id)).pos_card_total_cents as c
      from shifts where closed_at is null) t
where s.id = t.id;

insert into auth.users (id, email, aud, role) values
  ('00000000-0000-0000-0000-00000000a001', 'owner@test.local', 'authenticated', 'authenticated');
insert into staff (id, auth_user_id, display_name, role, pin_hash) values
  ('00000000-0000-0000-0000-00000000b001', '00000000-0000-0000-0000-00000000a001', 'Owner', 'superadmin', 'x');

create function pg_temp.as_api(p_actor text, p_reason text default null) returns void language sql as $$
  select set_config('request.headers',
    json_build_object('x-rg-actor', p_actor, 'x-rg-reason-b64', encode(convert_to(p_reason, 'UTF8'), 'base64'))::text, true);
$$;
create function pg_temp.no_api() returns void language sql as $$ select set_config('request.headers', '', true); $$;

-- ── Automatic audit ─────────────────────────────────────────────────────────
-- Only look at audit rows written by this test (a used database already has many).
create temp table t_mark as select coalesce(max(id), 0) as id from audit_log;
grant select on t_mark to public;
select pg_temp.no_api();
insert into resources (id, resource_type_id, label, sort)
values ('00000000-0000-0000-0000-0000000dd001', (select id from resource_types where key = 'vr'), 'pgTAP VR X', 990);
select is((select count(*) from audit_log where entity = 'resources' and entity_id = '00000000-0000-0000-0000-0000000dd001'), 0::bigint,
  'writes outside the API (migrations, seed, psql) are not audited');

select pg_temp.as_api('00000000-0000-0000-0000-00000000b001', 'Rate rise — Sept');
update resource_types set base_rate_cents = 3500 where key = 'billiard';
select results_eq(
  $$ select actor_staff_id, action, (before ->> 'base_rate_cents')::int, (after ->> 'base_rate_cents')::int, reason
     from audit_log where entity = 'resource_types' and action = 'resource_types.update' order by id desc limit 1 $$,
  $$ values ('00000000-0000-0000-0000-00000000b001'::uuid, 'resource_types.update', 3000, 3500, 'Rate rise — Sept') $$,
  'an API update is audited with actor, before/after and a UTF-8 reason'
);

select pg_temp.as_api('00000000-0000-0000-0000-00000000b001');
update resource_types set base_rate_cents = 3500 where key = 'billiard';
select is((select count(*) from audit_log where entity = 'resource_types' and action = 'resource_types.update' and id > (select id from t_mark)), 1::bigint,
  'an update that changes nothing is not audited');

insert into rate_bands (id, resource_type_id, days_of_week, start_time, end_time, rate_cents)
values ('00000000-0000-0000-0000-0000000dd002', (select id from resource_types where key = 'billiard'), '{6,7}', '10:00', '21:00', 4000);
select is((select action from audit_log where entity_id = '00000000-0000-0000-0000-0000000dd002'), 'rate_bands.insert', 'inserts are audited');
select is((select reason from audit_log where entity_id = '00000000-0000-0000-0000-0000000dd002'), null, 'no reason header → null reason');
delete from rate_bands where id = '00000000-0000-0000-0000-0000000dd002';
select is((select count(*) from audit_log where entity_id = '00000000-0000-0000-0000-0000000dd002' and action = 'rate_bands.delete' and after is null and before is not null), 1::bigint,
  'deletes are audited with the before image');

update opening_hours set close_time = '22:00' where day_of_week = 5;
select is((select entity_id from audit_log where action = 'opening_hours.update' order by id desc limit 1), '5', 'opening hours are keyed by day of week');
update venue_settings set business_name = 'Raceground Pty Ltd', abn = '12345678901' where id = 1;
select is((select after ->> 'abn' from audit_log where action = 'venue_settings.update' order by id desc limit 1), '12345678901', 'venue settings changes are audited');

insert into referral_codes (id, discount_type, discount_value, max_uses) values ('00000000-0000-0000-0000-0000000dd003', 'percent', 1000, 3);
update referral_codes set uses_count = 1 where id = '00000000-0000-0000-0000-0000000dd003';
select is((select count(*) from audit_log where entity_id = '00000000-0000-0000-0000-0000000dd003'), 1::bigint,
  'a use count bump alone is not a config change');
update referral_codes set active = false where id = '00000000-0000-0000-0000-0000000dd003';
select is((select count(*) from audit_log where entity_id = '00000000-0000-0000-0000-0000000dd003' and action = 'referral_codes.update'), 1::bigint,
  'deactivating a code is audited');

select pg_temp.as_api('not-a-uuid');
update resources set label = 'pgTAP VR Y' where id = '00000000-0000-0000-0000-0000000dd001';
select is((select actor_staff_id from audit_log where entity_id = '00000000-0000-0000-0000-0000000dd001' order by id desc limit 1), null,
  'a malformed actor header does not break the write; actor is recorded as unknown');
select pg_temp.no_api();

-- ── Complimentary member ────────────────────────────────────────────────────
select throws_like(
  $$ select admin_create_member('00000000-0000-0000-0000-00000000b001',
       jsonb_build_object('name', 'Comp', 'tierId', (select id from membership_tiers where name = 'Gold')), 'staff perk') $$,
  'RG:invalid:%', 'a member needs an email or phone'
);
select throws_like(
  $$ select admin_create_member('00000000-0000-0000-0000-00000000b001',
       jsonb_build_object('name', 'Comp', 'email', 'comp@test.local', 'tierId', (select id from membership_tiers where name = 'Gold')), ' ') $$,
  'RG:invalid:%', 'a complimentary membership needs a reason'
);
create temp table t_member as
select * from admin_create_member('00000000-0000-0000-0000-00000000b001',
  jsonb_build_object('name', 'Comp Member', 'email', 'comp@test.local', 'tierId', (select id from membership_tiers where name = 'Diamond'),
                     'qrTokenHash', repeat('a', 64), 'validUntil', '2031-01-01T00:00:00Z'),
  'staff perk');
grant select on t_member to public;
select results_eq(
  $$ select status, member_no ~ '^RG-[0-9]{6}$', current_period_end from t_member $$,
  $$ values ('active', true, '2031-01-01T00:00:00Z'::timestamptz) $$,
  'complimentary member is active with a member number and end date'
);
select is((select reason from audit_log where action = 'member.create_complimentary' and entity_id = (select id::text from t_member)), 'staff perk',
  'complimentary membership audited with its reason');

-- ── Balance adjustments ─────────────────────────────────────────────────────
select is(admin_adjust_balance((select id from t_member), '00000000-0000-0000-0000-00000000b001', 90, 'goodwill'), 90, 'add 90 minutes');
select is(admin_adjust_balance((select id from t_member), '00000000-0000-0000-0000-00000000b001', -30, 'correction'), 60, 'remove 30 minutes');
select throws_ok(
  $$ select admin_adjust_balance((select id from t_member), '00000000-0000-0000-0000-00000000b001', -61, 'too much') $$,
  '23514', null, 'cannot take the balance below zero'
);
select throws_like(
  $$ select admin_adjust_balance((select id from t_member), '00000000-0000-0000-0000-00000000b001', 10, '') $$,
  'RG:invalid:%', 'adjustments need a reason'
);
select throws_like(
  $$ select admin_adjust_balance((select id from t_member), '00000000-0000-0000-0000-00000000b001', 0, 'nothing') $$,
  'RG:invalid:%', 'a zero adjustment is refused'
);
select results_eq(
  $$ select (before ->> 'balance_minutes')::int, (after ->> 'balance_minutes')::int, reason from audit_log
     where action = 'member.balance_adjust' and entity_id = (select id::text from t_member) order by id $$,
  $$ values (0, 90, 'goodwill'), (90, 60, 'correction') $$,
  'adjustments are audited with before and after balances'
);

-- ── Card reissue ────────────────────────────────────────────────────────────
select throws_like(
  $$ select admin_reissue_qr((select id from t_member), '00000000-0000-0000-0000-00000000b001', 'short', 'lost') $$,
  'RG:invalid:%', 'reissue needs a sha256 hash'
);
select lives_ok(
  $$ select admin_reissue_qr((select id from t_member), '00000000-0000-0000-0000-00000000b001', repeat('b', 64), 'lost card') $$,
  'reissue a card'
);
select is((select qr_token_hash from members where id = (select id from t_member)), repeat('b', 64), 'the old card stops working');
select is((select count(*) from audit_log where action = 'member.qr_reissue' and entity_id = (select id::text from t_member) and before is null and after is null),
  1::bigint, 'reissue is audited without exposing the hash');

-- ── Tier price ──────────────────────────────────────────────────────────────
select throws_like(
  $$ select admin_set_tier_price((select id from membership_tiers where name = 'Silver'), '00000000-0000-0000-0000-00000000b001', 10000, 'same') $$,
  'RG:invalid:%', 'setting the same price is refused'
);
select is(
  (select monthly_price_cents from admin_set_tier_price((select id from membership_tiers where name = 'Silver'), '00000000-0000-0000-0000-00000000b001', 12000, 'cost increase')),
  12000, 'tier price changed'
);
select is((select amount_cents from tier_prices where tier_id = (select id from membership_tiers where name = 'Silver') order by effective_from desc, created_at desc limit 1),
  12000, 'price history recorded');

-- ── Partial refunds ─────────────────────────────────────────────────────────
select pos_open_shift('00000000-0000-0000-0000-00000000b001', 10000);
insert into sessions (id, resource_id, kind, opened_at, opened_by)
values ('00000000-0000-0000-0000-0000000dd010', '00000000-0000-0000-0000-0000000dd001', 'walk_in', '2030-01-16 12:00+11', '00000000-0000-0000-0000-00000000b001');
select pos_close_session('00000000-0000-0000-0000-0000000dd010', '00000000-0000-0000-0000-00000000b001',
  jsonb_build_object('closedAt', '2030-01-16 13:00+11', 'pricing', '{}'::jsonb, 'computedTotalCents', 5000, 'totalCents', 5000,
                     'gstCents', 455, 'method', 'cash', 'tenderedCents', 5000));
create temp table t_pay as select id from payments where session_id = '00000000-0000-0000-0000-0000000dd010';
grant select on t_pay to public;

select lives_ok(
  $$ select pos_refund_payment((select id from t_pay), '00000000-0000-0000-0000-00000000b001', 2000, 'one controller broken') $$,
  'partial refund of $20'
);
select results_eq(
  $$ select r.amount_cents, m.amount_cents from refunds r join cash_movements m on m.refund_id = r.id where r.payment_id = (select id from t_pay) $$,
  $$ values (2000, -2000) $$, 'cash partial refund takes cash out of the till'
);
select throws_like(
  $$ select pos_refund_payment((select id from t_pay), '00000000-0000-0000-0000-00000000b001', 3001, 'too much') $$,
  'RG:refund_exceeds_payment:%', 'cannot refund more than what is left'
);
select lives_ok(
  $$ select pos_refund_payment((select id from t_pay), '00000000-0000-0000-0000-00000000b001', 3000, 'rest of it') $$,
  'refund the remaining $30'
);
select is((select count(*) from audit_log where action = 'payment.refund' and entity_id = (select id::text from t_pay)), 2::bigint, 'refunds are audited');
select throws_like(
  $$ select pos_refund_payment((select id from t_pay), '00000000-0000-0000-0000-00000000b001', 2000, '') $$,
  'RG:invalid:%', 'refunds need a reason'
);

select function_privs_are('public', 'pos_refund_payment', array['uuid', 'uuid', 'integer', 'text'], 'authenticated', array[]::text[],
  'browser users cannot refund');

select * from finish();
rollback;
