-- Online booking functions: hold, expiry, referral reservations, confirm, cancel (spec/booking-site.md).
-- "now" is passed in: Monday 2030-01-14 09:00 Sydney (AEDT, +11). Bookings are on Tue 2030-01-15.
begin;
select plan(82);

-- ── Fixtures (rolled back) ──────────────────────────────────────────────────
insert into auth.users (id, email, aud, role) values ('00000000-0000-0000-0000-00000000a001', 'owner@test.local', 'authenticated', 'authenticated');
insert into staff (id, auth_user_id, display_name, role, pin_hash) values
  ('00000000-0000-0000-0000-00000000b001', '00000000-0000-0000-0000-00000000a001', 'Owner', 'superadmin', 'x');

insert into resources (id, resource_type_id, label, sort, active) values
  ('00000000-0000-0000-0000-0000000cc101', (select id from resource_types where key = 'billiard'), 'pgTAP BK A', 910, true),
  ('00000000-0000-0000-0000-0000000cc102', (select id from resource_types where key = 'billiard'), 'pgTAP BK B', 911, true),
  ('00000000-0000-0000-0000-0000000cc103', (select id from resource_types where key = 'billiard'), 'pgTAP BK off', 912, false);

insert into customers (id, name, email) values
  ('00000000-0000-0000-0000-00000000c101', 'Mem Active', 'bk-m1@test.local'),
  ('00000000-0000-0000-0000-00000000c102', 'Mem Lapsed', 'bk-m2@test.local');
insert into members (id, customer_id, tier_id, status) values
  ('00000000-0000-0000-0000-00000000d101', '00000000-0000-0000-0000-00000000c101', (select id from membership_tiers where name = 'Gold'), 'active'),
  ('00000000-0000-0000-0000-00000000d102', '00000000-0000-0000-0000-00000000c102', (select id from membership_tiers where name = 'Gold'), 'past_due');
insert into member_balance_ledger (member_id, delta_minutes, kind, stripe_invoice_id)
values ('00000000-0000-0000-0000-00000000d101', 90, 'grant', 'in_pgtap_bk');

insert into referral_codes (id, code, discount_type, discount_value, max_uses, valid_until) values
  ('00000000-0000-0000-0000-0000000ee101', 'BK2345', 'fixed', 500, 1, null),
  ('00000000-0000-0000-0000-0000000ee102', 'BK2346', 'percent', 1000, 5, '2030-01-01T00:00:00Z');

-- A valid guest hold for resource A, Tue 12:00–13:00, $30.00; merge in changes.
create function pg_temp.p(extra jsonb default '{}') returns jsonb language sql as $$
  select jsonb_build_object(
    'resourceId', '00000000-0000-0000-0000-0000000cc101',
    'startsAt', '2030-01-15T12:00:00+11:00', 'endsAt', '2030-01-15T13:00:00+11:00',
    'now', '2030-01-14T09:00:00+11:00',
    'customer', jsonb_build_object('name', 'Gina Guest', 'email', 'Gina.BK@Test.Local'),
    'pricing', '{"discountCents": 0}'::jsonb, 'totalCents', 3000, 'gstCents', 273,
    'cancelTokenHash', repeat('a', 64)
  ) || extra
$$;
create function pg_temp.bal() returns int language sql as $$
  select balance_minutes from member_balances where member_id = '00000000-0000-0000-0000-00000000d101'
$$;
create temp table ids (name text primary key, id uuid);
grant all on ids to public;
create function pg_temp.id(n text) returns uuid language sql as $$ select id from ids where name = n $$;

-- ── Validation ──────────────────────────────────────────────────────────────
select throws_like($$ select booking_hold(pg_temp.p('{"endsAt": "2030-01-15T12:00:00+11:00"}')) $$, 'RG:invalid:%', 'end must be after start');
select throws_like($$ select booking_hold(pg_temp.p('{"gstCents": 300}')) $$, 'RG:invalid:%', 'GST must be total / 11');
select throws_like($$ select booking_hold(pg_temp.p('{"cancelTokenHash": "abc"}')) $$, 'RG:invalid:%', 'a sha256 token hash is required');
select throws_like(
  $$ select booking_hold(pg_temp.p('{"memberId": "00000000-0000-0000-0000-00000000d101", "referralCodeId": "00000000-0000-0000-0000-0000000ee101"}')) $$,
  'RG:member_and_referral:%', 'membership and referral never combine');
select throws_like($$ select booking_hold(pg_temp.p('{"freeMinutes": 15}')) $$, 'RG:invalid:%', 'free minutes need a member');
select throws_like($$ select booking_hold(pg_temp.p('{"resourceId": "00000000-0000-0000-0000-0000000cc103"}')) $$,
  'RG:resource_unavailable:%', 'an inactive resource cannot be booked');
select throws_like($$ select booking_hold(pg_temp.p('{"startsAt": "2030-01-15T12:10:00+11:00", "endsAt": "2030-01-15T13:10:00+11:00"}')) $$,
  'RG:invalid_time:%', 'starts on the quarter hour');
select throws_like($$ select booking_hold(pg_temp.p('{"endsAt": "2030-01-15T12:50:00+11:00"}')) $$,
  'RG:invalid_time:%', 'lasts in 15-minute steps');
select throws_like($$ select booking_hold(pg_temp.p('{"now": "2030-01-15T11:31:00+11:00"}')) $$,
  'RG:too_soon:%', 'must start at least 30 minutes from now');
select lives_ok($$ select booking_release_hold((booking_hold(pg_temp.p('{"now": "2030-01-15T11:30:00+11:00"}'))).id) $$,
  'exactly 30 minutes ahead is allowed');
select throws_like($$ select booking_hold(pg_temp.p('{"startsAt": "2030-01-22T12:00:00+11:00", "endsAt": "2030-01-22T13:00:00+11:00"}')) $$,
  'RG:too_far_ahead:%', 'no further than 7 days ahead (venue dates)');
select lives_ok($$ select booking_release_hold((booking_hold(pg_temp.p('{"startsAt": "2030-01-21T20:00:00+11:00", "endsAt": "2030-01-21T21:00:00+11:00"}'))).id) $$,
  'the 7th day is bookable, ending exactly at close');
select throws_like($$ select booking_hold(pg_temp.p('{"startsAt": "2030-01-15T09:45:00+11:00", "endsAt": "2030-01-15T10:45:00+11:00"}')) $$,
  'RG:outside_opening_hours:%', 'cannot start before opening');
select throws_like($$ select booking_hold(pg_temp.p('{"startsAt": "2030-01-15T20:30:00+11:00", "endsAt": "2030-01-15T21:15:00+11:00"}')) $$,
  'RG:outside_opening_hours:%', 'cannot run past close');
update opening_hours set closed = true where day_of_week = 3;
select throws_like($$ select booking_hold(pg_temp.p('{"startsAt": "2030-01-16T12:00:00+11:00", "endsAt": "2030-01-16T13:00:00+11:00"}')) $$,
  'RG:outside_opening_hours:%', 'a closed day cannot be booked');
update opening_hours set closed = false where day_of_week = 3;
select throws_like($$ select booking_hold(pg_temp.p('{"memberId": "00000000-0000-0000-0000-00000000d102"}')) $$,
  'RG:member_inactive:%', 'a past_due member cannot book as a member');
select throws_like($$ select booking_hold(pg_temp.p('{"customer": {"name": "No Contact"}}')) $$,
  'RG:invalid:%', 'a guest needs an email or phone');

-- ── Guest hold ──────────────────────────────────────────────────────────────
insert into ids select 'guest', (booking_hold(pg_temp.p())).id;
select results_eq(
  $$ select status, hold_expires_at, total_cents, gst_cents, period from bookings where id = pg_temp.id('guest') $$,
  $$ values ('held', '2030-01-14T09:40:00+11:00'::timestamptz, 3000, 273, '[2030-01-15 12:00+11, 2030-01-15 13:00+11)'::tstzrange) $$,
  'guest hold: held for 30 min + 10 min grace, priced');
select is((select c.name from bookings b join customers c on c.id = b.customer_id where b.id = pg_temp.id('guest')), 'Gina Guest', 'guest customer created');
select throws_like($$ select booking_hold(pg_temp.p('{"startsAt": "2030-01-15T12:45:00+11:00", "endsAt": "2030-01-15T13:30:00+11:00"}')) $$,
  'RG:slot_taken:%', 'an overlapping hold is refused');
insert into ids select 'guest2', (booking_hold(pg_temp.p('{"startsAt": "2030-01-15T13:00:00+11:00", "endsAt": "2030-01-15T14:00:00+11:00", "customer": {"name": "Gina", "email": "gina.bk@test.local"}}'))).id;
select is((select count(*) from customers where lower(email::text) = 'gina.bk@test.local'), 1::bigint, 'the same email in any case reuses the customer');
insert into ids select 'phone', (booking_hold(pg_temp.p('{"startsAt": "2030-01-15T14:00:00+11:00", "endsAt": "2030-01-15T15:00:00+11:00", "customer": {"name": "Phil", "phone": "0400999888"}}'))).id;
select results_eq(
  $$ select c.email::text, c.phone from bookings b join customers c on c.id = b.customer_id where b.id = pg_temp.id('phone') $$,
  $$ values (null::text, '0400999888') $$, 'a phone-only guest is saved without email');
select is((select count(*) from audit_log where entity = 'bookings' and entity_id = pg_temp.id('guest')::text and action = 'booking.hold'), 1::bigint, 'hold is audited');

-- ── Member hold with free minutes ───────────────────────────────────────────
select throws_like(
  $$ select booking_hold(pg_temp.p('{"resourceId": "00000000-0000-0000-0000-0000000cc102", "memberId": "00000000-0000-0000-0000-00000000d101", "freeMinutes": 75}')) $$,
  'RG:invalid:%', 'free minutes cannot exceed the booking length');
select throws_like(
  $$ select booking_hold(pg_temp.p('{"resourceId": "00000000-0000-0000-0000-0000000cc102", "memberId": "00000000-0000-0000-0000-00000000d101", "freeMinutes": 105, "startsAt": "2030-01-15T10:00:00+11:00", "endsAt": "2030-01-15T12:00:00+11:00"}')) $$,
  'RG:insufficient_balance:%', 'free minutes cannot exceed the balance');
insert into ids select 'mem', (booking_hold(pg_temp.p('{"resourceId": "00000000-0000-0000-0000-0000000cc102", "memberId": "00000000-0000-0000-0000-00000000d101", "freeMinutes": 30, "totalCents": 1350, "gstCents": 123}'))).id;
select is(pg_temp.bal(), 60, 'free minutes are taken when the hold is made');
select is((select customer_id from bookings where id = pg_temp.id('mem')), '00000000-0000-0000-0000-00000000c101'::uuid, 'member booking uses the member''s customer');
select throws_like(
  $$ select booking_hold(pg_temp.p('{"resourceId": "00000000-0000-0000-0000-0000000cc102", "memberId": "00000000-0000-0000-0000-00000000d101", "freeMinutes": 61, "startsAt": "2030-01-15T15:00:00+11:00", "endsAt": "2030-01-15T17:00:00+11:00"}')) $$,
  'RG:insufficient_balance:%', 'minutes held by one booking cannot be spent again by another');

-- ── Expiry ──────────────────────────────────────────────────────────────────
select lives_ok($$ select expire_stale_holds('2030-01-14T09:39:59+11:00') $$, 'sweep before expiry');
select is((select status from bookings where id = pg_temp.id('mem')), 'held', 'a hold is kept until its expiry');
select lives_ok($$ select expire_stale_holds('2030-01-14T09:40:01+11:00') $$, 'sweep after expiry');
select is((select status from bookings where id = pg_temp.id('mem')), 'expired', 'the hold has expired');
select is(pg_temp.bal(), 90, 'expiry returns the free minutes');
select is((select count(*) from member_balance_ledger where booking_id = pg_temp.id('mem') and kind = 'return'), 1::bigint, '…with one return row');
select is(expire_stale_holds('2030-01-14T09:40:01+11:00') >= 0 and (select count(*) from member_balance_ledger where booking_id = pg_temp.id('mem') and kind = 'return') = 1, true,
  'sweeping again returns nothing twice');

-- Fresh holds for the rest (now 10:00, expire 10:40).
create function pg_temp.q(extra jsonb default '{}') returns jsonb language sql as $$ select pg_temp.p('{"now": "2030-01-14T10:00:00+11:00"}' || extra) $$;
delete from ids;
insert into ids select 'guest', (booking_hold(pg_temp.q())).id;
select is((select status from bookings where id = pg_temp.id('guest')), 'held', 'an expired slot can be held again');

-- ── Referral reservations ───────────────────────────────────────────────────
select throws_like($$ select booking_hold(pg_temp.q('{"referralCodeId": "00000000-0000-0000-0000-0000000ee102", "startsAt": "2030-01-15T16:00:00+11:00", "endsAt": "2030-01-15T17:00:00+11:00"}')) $$,
  'RG:referral_invalid:%', 'an expired referral code is refused');
insert into ids select 'ref', (booking_hold(pg_temp.q('{"referralCodeId": "00000000-0000-0000-0000-0000000ee101", "startsAt": "2030-01-15T16:00:00+11:00", "endsAt": "2030-01-15T17:00:00+11:00", "totalCents": 2500, "gstCents": 227, "pricing": {"discountCents": 500}}'))).id;
select throws_like($$ select booking_hold(pg_temp.q('{"referralCodeId": "00000000-0000-0000-0000-0000000ee101", "startsAt": "2030-01-15T17:00:00+11:00", "endsAt": "2030-01-15T18:00:00+11:00"}')) $$,
  'RG:referral_invalid:%', 'the last use is reserved by a live hold');
select throws_like($$ update referral_codes set uses_count = uses_count + 1 where id = '00000000-0000-0000-0000-0000000ee101' $$,
  'RG:referral_invalid:%', 'a POS close cannot take a use reserved by a live hold');
select is(booking_release_hold(pg_temp.id('ref')), 'expired', 'releasing a hold');
select is(booking_release_hold(pg_temp.id('ref')), 'expired', 'releasing again changes nothing');
delete from ids where name = 'ref';
insert into ids select 'ref', (booking_hold(pg_temp.q('{"referralCodeId": "00000000-0000-0000-0000-0000000ee101", "startsAt": "2030-01-15T16:00:00+11:00", "endsAt": "2030-01-15T17:00:00+11:00", "totalCents": 2500, "gstCents": 227, "pricing": {"discountCents": 500}}'))).id;
select is((select status from bookings where id = pg_temp.id('ref')), 'held', 'a released reservation can be used again');

-- ── Confirm ─────────────────────────────────────────────────────────────────
select throws_like($$ select booking_confirm(pg_temp.id('guest'), '{"method": "stripe", "paymentIntentId": "pi_bk_1", "amountPaidCents": 2999}') $$,
  'RG:amount_mismatch:%', 'the amount paid must equal the booking total');
select throws_like($$ select booking_confirm(pg_temp.id('guest'), '{"method": "stripe", "amountPaidCents": 3000}') $$,
  'RG:invalid:%', 'a Stripe confirmation needs the payment id');
select throws_like($$ select booking_confirm(pg_temp.id('guest'), '{"method": "free", "amountPaidCents": 3000}') $$,
  'RG:amount_mismatch:%', 'a paid booking cannot be confirmed as free');
select lives_ok($$ select booking_attach_checkout(pg_temp.id('guest'), 'cs_bk_1') $$, 'checkout session attached to the hold');
select is(booking_confirm(pg_temp.id('guest'), '{"method": "stripe", "paymentIntentId": "pi_bk_1", "amountPaidCents": 3000}') ->> 'confirmed', 'true', 'booking confirmed');
select results_eq(
  $$ select status, hold_expires_at, stripe_payment_intent_id, stripe_checkout_session_id from bookings where id = pg_temp.id('guest') $$,
  $$ values ('confirmed', null::timestamptz, 'pi_bk_1', 'cs_bk_1') $$, 'confirmed with Stripe ids, no hold expiry');
select results_eq(
  $$ select method, amount_cents, gst_cents, external_ref, shift_id from payments where booking_id = pg_temp.id('guest') $$,
  $$ values ('stripe', 3000, 273, 'pi_bk_1', null::uuid) $$, 'online payment recorded, not on the till');
select is(booking_confirm(pg_temp.id('guest'), '{"method": "stripe", "paymentIntentId": "pi_bk_1", "amountPaidCents": 3000}') ->> 'reason', 'duplicate', 'a repeated webhook is a duplicate');
select is((select count(*) from payments where booking_id = pg_temp.id('guest')), 1::bigint, '…and records no second payment');
select throws_like($$ select booking_attach_checkout(pg_temp.id('guest'), 'cs_bk_x') $$, 'RG:booking_not_held:%', 'a confirmed booking takes no new checkout');

select lives_ok($$ select booking_confirm(pg_temp.id('ref'), '{"method": "stripe", "paymentIntentId": "pi_bk_ref", "amountPaidCents": 2500}') $$, 'referral booking confirmed');
select results_eq(
  $$ select rc.uses_count, rr.discount_cents from referral_codes rc join referral_redemptions rr on rr.code_id = rc.id where rr.booking_id = pg_temp.id('ref') $$,
  $$ values (1, 500) $$, 'payment turns the reservation into a use with a redemption');

insert into ids select 'late', (booking_hold(pg_temp.q('{"startsAt": "2030-01-15T18:00:00+11:00", "endsAt": "2030-01-15T19:00:00+11:00"}'))).id;
select booking_release_hold(pg_temp.id('late'));
select throws_like($$ select booking_confirm(pg_temp.id('late'), '{"method": "stripe", "paymentIntentId": "pi_bk_late", "amountPaidCents": 3000}') $$,
  'RG:hold_expired:%', 'a payment for an expired hold is refused (the API refunds it)');

-- $0 member booking fully covered by free play, phone-only email capture.
insert into ids select 'free', (booking_hold(pg_temp.q('{"resourceId": "00000000-0000-0000-0000-0000000cc102", "memberId": "00000000-0000-0000-0000-00000000d101", "freeMinutes": 60, "totalCents": 0, "gstCents": 0}'))).id;
select is(booking_confirm(pg_temp.id('free'), '{"method": "free", "amountPaidCents": 0}') ->> 'confirmed', 'true', 'a $0 booking confirms without Stripe');
select results_eq($$ select method, amount_cents from payments where booking_id = pg_temp.id('free') $$, $$ values ('free', 0) $$, '$0 recorded as free');
select is(pg_temp.bal(), 30, 'the balance keeps the minutes used');
insert into ids select 'phone', (booking_hold(pg_temp.q('{"startsAt": "2030-01-15T19:00:00+11:00", "endsAt": "2030-01-15T20:00:00+11:00", "customer": {"name": "Pia", "phone": "0400777666"}}'))).id;
select booking_confirm(pg_temp.id('phone'), '{"method": "stripe", "paymentIntentId": "pi_bk_phone", "amountPaidCents": 3000, "email": "pia@test.local"}');
select is((select c.email::text from bookings b join customers c on c.id = b.customer_id where b.id = pg_temp.id('phone')), 'pia@test.local', 'the email Stripe collected is saved');

-- ── Cancellation quotes ─────────────────────────────────────────────────────
select results_eq(
  $$ select q ->> 'rule', (q ->> 'refundCents')::int, (q ->> 'returnMinutes')::int from (select booking_cancel_quote(pg_temp.id('guest'), '2030-01-14T12:00:00+11:00') q) x $$,
  $$ values ('full', 3000, 0) $$, 'exactly 24 h before: full refund');
select results_eq(
  $$ select q ->> 'rule', (q ->> 'refundCents')::int from (select booking_cancel_quote(pg_temp.id('guest'), '2030-01-14T12:00:01+11:00') q) x $$,
  $$ values ('half', 1500) $$, 'just under 24 h: half');
select results_eq(
  $$ select q ->> 'allowed', q ->> 'reason' from (select booking_cancel_quote(pg_temp.id('guest'), '2030-01-15T10:00:01+11:00') q) x $$,
  $$ values ('false', 'too_late') $$, 'under 2 h: not allowed');
select is(booking_cancel_quote(pg_temp.id('guest'), '2030-01-15T11:59:00+11:00', true) ->> 'refundCents', '3000', 'venue fault: full refund any time');
select is(booking_cancel_quote(pg_temp.id('late'), '2030-01-14T12:00:00+11:00') ->> 'reason', 'not_cancellable', 'an expired hold is not cancellable');

-- ── Cancel ──────────────────────────────────────────────────────────────────
select throws_like($$ select booking_cancel(pg_temp.id('guest'), '{"now": "2030-01-14T11:00:00+11:00", "refundCents": 1500}') $$,
  'RG:refund_changed:%', 'the customer must have seen the current refund');
select throws_like($$ select booking_cancel(pg_temp.id('guest'), '{"now": "2030-01-14T11:00:00+11:00", "refundCents": 3000}') $$,
  'RG:invalid:%', 'a refund needs the Stripe refund id');
select throws_like($$ select booking_cancel(pg_temp.id('guest'), '{"now": "2030-01-15T11:00:00+11:00", "venueFault": true}') $$,
  'RG:forbidden:%', 'a customer cannot claim venue fault');
select throws_like($$ select booking_cancel(pg_temp.id('guest'), '{"now": "2030-01-15T11:00:00+11:00", "refundCents": 0}') $$,
  'RG:too_late:%', 'a customer cannot cancel under 2 h');
select is(booking_cancel(pg_temp.id('guest'), '{"now": "2030-01-14T11:00:00+11:00", "refundCents": 3000, "stripeRefundId": "re_bk_1"}') ->> 'rule', 'full', 'customer cancels 25 h ahead');
select results_eq(
  $$ select b.status, b.refund_cents, b.cancelled_at, b.cancel_reason, r.amount_cents, r.stripe_refund_id
     from bookings b join payments p on p.booking_id = b.id join refunds r on r.payment_id = p.id where b.id = pg_temp.id('guest') $$,
  $$ values ('cancelled', 3000, '2030-01-14T11:00:00+11:00'::timestamptz, 'Cancelled by customer', 3000, 're_bk_1') $$,
  'booking cancelled with its Stripe refund recorded');
select throws_like($$ select booking_cancel(pg_temp.id('guest'), '{"now": "2030-01-14T11:00:00+11:00", "refundCents": 3000, "stripeRefundId": "re_bk_2"}') $$,
  'RG:not_cancellable:%', 'a booking is cancelled once');

select is(booking_cancel(pg_temp.id('ref'), '{"now": "2030-01-15T06:00:00+11:00", "refundCents": 1250, "stripeRefundId": "re_bk_ref"}') ->> 'refundCents', '1250', 'half refund 10 h ahead');
select is((select uses_count from referral_codes where id = '00000000-0000-0000-0000-0000000ee101'), 1, 'the referral use is not restored');

select results_eq(
  $$ select (r ->> 'refundCents')::int, (r ->> 'minutesReturned')::int from (select booking_cancel(pg_temp.id('free'), '{"now": "2030-01-14T11:00:00+11:00", "refundCents": 0}') r) x $$,
  $$ values (0, 60) $$, 'a $0 member booking cancelled ≥ 24 h ahead returns its minutes');
select is(pg_temp.bal(), 90, '…to the balance');

select throws_like($$ select booking_cancel(pg_temp.id('phone'), '{"now": "2030-01-15T18:30:00+11:00", "staffId": "00000000-0000-0000-0000-00000000b001", "overrideRefundCents": 1000}') $$,
  'RG:invalid:%', 'staff must give a reason');
select throws_like($$ select booking_cancel(pg_temp.id('phone'), '{"now": "2030-01-15T18:30:00+11:00", "staffId": "00000000-0000-0000-0000-00000000b001", "reason": "x", "overrideRefundCents": 3001, "stripeRefundId": "re_bk_o"}') $$,
  'RG:invalid:%', 'an override cannot exceed the amount paid');
select is(booking_cancel(pg_temp.id('phone'), '{"now": "2030-01-15T18:30:00+11:00", "staffId": "00000000-0000-0000-0000-00000000b001", "reason": "Goodwill", "overrideRefundCents": 1000, "stripeRefundId": "re_bk_o"}') ->> 'rule',
  'override', 'a superadmin can refund any amount, even under 2 h');
select results_eq(
  $$ select actor_staff_id, reason, after ->> 'refund_cents' from audit_log where action = 'booking.cancel' and entity_id = pg_temp.id('phone')::text $$,
  $$ values ('00000000-0000-0000-0000-00000000b001'::uuid, 'Goodwill', '1000') $$, 'staff cancellation audited with actor and reason');

-- A member booking part-paid with free minutes, cancelled 10 h ahead: half the money back, minutes kept.
insert into ids select 'memhalf', (booking_hold(pg_temp.q('{"resourceId": "00000000-0000-0000-0000-0000000cc102", "memberId": "00000000-0000-0000-0000-00000000d101", "freeMinutes": 30, "totalCents": 1350, "gstCents": 123, "startsAt": "2030-01-15T17:00:00+11:00", "endsAt": "2030-01-15T18:00:00+11:00"}'))).id;
select booking_confirm(pg_temp.id('memhalf'), '{"method": "stripe", "paymentIntentId": "pi_bk_memhalf", "amountPaidCents": 1350}');
select results_eq(
  $$ select (r ->> 'refundCents')::int, (r ->> 'minutesReturned')::int, pg_temp.bal()
     from (select booking_cancel(pg_temp.id('memhalf'), '{"now": "2030-01-15T07:00:00+11:00", "refundCents": 675, "stripeRefundId": "re_bk_memhalf"}') r) x $$,
  $$ values (675, 0, 60) $$, 'a 2–24 h cancel refunds half and keeps the free minutes used');

-- ── Privileges ──────────────────────────────────────────────────────────────
select function_privs_are('public', 'booking_hold', array['jsonb'], 'anon', array[]::text[], 'anonymous visitors cannot hold directly');
select function_privs_are('public', 'booking_cancel', array['uuid', 'jsonb'], 'authenticated', array[]::text[], 'browser users cannot cancel directly');

select * from finish();
rollback;
