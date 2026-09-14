-- POS money-path functions: shifts, walk-ins, arrivals, no-shows, close, void (spec/pos.md).
begin;
select plan(65);

-- ── Isolation from a used local database (all rolled back) ──────────────────
update sessions set status = 'voided', closed_at = greatest(now(), opened_at), closed_by = opened_by,
  total_cents = 0, gst_cents = 0, pricing_snapshot = '{}', void_reason = 'pgtap isolation'
where status = 'open';
update shifts s set closed_at = now(), closed_by = s.staff_id,
  expected_cash_cents = t.e, counted_cash_cents = t.e, cash_variance_cents = 0,
  pos_card_total_cents = t.c, terminal_card_total_cents = t.c, card_variance_cents = 0
from (select id, (pos_shift_totals(id)).expected_cash_cents as e, (pos_shift_totals(id)).pos_card_total_cents as c
      from shifts where closed_at is null) t
where s.id = t.id;

-- ── Fixtures ────────────────────────────────────────────────────────────────
insert into auth.users (id, email, aud, role) values
  ('00000000-0000-0000-0000-00000000a001', 'owner@test.local', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-00000000a002', 'cashier@test.local', 'authenticated', 'authenticated');
insert into staff (id, auth_user_id, display_name, role, pin_hash) values
  ('00000000-0000-0000-0000-00000000b001', '00000000-0000-0000-0000-00000000a001', 'Owner', 'superadmin', 'x'),
  ('00000000-0000-0000-0000-00000000b002', '00000000-0000-0000-0000-00000000a002', 'Cashier', 'cashier', 'x');

insert into resources (id, resource_type_id, label, sort, active) values
  ('00000000-0000-0000-0000-0000000cc001', (select id from resource_types where key = 'billiard'), 'pgTAP POS A', 900, true),
  ('00000000-0000-0000-0000-0000000cc002', (select id from resource_types where key = 'billiard'), 'pgTAP POS B', 901, true),
  ('00000000-0000-0000-0000-0000000cc003', (select id from resource_types where key = 'billiard'), 'pgTAP POS C', 902, true),
  ('00000000-0000-0000-0000-0000000cc004', (select id from resource_types where key = 'billiard'), 'pgTAP POS D', 903, true),
  ('00000000-0000-0000-0000-0000000cc005', (select id from resource_types where key = 'billiard'), 'pgTAP POS off', 904, false);

insert into customers (id, name, email) values
  ('00000000-0000-0000-0000-00000000c001', 'Member Active', 'm1@test.local'),
  ('00000000-0000-0000-0000-00000000c002', 'Member Lapsed', 'm2@test.local'),
  ('00000000-0000-0000-0000-00000000c003', 'Guest', 'guest@test.local');
insert into members (id, customer_id, tier_id, status) values
  ('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-00000000c001', (select id from membership_tiers where name = 'Gold'), 'active'),
  ('00000000-0000-0000-0000-00000000d002', '00000000-0000-0000-0000-00000000c002', (select id from membership_tiers where name = 'Gold'), 'past_due');
insert into member_balance_ledger (member_id, delta_minutes, kind, stripe_invoice_id)
values ('00000000-0000-0000-0000-00000000d001', 60, 'grant', 'in_pgtap_pos');

insert into referral_codes (id, code, discount_type, discount_value, max_uses, valid_until) values
  ('00000000-0000-0000-0000-0000000ee001', 'PQ2345', 'fixed', 500, 1, null),
  ('00000000-0000-0000-0000-0000000ee002', 'PQ2346', 'percent', 1000, 5, now() - interval '1 day');

-- Bookings on resource B (Wed 2030-01-16, AEDT = +11).
insert into bookings (id, resource_id, customer_id, period, status, total_cents, gst_cents, pricing_snapshot) values
  ('00000000-0000-0000-0000-0000000ff001', '00000000-0000-0000-0000-0000000cc002', '00000000-0000-0000-0000-00000000c003',
   '[2030-01-16 16:00+11, 2030-01-16 17:00+11)', 'confirmed', 3000, 273, '{}'),
  ('00000000-0000-0000-0000-0000000ff002', '00000000-0000-0000-0000-0000000cc002', '00000000-0000-0000-0000-00000000c003',
   '[2030-01-16 18:00+11, 2030-01-16 19:00+11)', 'confirmed', 3000, 273, '{}');

create function pg_temp.pay(p_closed timestamptz, p_total int, p_method text, p_tendered int default null, p_extra jsonb default '{}')
returns jsonb language sql as $$
  select jsonb_build_object(
    'closedAt', p_closed, 'pricing', '{"test": true}'::jsonb,
    'computedTotalCents', p_total, 'totalCents', p_total, 'gstCents', (p_total * 2 + 11) / 22,
    'method', p_method, 'tenderedCents', p_tendered
  ) || p_extra;
$$;

-- ── Walk-ins ────────────────────────────────────────────────────────────────
select throws_like(
  $$ select pos_open_walk_in('00000000-0000-0000-0000-0000000cc001', '00000000-0000-0000-0000-00000000b002', '2030-01-16 09:59+11') $$,
  'RG:outside_opening_hours:%', 'walk-in before opening is refused'
);
select throws_like(
  $$ select pos_open_walk_in('00000000-0000-0000-0000-0000000cc001', '00000000-0000-0000-0000-00000000b002', '2030-01-16 20:45+11') $$,
  'RG:outside_opening_hours:%', 'walk-in within 15 minutes of closing is refused'
);
select throws_like(
  $$ select pos_open_walk_in('00000000-0000-0000-0000-0000000cc005', '00000000-0000-0000-0000-00000000b002', '2030-01-16 14:30+11') $$,
  'RG:resource_unavailable:%', 'inactive resource is refused'
);
select throws_like(
  $$ select pos_open_walk_in('00000000-0000-0000-0000-0000000cc002', '00000000-0000-0000-0000-00000000b002', '2030-01-16 16:30+11') $$,
  'RG:resource_booked:%', 'walk-in on a resource booked right now is refused'
);
select lives_ok(
  $$ select pos_open_walk_in('00000000-0000-0000-0000-0000000cc001', '00000000-0000-0000-0000-00000000b002', '2030-01-16 20:44+11') $$,
  'walk-in at 20:44 is allowed'
);
select throws_like(
  $$ select pos_open_walk_in('00000000-0000-0000-0000-0000000cc001', '00000000-0000-0000-0000-00000000b002', '2030-01-16 20:44+11') $$,
  'RG:resource_in_use:%', 'second walk-in on the same resource is refused'
);
select is(
  (select count(*) from audit_log where action = 'session.open' and after ->> 'resource_id' = '00000000-0000-0000-0000-0000000cc001'),
  1::bigint, 'walk-in open is audited'
);

create temp table t_sessions (name text primary key, id uuid);
grant all on t_sessions to public;
insert into t_sessions
select 'a1', id from sessions where resource_id = '00000000-0000-0000-0000-0000000cc001' and status = 'open';

-- ── Closing needs a shift for real money ────────────────────────────────────
select throws_like(
  $$ select pos_close_session((select id from t_sessions where name = 'a1'), '00000000-0000-0000-0000-00000000b002',
       pg_temp.pay('2030-01-16 20:59+11', 750, 'cash', 1000)) $$,
  'RG:no_open_shift:%', 'cash close without an open shift is refused'
);

-- ── Shifts ──────────────────────────────────────────────────────────────────
select lives_ok($$ select pos_open_shift('00000000-0000-0000-0000-00000000b002', 20000) $$, 'open the till with a $200 float');
select throws_like($$ select pos_open_shift('00000000-0000-0000-0000-00000000b001', 0) $$, 'RG:shift_already_open:%', 'only one open shift venue-wide');
select throws_like($$ select pos_open_shift('00000000-0000-0000-0000-00000000b001', -1) $$, 'RG:invalid:%', 'negative float refused');

-- ── Close validation ────────────────────────────────────────────────────────
select throws_like(
  $$ select pos_close_session((select id from t_sessions where name = 'a1'), '00000000-0000-0000-0000-00000000b002',
       pg_temp.pay('2030-01-16 20:59+11', 750, 'cash', 1000, '{"totalCents": 700, "gstCents": 64}')) $$,
  'RG:total_mismatch:%', 'charging a different total without an override is refused'
);
select throws_like(
  $$ select pos_close_session((select id from t_sessions where name = 'a1'), '00000000-0000-0000-0000-00000000b002',
       pg_temp.pay('2030-01-16 20:59+11', 750, 'cash', 1000, '{"gstCents": 1}')) $$,
  'RG:gst_mismatch:%', 'wrong GST is refused'
);
select throws_like(
  $$ select pos_close_session((select id from t_sessions where name = 'a1'), '00000000-0000-0000-0000-00000000b002',
       pg_temp.pay('2030-01-16 20:59+11', 750, 'cash', 700)) $$,
  'RG:tendered_insufficient:%', 'cash less than the total is refused'
);
select throws_like(
  $$ select pos_close_session((select id from t_sessions where name = 'a1'), '00000000-0000-0000-0000-00000000b002',
       pg_temp.pay('2030-01-16 20:59+11', 750, null)) $$,
  'RG:invalid:%', 'a positive total needs a tender'
);
select throws_like(
  $$ select pos_close_session((select id from t_sessions where name = 'a1'), '00000000-0000-0000-0000-00000000b002',
       pg_temp.pay('2030-01-16 20:00+11', 750, 'cash', 1000)) $$,
  'RG:invalid:%', 'close time before open time is refused'
);
select is((select status from sessions where id = (select id from t_sessions where name = 'a1')), 'open', 'failed closes leave the session open');
select is((select count(*) from payments where session_id = (select id from t_sessions where name = 'a1')), 0::bigint, 'failed closes leave no payment');

-- ── Successful cash close ───────────────────────────────────────────────────
create temp table t_result as
select pos_close_session((select id from t_sessions where name = 'a1'), '00000000-0000-0000-0000-00000000b002',
  pg_temp.pay('2030-01-16 20:59+11', 750, 'cash', 1000)) as r;
grant all on t_result to public;

select is((select (r ->> 'changeCents')::int from t_result), 250, 'change is $2.50');
select ok((select (r ->> 'receiptNo') is not null from t_result), 'a receipt number is issued');
select is(
  (select closed_in_shift_id from sessions where id = (select id from t_sessions where name = 'a1')),
  (select id from shifts where closed_at is null), 'the session records the shift it was closed in'
);
select results_eq(
  $$ select status, total_cents, gst_cents, closed_by from sessions where id = (select id from t_sessions where name = 'a1') $$,
  $$ values ('closed', 750, 68, '00000000-0000-0000-0000-00000000b002'::uuid) $$,
  'session closed with total and GST'
);
select results_eq(
  $$ select method, amount_cents, staff_id from payments where session_id = (select id from t_sessions where name = 'a1') $$,
  $$ values ('cash', 750, '00000000-0000-0000-0000-00000000b002'::uuid) $$,
  'cash payment recorded against the operator'
);
select is(
  (select amount_cents from cash_movements where payment_id = (select (r ->> 'paymentId')::uuid from t_result)),
  750, 'cash sale movement recorded'
);
select is(
  (select count(*) from audit_log where action = 'session.close' and entity_id = (select id::text from t_sessions where name = 'a1')),
  1::bigint, 'close is audited'
);
select throws_like(
  $$ select pos_close_session((select id from t_sessions where name = 'a1'), '00000000-0000-0000-0000-00000000b002',
       pg_temp.pay('2030-01-16 20:59+11', 750, 'cash', 1000)) $$,
  'RG:session_not_open:%', 'a session cannot be closed twice'
);

-- ── Referral codes ──────────────────────────────────────────────────────────
insert into t_sessions select 'c1', (pos_open_walk_in('00000000-0000-0000-0000-0000000cc003', '00000000-0000-0000-0000-00000000b002', '2030-01-16 10:00+11')).id;
insert into t_sessions select 'd1', (pos_open_walk_in('00000000-0000-0000-0000-0000000cc004', '00000000-0000-0000-0000-00000000b002', '2030-01-16 10:00+11')).id;

select lives_ok(
  $$ select pos_close_session((select id from t_sessions where name = 'c1'), '00000000-0000-0000-0000-00000000b002',
       pg_temp.pay('2030-01-16 11:00+11', 2200, 'card_terminal', null,
         '{"referralCodeId": "00000000-0000-0000-0000-0000000ee001", "discountCents": 500, "externalRef": "T-0001"}')) $$,
  'close with the last use of a referral code'
);
select is((select uses_count from referral_codes where id = '00000000-0000-0000-0000-0000000ee001'), 1, 'referral use counted');
select results_eq(
  $$ select discount_cents from referral_redemptions where session_id = (select id from t_sessions where name = 'c1') $$,
  $$ values (500) $$, 'redemption recorded with the discount'
);
select is((select external_ref from payments where session_id = (select id from t_sessions where name = 'c1')), 'T-0001', 'terminal receipt reference stored');
select throws_like(
  $$ select pos_close_session((select id from t_sessions where name = 'd1'), '00000000-0000-0000-0000-00000000b002',
       pg_temp.pay('2030-01-16 11:00+11', 2200, 'card_terminal', null,
         '{"referralCodeId": "00000000-0000-0000-0000-0000000ee001", "discountCents": 500}')) $$,
  'RG:referral_invalid:%', 'a used-up referral code is refused'
);
select throws_like(
  $$ select pos_close_session((select id from t_sessions where name = 'd1'), '00000000-0000-0000-0000-00000000b002',
       pg_temp.pay('2030-01-16 11:00+11', 2430, 'card_terminal', null,
         '{"referralCodeId": "00000000-0000-0000-0000-0000000ee002", "discountCents": 270}')) $$,
  'RG:referral_invalid:%', 'an expired referral code is refused'
);
select results_eq(
  $$ select (select status from sessions where id = (select id from t_sessions where name = 'd1')),
            (select uses_count from referral_codes where id = '00000000-0000-0000-0000-0000000ee001') $$,
  $$ values ('open', 1) $$, 'refused referral closes roll back completely'
);

-- ── Members and free play ───────────────────────────────────────────────────
select throws_like(
  $$ select pos_close_session((select id from t_sessions where name = 'd1'), '00000000-0000-0000-0000-00000000b002',
       pg_temp.pay('2030-01-16 11:00+11', 2430, 'cash', 5000, '{"memberId": "00000000-0000-0000-0000-00000000d002"}')) $$,
  'RG:member_inactive:%', 'a past-due member gets no benefits'
);
select throws_ok(
  $$ select pos_close_session((select id from t_sessions where name = 'd1'), '00000000-0000-0000-0000-00000000b002',
       pg_temp.pay('2030-01-16 11:00+11', 0, 'free', null, '{"memberId": "00000000-0000-0000-0000-00000000d001", "freeMinutes": 61}')) $$,
  '23514', null, 'using more free minutes than the balance is refused'
);
select is((select count(*) from payments where session_id = (select id from t_sessions where name = 'd1')), 0::bigint, 'no payment after a refused balance use');
select lives_ok(
  $$ select pos_close_session((select id from t_sessions where name = 'd1'), '00000000-0000-0000-0000-00000000b002',
       pg_temp.pay('2030-01-16 11:00+11', 0, 'free', null, '{"memberId": "00000000-0000-0000-0000-00000000d001", "freeMinutes": 60}')) $$,
  'member uses 60 free minutes for a $0 close'
);
select is((select balance_minutes from member_balances where member_id = '00000000-0000-0000-0000-00000000d001'), 0, 'balance reduced to 0');
select results_eq(
  $$ select method, amount_cents, shift_id is not null from payments where session_id = (select id from t_sessions where name = 'd1') $$,
  $$ values ('free', 0, false) $$, 'a $0 walk-in records a free payment without touching the till'
);

-- ── Overrides ───────────────────────────────────────────────────────────────
insert into t_sessions select 'c2', (pos_open_walk_in('00000000-0000-0000-0000-0000000cc003', '00000000-0000-0000-0000-00000000b002', '2030-01-16 12:00+11')).id;
select throws_like(
  $$ select pos_close_session((select id from t_sessions where name = 'c2'), '00000000-0000-0000-0000-00000000b002',
       pg_temp.pay('2030-01-16 13:00+11', 2000, 'cash', 2000, '{"computedTotalCents": 2700, "override": {"reason": "cue broken"}}')) $$,
  'RG:invalid:%', 'an override without an approver is refused'
);
select lives_ok(
  $$ select pos_close_session((select id from t_sessions where name = 'c2'), '00000000-0000-0000-0000-00000000b002',
       pg_temp.pay('2030-01-16 13:00+11', 2000, 'cash', 2000,
         '{"computedTotalCents": 2700, "override": {"reason": "cue broken", "approverStaffId": "00000000-0000-0000-0000-00000000b001"}}')) $$,
  'an approved override closes at the new price'
);
select results_eq(
  $$ select original_cents, new_cents, reason, requested_by, approved_by from price_overrides
     where session_id = (select id from t_sessions where name = 'c2') $$,
  $$ values (2700, 2000, 'cue broken', '00000000-0000-0000-0000-00000000b002'::uuid, '00000000-0000-0000-0000-00000000b001'::uuid) $$,
  'override recorded with requester and approver'
);
select is(
  (select approver_staff_id from audit_log where action = 'session.close_with_override' and entity_id = (select id::text from t_sessions where name = 'c2')),
  '00000000-0000-0000-0000-00000000b001'::uuid, 'override audit names the approver'
);

-- ── Paid in / out and totals ────────────────────────────────────────────────
select throws_like($$ select pos_cash_movement('00000000-0000-0000-0000-00000000b002', 'paid_out', 500, ' ') $$, 'RG:invalid:%', 'paid out needs a reason');
select lives_ok($$ select pos_cash_movement('00000000-0000-0000-0000-00000000b002', 'paid_out', 500, 'milk for staff room') $$, 'paid out $5');
select results_eq(
  $$ select * from pos_shift_totals((select id from shifts where closed_at is null)) $$,
  $$ values (20000 + 750 + 2000 - 500, 2200) $$,
  'expected cash = float + cash sales − paid out; card total = card sales'
);

-- ── Bookings: arrive, no-show, prepaid close ────────────────────────────────
select throws_like(
  $$ select pos_arrive_booking('00000000-0000-0000-0000-0000000ff001', '00000000-0000-0000-0000-00000000b002', '2030-01-16 15:40+11') $$,
  'RG:booking_not_current:%', 'check-in more than 15 minutes early is refused'
);
select lives_ok(
  $$ select pos_arrive_booking('00000000-0000-0000-0000-0000000ff001', '00000000-0000-0000-0000-00000000b002', '2030-01-16 15:50+11') $$,
  'check-in 10 minutes early'
);
select is((select status from bookings where id = '00000000-0000-0000-0000-0000000ff001'), 'arrived', 'booking is arrived');
select throws_like(
  $$ select pos_mark_no_show('00000000-0000-0000-0000-0000000ff001', '00000000-0000-0000-0000-00000000b002', '2030-01-16 16:30+11') $$,
  'RG:booking_not_confirmed:%', 'an arrived booking cannot be a no-show'
);
select throws_like(
  $$ select pos_mark_no_show('00000000-0000-0000-0000-0000000ff002', '00000000-0000-0000-0000-00000000b002', '2030-01-16 18:14+11') $$,
  'RG:no_show_too_early:%', 'no-show before the 15-minute hold is refused'
);
select lives_ok(
  $$ select pos_mark_no_show('00000000-0000-0000-0000-0000000ff002', '00000000-0000-0000-0000-00000000b002', '2030-01-16 18:15+11') $$,
  'no-show at the end of the hold'
);
select throws_like(
  $$ select pos_void_session((select id from sessions where booking_id = '00000000-0000-0000-0000-0000000ff001'),
       '00000000-0000-0000-0000-00000000b001', 'mistake', '2030-01-16 16:10+11') $$,
  'RG:cannot_void_booking_session:%', 'an open booking session cannot be voided'
);
select lives_ok(
  $$ select pos_close_session((select id from sessions where booking_id = '00000000-0000-0000-0000-0000000ff001'),
       '00000000-0000-0000-0000-00000000b002', pg_temp.pay('2030-01-16 16:58+11', 0, null)) $$,
  'prepaid booking closes with nothing to pay'
);
select results_eq(
  $$ select (select status from bookings where id = '00000000-0000-0000-0000-0000000ff001'),
            (select count(*) from payments p join sessions s on s.id = p.session_id where s.booking_id = '00000000-0000-0000-0000-0000000ff001') $$,
  $$ values ('completed', 0::bigint) $$, 'booking completed with no extra payment'
);

-- ── Void ────────────────────────────────────────────────────────────────────
insert into t_sessions select 'a2', (pos_open_walk_in('00000000-0000-0000-0000-0000000cc001', '00000000-0000-0000-0000-00000000b002', '2030-01-17 12:00+11')).id;
select lives_ok(
  $$ select pos_void_session((select id from t_sessions where name = 'a2'), '00000000-0000-0000-0000-00000000b002', 'opened wrong table', '2030-01-17 12:01+11') $$,
  'an open walk-in opened by mistake can be voided'
);
select lives_ok(
  $$ select pos_void_session((select id from t_sessions where name = 'a1'), '00000000-0000-0000-0000-00000000b001', 'customer complaint') $$,
  'void a closed cash session'
);
select results_eq(
  $$ select r.amount_cents, m.amount_cents from refunds r join cash_movements m on m.refund_id = r.id
     where r.payment_id = (select (r ->> 'paymentId')::uuid from t_result) $$,
  $$ values (750, -750) $$, 'full refund with a matching cash-out movement'
);
select throws_like(
  $$ select pos_void_session((select id from t_sessions where name = 'a1'), '00000000-0000-0000-0000-00000000b001', 'again') $$,
  'RG:session_voided:%', 'a session cannot be voided twice'
);
select lives_ok(
  $$ select pos_void_session((select id from t_sessions where name = 'd1'), '00000000-0000-0000-0000-00000000b001', 'wrong member') $$,
  'void a session paid with free minutes'
);
select is((select balance_minutes from member_balances where member_id = '00000000-0000-0000-0000-00000000d001'), 60, 'free minutes are returned on void');

-- ── Closing the till ────────────────────────────────────────────────────────
insert into t_sessions select 'c3', (pos_open_walk_in('00000000-0000-0000-0000-0000000cc003', '00000000-0000-0000-0000-00000000b002', '2030-01-17 13:00+11')).id;
select throws_like(
  $$ select pos_close_shift('00000000-0000-0000-0000-00000000b002', 22250, 2200) $$,
  'RG:sessions_open:%', 'the till cannot close while sessions are open'
);
select pos_void_session((select id from t_sessions where name = 'c3'), '00000000-0000-0000-0000-00000000b002', 'test', '2030-01-17 13:01+11');
-- Expected cash: 20000 + 750 + 2000 − 500 − 750 (refund) = 21500. Counted $30 short; card exact.
select results_eq(
  $$ select expected_cash_cents, cash_variance_cents, pos_card_total_cents, card_variance_cents, flagged, closed_by
     from pos_close_shift('00000000-0000-0000-0000-00000000b002', 18500, 2200) $$,
  $$ values (21500, -3000, 2200, 0, true, '00000000-0000-0000-0000-00000000b002'::uuid) $$,
  'close shift computes variances and flags a $30 cash shortfall (threshold $20)'
);
select throws_like($$ select pos_close_shift('00000000-0000-0000-0000-00000000b002', 0, 0) $$, 'RG:no_open_shift:%', 'no shift left to close');

select function_privs_are('public', 'pos_close_session', array['uuid', 'uuid', 'jsonb'], 'authenticated', array[]::text[],
  'browser users cannot call pos_close_session');

select * from finish();
rollback;
