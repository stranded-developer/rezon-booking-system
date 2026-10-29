-- D115: walk-in packages at the counter. A package is an experience (a fixed length at a flat price, D65):
-- the simulators' existing ones, and new ones for the billiard tables. It is paid when the table is opened,
-- runs to its end, and closing it charges nothing more, as with a booking.

-- Where each package is sold. Everything so far was sold online, and is now sold at the counter too.
alter table public.experiences
  add column online boolean not null default true,
  add column at_counter boolean not null default true;
comment on column public.experiences.online is 'Listed and bookable on the website';
comment on column public.experiences.at_counter is 'Sold at the counter as a walk-in package, paid up front (D115)';

alter table public.sessions
  add column experience_id uuid references public.experiences (id) on delete restrict,
  add column package_ends_at timestamptz,
  add constraint sessions_package_shape check (
    (experience_id is null) = (package_ends_at is null)
    and (experience_id is null or (kind = 'walk_in' and package_ends_at > opened_at))
  );
comment on column public.sessions.experience_id is 'A walk-in package, paid when it was opened (D115)';
comment on column public.sessions.package_ends_at is 'When the package''s time is up';

-- Billiard packages for a venue that already exists (a fresh database gets them from the seed), at the
-- tables' hourly rate until the owner sets their own prices. Counter only: online, tables are booked by the hour.
insert into public.experiences (key, resource_type_id, name, minutes, price_cents, sort, online, at_counter)
select v.key, rt.id, v.name, v.minutes, rt.base_rate_cents * v.minutes / 60, v.sort, false, true
from (values
  ('billiard_30', 'billiard', '30 minutes', 30, 101),
  ('billiard_60', 'billiard', '1 hour', 60, 102),
  ('billiard_120', 'billiard', '2 hours', 120, 103)
) as v (key, type_key, name, minutes, sort)
join public.resource_types rt on rt.key = v.type_key
on conflict (key) do nothing;

-- A 2-hour simulator package for the counter: two Double Sessions until the owner sets a price.
insert into public.experiences (key, resource_type_id, name, minutes, price_cents, sort, online, at_counter)
select 'sim_120', rt.id, '2 hours', 120, 2 * e.price_cents, 104, false, true
from public.resource_types rt
join public.experiences e on e.key = 'double_race'
where rt.key = 'sim'
on conflict (key) do nothing;

/*
 Open a walk-in package and take its payment, in one go. The API prices it with the pricing engine
 (priceExperience); this checks everything it can and records it.
 p: resourceId, experienceId, now, memberId?, referralCodeId?, freeMinutes, pricing (snapshot),
    totalCents, gstCents, discountCents, method, tenderedCents?, externalRef?
*/
create or replace function public.pos_open_package(p_staff uuid, p jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  st public.venue_settings := private.settings();
  e public.experiences;
  r public.resources;
  oh public.opening_hours;
  rc public.referral_codes;
  v public.sessions;
  v_now timestamptz := coalesce((p ->> 'now')::timestamptz, now());
  v_local timestamp;
  v_ends timestamptz;
  v_member uuid := nullif(p ->> 'memberId', '')::uuid;
  v_referral uuid := nullif(p ->> 'referralCodeId', '')::uuid;
  v_free int := coalesce((p ->> 'freeMinutes')::int, 0);
  v_total int := (p ->> 'totalCents')::int;
  v_gst int := (p ->> 'gstCents')::int;
  v_discount int := coalesce((p ->> 'discountCents')::int, 0);
  v_method text := p ->> 'method';
  v_tendered int := (p ->> 'tenderedCents')::int;
  v_member_status text;
  v_balance int;
  v_shift uuid;
  v_payment public.payments;
  v_change int := 0;
begin
  v_local := v_now at time zone st.timezone;
  select * into e from public.experiences where id = (p ->> 'experienceId')::uuid;
  select * into r from public.resources where id = (p ->> 'resourceId')::uuid;
  if e.id is null or not e.active or not e.at_counter then
    perform private.fail('package_unavailable', 'That package is not sold at the counter');
  end if;
  if r.id is null or r.resource_type_id <> e.resource_type_id then
    perform private.fail('package_unavailable', 'That package is for a different kind of table');
  end if;
  if jsonb_typeof(p -> 'pricing') is distinct from 'object' then
    perform private.fail('invalid', 'Pricing snapshot is required');
  end if;
  if v_total is null or v_total < 0 or v_free < 0 or v_free > e.minutes or v_free % st.session_minutes <> 0 then
    perform private.fail('invalid', 'Amounts must be $0.00 or more, and free play whole sessions');
  end if;
  if v_gst is distinct from private.gst_of(v_total) then
    perform private.fail('gst_mismatch', 'GST does not match the total');
  end if;
  if v_member is not null and v_referral is not null then
    perform private.fail('member_and_referral', 'A membership and a referral code cannot be used together');
  end if;
  if v_free > 0 and v_member is null then
    perform private.fail('invalid', 'Free minutes need a member');
  end if;

  v_ends := v_now + make_interval(mins => e.minutes);
  select * into oh from public.opening_hours where day_of_week = extract(isodow from v_local)::int;
  if oh.day_of_week is not null and not oh.closed and v_local + make_interval(mins => e.minutes) > v_local::date + oh.close_time then
    perform private.fail('package_too_long', 'This package would run past closing time');
  end if;
  if exists (
    select 1 from public.bookings
    where resource_id = r.id and status in ('held', 'confirmed', 'arrived') and period && tstzrange(v_now, v_ends, '[)')
  ) then
    perform private.fail('package_clashes_booking', 'This table is booked before the package would end');
  end if;

  if v_member is not null then
    select status into v_member_status from public.members where id = v_member for update;
    if v_member_status is null or v_member_status not in ('active', 'cancelling') then
      perform private.fail('member_inactive', 'This membership is not active');
    end if;
    select balance_minutes into v_balance from public.member_balances where member_id = v_member;
    if v_free > coalesce(v_balance, 0) then
      perform private.fail('insufficient_balance', 'Not enough free-play minutes');
    end if;
  end if;

  if v_referral is not null then
    select * into rc from public.referral_codes where id = v_referral for update;
    if rc.id is null or not rc.active or (rc.valid_until is not null and rc.valid_until <= now())
       or rc.uses_count >= rc.max_uses then
      perform private.fail('referral_invalid', 'This referral code can no longer be used');
    end if;
    update public.referral_codes set uses_count = uses_count + 1 where id = rc.id;
  end if;

  select id into v_shift from public.shifts where closed_at is null for share;
  if v_total = 0 then
    if v_method is not null and v_method <> 'free' then
      perform private.fail('invalid', 'A $0.00 total is recorded as free');
    end if;
  else
    if v_method is null or v_method not in ('cash', 'card_terminal') then
      perform private.fail('invalid', 'Choose cash or card');
    end if;
    if v_shift is null then
      perform private.fail('no_open_shift', 'Open a shift before taking payment');
    end if;
    if v_method = 'cash' then
      if v_tendered is null or v_tendered < v_total then
        perform private.fail('tendered_insufficient', 'Cash received is less than the total');
      end if;
      v_change := v_tendered - v_total;
    end if;
  end if;

  -- Same opening rules as any walk-in: opening hours, not booked right now, not already in use.
  v := public.pos_open_walk_in(r.id, p_staff, v_now);
  update public.sessions set
    experience_id = e.id,
    package_ends_at = v_ends,
    member_id = v_member,
    referral_code_id = v_referral,
    free_minutes_used = v_free,
    pricing_snapshot = p -> 'pricing'
  where id = v.id;

  if v_free > 0 then
    insert into public.member_balance_ledger (member_id, delta_minutes, kind, session_id, actor_staff_id)
    values (v_member, -v_free, 'use', v.id, p_staff);
  end if;

  insert into public.payments (session_id, method, amount_cents, gst_cents, external_ref, staff_id, shift_id)
  values (v.id, coalesce(v_method, 'free'), v_total, v_gst, nullif(trim(p ->> 'externalRef'), ''), p_staff,
          case when v_total > 0 then v_shift end)
  returning * into v_payment;

  if v_method = 'cash' and v_total > 0 then
    insert into public.cash_movements (shift_id, kind, amount_cents, payment_id, staff_id)
    values (v_shift, 'sale', v_total, v_payment.id, p_staff);
  end if;

  if v_referral is not null then
    insert into public.referral_redemptions (code_id, session_id, discount_cents)
    values (v_referral, v.id, v_discount);
  end if;

  insert into public.audit_log (actor_staff_id, action, entity, entity_id, after)
  values (p_staff, 'session.open_package', 'sessions', v.id::text, jsonb_build_object(
    'experience_id', e.id, 'ends_at', v_ends, 'total_cents', v_total, 'method', v_method,
    'member_id', v_member, 'referral_code_id', v_referral, 'free_minutes', v_free, 'payment_id', v_payment.id));

  return jsonb_build_object(
    'sessionId', v.id, 'endsAt', v_ends, 'paymentId', v_payment.id, 'receiptNo', v_payment.receipt_no,
    'changeCents', v_change, 'shiftId', v_shift);
end;
$$;

revoke execute on function public.pos_open_package(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.pos_open_package(uuid, jsonb) to service_role;

-- Closing a package takes nothing more (D115).
create or replace function public.pos_close_session(p_session uuid, p_staff uuid, p_payload jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  s public.sessions;
  b public.bookings;
  rc public.referral_codes;
  v_closed_at timestamptz := (p_payload ->> 'closedAt')::timestamptz;
  v_member uuid := nullif(p_payload ->> 'memberId', '')::uuid;
  v_referral uuid := nullif(p_payload ->> 'referralCodeId', '')::uuid;
  v_free int := coalesce((p_payload ->> 'freeMinutes')::int, 0);
  v_computed int := (p_payload ->> 'computedTotalCents')::int;
  v_total int := (p_payload ->> 'totalCents')::int;
  v_gst int := (p_payload ->> 'gstCents')::int;
  v_discount int := coalesce((p_payload ->> 'discountCents')::int, 0);
  v_override jsonb := case when jsonb_typeof(p_payload -> 'override') = 'object' then p_payload -> 'override' end;
  v_method text := p_payload ->> 'method';
  v_tendered int := (p_payload ->> 'tenderedCents')::int;
  v_member_status text;
  v_shift uuid;
  v_payment public.payments;
  v_change int := 0;
begin
  select * into s from public.sessions where id = p_session for update;
  if s.id is null then
    perform private.fail('not_found', 'Session not found');
  end if;
  if s.status <> 'open' then
    perform private.fail('session_not_open', 'This session has already been closed');
  end if;

  -- D115: a package was paid when it opened. Closing it takes nothing more, however late (like a booking, D48).
  if s.experience_id is not null then
    select * into v_payment from public.payments where session_id = s.id;
    select id into v_shift from public.shifts where closed_at is null for share;
    update public.sessions set
      status = 'closed',
      closed_at = greatest(coalesce(v_closed_at, now()), s.opened_at),
      closed_by = p_staff,
      total_cents = v_payment.amount_cents,
      gst_cents = v_payment.gst_cents,
      closed_in_shift_id = v_shift
    where id = s.id;
    insert into public.audit_log (actor_staff_id, action, entity, entity_id, after)
    values (p_staff, 'session.close', 'sessions', s.id::text,
      jsonb_build_object('closed_at', greatest(coalesce(v_closed_at, now()), s.opened_at), 'package', true, 'payment_id', v_payment.id));
    return jsonb_build_object('sessionId', s.id, 'paymentId', v_payment.id, 'receiptNo', v_payment.receipt_no, 'changeCents', 0, 'shiftId', v_shift);
  end if;
  if v_closed_at is null or v_closed_at < s.opened_at then
    perform private.fail('invalid', 'Close time must be after the open time');
  end if;
  if p_payload -> 'pricing' is null or jsonb_typeof(p_payload -> 'pricing') <> 'object' then
    perform private.fail('invalid', 'Pricing snapshot is required');
  end if;
  if v_total is null or v_total < 0 or v_computed is null or v_computed < 0 or v_free < 0 then
    perform private.fail('invalid', 'Amounts must be $0.00 or more');
  end if;
  -- D63: free play is taken in 15-minute blocks at the counter, half a session at a time.
  if v_free % 15 <> 0 then
    perform private.fail('invalid', 'Free play is used in 15-minute blocks');
  end if;
  if v_gst is distinct from private.gst_of(v_total) then
    perform private.fail('gst_mismatch', 'GST does not match the total');
  end if;
  if v_override is null and v_total <> v_computed then
    perform private.fail('total_mismatch', 'Charged total differs from the calculated total without an override');
  end if;
  if v_override is not null and (
    coalesce(length(trim(v_override ->> 'reason')), 0) = 0 or (v_override ->> 'approverStaffId') is null
  ) then
    perform private.fail('invalid', 'A price override needs a reason and an approver');
  end if;

  if s.booking_id is not null then
    select * into b from public.bookings where id = s.booking_id for update;
    if b.status <> 'arrived' then
      perform private.fail('booking_not_arrived', 'The booking for this session is not checked in');
    end if;
  end if;

  if v_member is not null then
    select status into v_member_status from public.members where id = v_member for update;
    if v_member_status is null or v_member_status not in ('active', 'cancelling') then
      perform private.fail('member_inactive', 'This membership is not active');
    end if;
  end if;

  if v_referral is not null then
    select * into rc from public.referral_codes where id = v_referral for update;
    if rc.id is null or not rc.active or (rc.valid_until is not null and rc.valid_until <= now())
       or rc.uses_count >= rc.max_uses then
      perform private.fail('referral_invalid', 'This referral code can no longer be used');
    end if;
    update public.referral_codes set uses_count = uses_count + 1 where id = rc.id;
  end if;

  -- Tender rules.
  select id into v_shift from public.shifts where closed_at is null for share;
  if v_total = 0 then
    if v_method is not null and v_method <> 'free' then
      perform private.fail('invalid', 'A $0.00 total is recorded as free');
    end if;
  else
    if v_method is null or v_method not in ('cash', 'card_terminal') then
      perform private.fail('invalid', 'Choose cash or card');
    end if;
    if v_shift is null then
      perform private.fail('no_open_shift', 'Open a shift before taking payment');
    end if;
    if v_method = 'cash' then
      if v_tendered is null or v_tendered < v_total then
        perform private.fail('tendered_insufficient', 'Cash received is less than the total');
      end if;
      v_change := v_tendered - v_total;
    end if;
  end if;

  update public.sessions set
    status = 'closed',
    closed_at = v_closed_at,
    closed_by = p_staff,
    member_id = coalesce(v_member, member_id),
    referral_code_id = v_referral,
    free_minutes_used = v_free,
    pricing_snapshot = p_payload -> 'pricing',
    total_cents = v_total,
    gst_cents = v_gst,
    closed_in_shift_id = v_shift
  where id = s.id;

  if s.booking_id is not null then
    update public.bookings set status = 'completed' where id = s.booking_id;
  end if;

  if v_free > 0 then
    insert into public.member_balance_ledger (member_id, delta_minutes, kind, session_id, actor_staff_id)
    values (coalesce(v_member, s.member_id), -v_free, 'use', s.id, p_staff);
  end if;

  if v_total > 0 or s.kind = 'walk_in' then
    insert into public.payments (session_id, method, amount_cents, gst_cents, external_ref, staff_id, shift_id)
    values (s.id, coalesce(v_method, 'free'), v_total, v_gst, nullif(trim(p_payload ->> 'externalRef'), ''), p_staff,
            case when v_total > 0 then v_shift end)
    returning * into v_payment;
  end if;

  if v_method = 'cash' and v_total > 0 then
    insert into public.cash_movements (shift_id, kind, amount_cents, payment_id, staff_id)
    values (v_shift, 'sale', v_total, v_payment.id, p_staff);
  end if;

  if v_referral is not null then
    insert into public.referral_redemptions (code_id, session_id, discount_cents)
    values (v_referral, s.id, v_discount);
  end if;

  if v_override is not null then
    insert into public.price_overrides (session_id, original_cents, new_cents, reason, requested_by, approved_by)
    values (s.id, v_computed, v_total, trim(v_override ->> 'reason'), p_staff, (v_override ->> 'approverStaffId')::uuid);
  end if;

  insert into public.audit_log (actor_staff_id, approver_staff_id, action, entity, entity_id, after, reason)
  values (
    p_staff,
    (v_override ->> 'approverStaffId')::uuid,
    case when v_override is null then 'session.close' else 'session.close_with_override' end,
    'sessions',
    s.id::text,
    jsonb_build_object(
      'closed_at', v_closed_at, 'total_cents', v_total, 'computed_total_cents', v_computed,
      'method', v_method, 'member_id', v_member, 'referral_code_id', v_referral,
      'free_minutes', v_free, 'payment_id', v_payment.id, 'receipt_no', v_payment.receipt_no
    ),
    trim(v_override ->> 'reason')
  );

  return jsonb_build_object(
    'sessionId', s.id,
    'paymentId', v_payment.id,
    'receiptNo', v_payment.receipt_no,
    'changeCents', v_change,
    'shiftId', v_shift
  );
end;
$$;

-- Voiding an open package refunds what was paid for it (D115).
create or replace function public.pos_void_session(p_session uuid, p_staff uuid, p_reason text, p_now timestamptz default now())
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  s public.sessions;
  p public.payments;
  v_refunded int;
  v_refund public.refunds;
  v_shift uuid;
  v_amount int := 0;
begin
  if p_reason is null or length(trim(p_reason)) = 0 then
    perform private.fail('invalid', 'A reason is required to void');
  end if;
  select * into s from public.sessions where id = p_session for update;
  if s.id is null then
    perform private.fail('not_found', 'Session not found');
  end if;
  if s.status = 'voided' then
    perform private.fail('session_voided', 'This session is already voided');
  end if;

  -- D115: an open package has been paid for, so voiding it refunds like a closed walk-in.
  if s.status = 'open' and s.experience_id is null then
    if s.booking_id is not null then
      perform private.fail('cannot_void_booking_session', 'Close a booking session instead of voiding it');
    end if;
    update public.sessions set
      status = 'voided', closed_at = greatest(p_now, s.opened_at), closed_by = p_staff,
      total_cents = 0, gst_cents = 0, pricing_snapshot = jsonb_build_object('voided', true),
      void_reason = trim(p_reason)
    where id = s.id;
  else
    select * into p from public.payments where session_id = s.id for update;
    if p.id is not null and p.amount_cents > 0 then
      select coalesce(sum(amount_cents), 0) into v_refunded from public.refunds where payment_id = p.id;
      v_amount := p.amount_cents - v_refunded;
      if v_amount > 0 then
        if p.method in ('cash', 'card_terminal') then
          select id into v_shift from public.shifts where closed_at is null for share;
          if v_shift is null then
            perform private.fail('no_open_shift', 'Open a shift before refunding');
          end if;
        end if;
        insert into public.refunds (payment_id, amount_cents, reason, staff_id, shift_id)
        values (p.id, v_amount, trim(p_reason), p_staff, v_shift)
        returning * into v_refund;
        if p.method = 'cash' then
          insert into public.cash_movements (shift_id, kind, amount_cents, refund_id, staff_id)
          values (v_shift, 'refund', -v_amount, v_refund.id, p_staff);
        end if;
      end if;
    end if;
    if s.free_minutes_used > 0 then
      insert into public.member_balance_ledger (member_id, delta_minutes, kind, session_id, actor_staff_id, reason)
      values (s.member_id, s.free_minutes_used, 'return', s.id, p_staff, trim(p_reason));
    end if;
    update public.sessions set
      status = 'voided', void_reason = trim(p_reason),
      closed_at = coalesce(closed_at, greatest(p_now, s.opened_at)), closed_by = coalesce(closed_by, p_staff),
      total_cents = coalesce(total_cents, p.amount_cents, 0), gst_cents = coalesce(gst_cents, p.gst_cents, 0)
    where id = s.id;
  end if;

  insert into public.audit_log (actor_staff_id, action, entity, entity_id, before, after, reason)
  values (
    p_staff, 'session.void', 'sessions', s.id::text,
    jsonb_build_object('status', s.status, 'total_cents', s.total_cents),
    jsonb_build_object('status', 'voided', 'refund_cents', v_amount, 'refund_method', p.method, 'minutes_returned', s.free_minutes_used),
    trim(p_reason)
  );

  return jsonb_build_object('refundCents', v_amount, 'refundMethod', p.method, 'minutesReturned', s.free_minutes_used);
end;
$$;
