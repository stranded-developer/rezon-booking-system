-- D106: a simulator session for several people — one lead booking plus a linked booking per extra
-- person, each on their own simulator, moving together. Everything here is rolled back.
begin;
select plan(26);

update public.opening_hours set open_time = '10:00', close_time = '21:00', closed = false;
update public.venue_settings set booking_window_days = 7;

-- ── Fixtures ────────────────────────────────────────────────────────────────
insert into auth.users (id, email, aud, role) values ('00000000-0000-0000-0000-00000009a001', 'g-owner@test.local', 'authenticated', 'authenticated');
insert into staff (id, auth_user_id, display_name, role, pin_hash) values
  ('00000000-0000-0000-0000-00000009b001', '00000000-0000-0000-0000-00000009a001', 'G Owner', 'superadmin', 'x');
insert into resource_types (id, key, name, base_rate_cents, min_minutes, sort) values
  ('00000000-0000-0000-0000-000000090001', 'pgtap_group_sim', 'pgTAP Group Sim', 6000, 15, 990),
  ('00000000-0000-0000-0000-000000090002', 'pgtap_group_tbl', 'pgTAP Group Table', 2500, 15, 991);
insert into resources (id, resource_type_id, label, sort, active) values
  ('00000000-0000-0000-0000-00000009c001', '00000000-0000-0000-0000-000000090001', 'G Sim 1', 1, true),
  ('00000000-0000-0000-0000-00000009c002', '00000000-0000-0000-0000-000000090001', 'G Sim 2', 2, true),
  ('00000000-0000-0000-0000-00000009c003', '00000000-0000-0000-0000-000000090001', 'G Sim 3', 3, true),
  ('00000000-0000-0000-0000-00000009c004', '00000000-0000-0000-0000-000000090001', 'G Sim off', 4, false),
  ('00000000-0000-0000-0000-00000009c005', '00000000-0000-0000-0000-000000090002', 'G Table', 1, true);
insert into experiences (id, key, resource_type_id, name, minutes, price_cents) values
  ('00000000-0000-0000-0000-00000009e001', 'pgtap_group_race', '00000000-0000-0000-0000-000000090001', 'G Race', 30, 3500);

-- A group hold: lead on Sim 1, plus the extra simulators given; $35 a head.
create function pg_temp.g(extras text[], start text default '2030-01-15T12:00:00+11:00', extra jsonb default '{}') returns jsonb language sql as $$
  select jsonb_build_object(
    'resourceId', '00000000-0000-0000-0000-00000009c001',
    'experienceId', '00000000-0000-0000-0000-00000009e001',
    'extraResourceIds', to_jsonb(extras),
    'startsAt', start::timestamptz, 'endsAt', start::timestamptz + interval '30 minutes',
    'now', '2030-01-14T09:00:00+11:00',
    'customer', jsonb_build_object('name', 'Group Gail', 'email', 'gail-group@test.local'),
    'pricing', '{"discountCents": 0}'::jsonb,
    'totalCents', 3500 * (1 + cardinality(extras)), 'gstCents', private.gst_of(3500 * (1 + cardinality(extras))),
    'cancelTokenHash', repeat('b', 64)
  ) || extra
$$;
create temp table ids (name text primary key, id uuid);
create function pg_temp.id(n text) returns uuid language sql as $$ select id from ids where name = n $$;
create function pg_temp.statuses(lead uuid) returns text[] language sql as $$
  select array_agg(status order by resource_id) from public.bookings where id = lead or group_lead_id = lead
$$;

-- ── Holding a group ─────────────────────────────────────────────────────────
insert into ids select 'g3', (booking_hold(pg_temp.g(array['00000000-0000-0000-0000-00000009c002', '00000000-0000-0000-0000-00000009c003']))).id;
select is((select party_size from bookings where id = pg_temp.id('g3')), 3, 'the lead knows the group is 3');
select results_eq(
  $$ select resource_id::text, status, total_cents, party_size, customer_id = (select customer_id from bookings where id = pg_temp.id('g3'))
       from bookings where group_lead_id = pg_temp.id('g3') order by resource_id $$,
  $$ values ('00000000-0000-0000-0000-00000009c002', 'held', 0, 1, true), ('00000000-0000-0000-0000-00000009c003', 'held', 0, 1, true) $$,
  'one linked booking per extra person, on their own simulator, same customer, no price of its own');
select is((select total_cents from bookings where id = pg_temp.id('g3')), 10500, 'the lead carries the whole price');
select is((select count(*)::int from bookings where group_lead_id = pg_temp.id('g3') and period = (select period from bookings where id = pg_temp.id('g3'))
           and hold_expires_at = (select hold_expires_at from bookings where id = pg_temp.id('g3'))), 2,
  'the linked bookings share the time and the hold''s expiry');
select throws_like($$ select booking_hold(pg_temp.g(array['00000000-0000-0000-0000-00000009c002'], '2030-01-15T12:00:00+11:00',
                     '{"resourceId": "00000000-0000-0000-0000-00000009c003"}')) $$,
  'RG:slot_taken:%one of those simulators%', 'a group can''t take a simulator someone else holds');
select is((select count(*)::int from bookings b join resources r on r.id = b.resource_id
            where r.resource_type_id = '00000000-0000-0000-0000-000000090001' and b.status = 'held'), 3,
  '…and nothing of the failed group is left behind');

-- ── What a group can't be ───────────────────────────────────────────────────
select throws_like($$ select booking_hold(pg_temp.g(array['00000000-0000-0000-0000-00000009c001'], '2030-01-15T13:00:00+11:00')) $$,
  'RG:invalid:Each person needs a simulator of their own', 'the lead''s simulator can''t be counted twice');
select throws_like($$ select booking_hold(pg_temp.g(array['00000000-0000-0000-0000-00000009c002', '00000000-0000-0000-0000-00000009c002'], '2030-01-15T13:00:00+11:00')) $$,
  'RG:invalid:Each person needs a simulator of their own', 'nor any other simulator');
select throws_like($$ select booking_hold(pg_temp.g(array['00000000-0000-0000-0000-00000009c004'], '2030-01-15T13:00:00+11:00')) $$,
  'RG:resource_unavailable:%', 'a switched-off simulator can''t be part of a group');
select throws_like($$ select booking_hold(pg_temp.g(array['00000000-0000-0000-0000-00000009c005'], '2030-01-15T13:00:00+11:00')) $$,
  'RG:resource_unavailable:%', 'a billiard table can''t be part of a simulator group');
select throws_like($$ select booking_hold(pg_temp.g(array['00000000-0000-0000-0000-00000009c002'], '2030-01-15T13:00:00+11:00',
                     '{"experienceId": null}')) $$,
  'RG:invalid:Only a session on the simulators can be booked for several people', 'groups are for simulator sessions only');

-- ── Confirming and cancelling move the whole group ──────────────────────────
select throws_like($$ update bookings set status = 'confirmed', hold_expires_at = null where group_lead_id = pg_temp.id('g3') $$,
  'RG:part_of_group:%', 'a linked booking can''t be confirmed on its own');
select lives_ok($$ select booking_confirm(pg_temp.id('g3'), '{"method": "stripe", "paymentIntentId": "pi_pgtap_group", "amountPaidCents": 10500}') $$,
  'paying for the lead');
select is(pg_temp.statuses(pg_temp.id('g3')), array['confirmed', 'confirmed', 'confirmed'], 'confirms everyone');
select is((select count(*)::int from payments p join bookings b on b.id = p.booking_id where b.id = pg_temp.id('g3') or b.group_lead_id = pg_temp.id('g3')), 1,
  'with one payment, on the lead');
select throws_like($$ select booking_cancel((select id from bookings where group_lead_id = pg_temp.id('g3') limit 1), '{"now": "2030-01-14T09:00:00+11:00", "refundCents": 0}') $$,
  'RG:part_of_group:%', 'one person''s simulator can''t be cancelled on its own');
select is((select (booking_cancel_quote(pg_temp.id('g3'), '2030-01-14T09:00:00+11:00') ->> 'refundCents')::int), 10500,
  'cancelling the lead refunds the whole group');
select lives_ok($$ select booking_cancel(pg_temp.id('g3'), '{"now": "2030-01-14T09:00:00+11:00", "refundCents": 10500, "stripeRefundId": "re_pgtap_group"}') $$,
  'the customer cancels the group');
select is(pg_temp.statuses(pg_temp.id('g3')), array['cancelled', 'cancelled', 'cancelled'], 'everyone is cancelled');
select is((select count(*)::int from bookings where group_lead_id = pg_temp.id('g3') and cancelled_at is not null and refund_cents = 0), 2,
  'the linked bookings are cancelled with no refund of their own');

-- ── A hold that runs out frees every simulator ──────────────────────────────
insert into ids select 'g2', (booking_hold(pg_temp.g(array['00000000-0000-0000-0000-00000009c002'], '2030-01-15T14:00:00+11:00'))).id;
select is(booking_release_hold(pg_temp.id('g2')), 'expired', 'releasing the lead''s hold');
select is(pg_temp.statuses(pg_temp.id('g2')), array['expired', 'expired'], 'releases the whole group');

-- ── Checking a group in ─────────────────────────────────────────────────────
insert into ids select 'g2b', (booking_hold(pg_temp.g(array['00000000-0000-0000-0000-00000009c003'], '2030-01-15T15:00:00+11:00'))).id;
select booking_confirm(pg_temp.id('g2b'), '{"method": "stripe", "paymentIntentId": "pi_pgtap_group2", "amountPaidCents": 7000}');
select lives_ok($$ select pos_arrive_booking(pg_temp.id('g2b'), '00000000-0000-0000-0000-00000009b001', '2030-01-15T14:50:00+11:00') $$,
  'checking the lead in');
select results_eq(
  $$ select b.status, s.resource_id::text from bookings b join sessions s on s.booking_id = b.id
      where b.id = pg_temp.id('g2b') or b.group_lead_id = pg_temp.id('g2b') order by s.resource_id $$,
  $$ values ('arrived', '00000000-0000-0000-0000-00000009c001'), ('arrived', '00000000-0000-0000-0000-00000009c003') $$,
  'opens a session on every simulator of the group');

-- ── D110: nothing before the day bookings open ──────────────────────────────
update public.venue_settings set bookings_open_from = '2030-01-16';
select throws_like($$ select booking_hold(pg_temp.g(array[]::text[], '2030-01-15T16:00:00+11:00')) $$,
  'RG:not_open_yet:Bookings start on Wed 16 Jan 2030', 'a booking before the opening day is refused, saying when');
select lives_ok($$ select booking_hold(pg_temp.g(array[]::text[], '2030-01-16T16:00:00+11:00')) $$, 'the opening day itself can be booked');

select * from finish();
rollback;
