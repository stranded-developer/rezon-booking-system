-- Sessions (D63). A session is 30 minutes.
--
--   Booked online : at least one session, then 15-minute steps (30, 45, 60, 75 …).
--   Walk-in       : from the resource type's own minimum (15 min), billed by the minute.
--   Free play     : spent the way it is played — at least a session on a booking, 15-minute
--                   blocks at the counter.
--
-- The session length is one venue-wide setting so it can be changed without touching code.

alter table public.venue_settings
  add column session_minutes int not null default 30
    check (session_minutes >= 15 and session_minutes % 15 = 0);
comment on column public.venue_settings.session_minutes is 'Smallest bookable block online; walk-ins use resource_types.min_minutes';

-- Free play per month, in sessions: Silver 2, Gold 4, Diamond 8, each rolling over for ten months.
-- Only tiers still on the old launch values are moved; anything the venue has changed is left alone.
update public.membership_tiers set monthly_free_minutes = 120, max_balance_minutes = 1200
  where name = 'Gold' and monthly_free_minutes = 60 and max_balance_minutes = 600;
update public.membership_tiers set monthly_free_minutes = 240, max_balance_minutes = 2400
  where name = 'Diamond' and monthly_free_minutes = 60 and max_balance_minutes = 600;

-- ── Bookings: at least one session, and free play spent a session at a time ─
create or replace function public.booking_hold(p jsonb)
returns public.bookings
language plpgsql
set search_path = ''
as $$
declare
  st public.venue_settings := private.settings();
  v_now timestamptz := coalesce((p ->> 'now')::timestamptz, now());
  v_start timestamptz := (p ->> 'startsAt')::timestamptz;
  v_end timestamptz := (p ->> 'endsAt')::timestamptz;
  v_resource public.resources;
  v_type public.resource_types;
  v_hours public.opening_hours;
  v_local_start timestamp;
  v_local_end timestamp;
  v_minutes int;
  v_member uuid := nullif(p ->> 'memberId', '')::uuid;
  v_member_row public.members;
  v_customer uuid;
  v_email text := nullif(trim(p -> 'customer' ->> 'email'), '');
  v_phone text := nullif(trim(p -> 'customer' ->> 'phone'), '');
  v_referral uuid := nullif(p ->> 'referralCodeId', '')::uuid;
  v_code public.referral_codes;
  v_free int := coalesce((p ->> 'freeMinutes')::int, 0);
  v_total int := (p ->> 'totalCents')::int;
  v_booking public.bookings;
begin
  if v_start is null or v_end is null or v_end <= v_start then
    perform private.fail('invalid', 'Choose a start time and a duration');
  end if;
  if v_total is null or v_total < 0 or (p ->> 'gstCents')::int is distinct from private.gst_of(v_total)
     or jsonb_typeof(p -> 'pricing') is distinct from 'object' then
    perform private.fail('invalid', 'Price is missing or inconsistent');
  end if;
  if coalesce(p ->> 'cancelTokenHash', '') !~ '^[0-9a-f]{64}$' then
    perform private.fail('invalid', 'Missing booking token');
  end if;
  if v_member is not null and v_referral is not null then
    perform private.fail('member_and_referral', 'A membership and a referral code cannot be used together');
  end if;
  if v_free < 0 or (v_free > 0 and v_member is null) then
    perform private.fail('invalid', 'Free minutes need a member');
  end if;

  perform public.expire_stale_holds(v_now);

  select * into v_resource from public.resources where id = (p ->> 'resourceId')::uuid;
  select * into v_type from public.resource_types where id = v_resource.resource_type_id;
  if v_resource.id is null or not v_resource.active or not v_type.active then
    perform private.fail('resource_unavailable', 'That table or simulator is not available');
  end if;

  -- Time rules, in venue time.
  v_local_start := v_start at time zone st.timezone;
  v_local_end := v_end at time zone st.timezone;
  v_minutes := (extract(epoch from (v_end - v_start)) / 60)::int;
  if extract(second from v_local_start) <> 0 or extract(minute from v_local_start)::int % 15 <> 0
     or extract(epoch from (v_end - v_start))::int % 900 <> 0 then
    perform private.fail('invalid_time', 'Bookings start on the quarter hour and last in 15-minute steps');
  end if;
  -- D63: a booking is at least one session, then 15-minute steps.
  if v_minutes < st.session_minutes then
    perform private.fail('invalid_time', format('A booking is at least one %s-minute session', st.session_minutes));
  end if;
  if v_free > v_minutes then
    perform private.fail('invalid', 'Free minutes cannot exceed the booking length');
  end if;
  -- Free play is spent the way the time is sold: a whole session, then 15-minute steps.
  if v_free > 0 and (v_free < st.session_minutes or v_free % 15 <> 0) then
    perform private.fail('invalid', format('Free play on a booking starts at %s minutes, then 15-minute steps', st.session_minutes));
  end if;
  if v_start < v_now + make_interval(mins => st.online_cutoff_minutes) then
    perform private.fail('too_soon', format('Online bookings must start at least %s minutes from now', st.online_cutoff_minutes));
  end if;
  if v_local_start::date > (v_now at time zone st.timezone)::date + st.booking_window_days then
    perform private.fail('too_far_ahead', format('Bookings open %s days ahead', st.booking_window_days));
  end if;
  select * into v_hours from public.opening_hours where day_of_week = extract(isodow from v_local_start)::int;
  if v_hours.day_of_week is null or v_hours.closed
     or v_local_start::time < v_hours.open_time
     or v_local_end > v_local_start::date + v_hours.close_time then
    perform private.fail('outside_opening_hours', 'That time is outside opening hours');
  end if;

  -- Who is booking.
  if v_member is not null then
    select * into v_member_row from public.members where id = v_member for update;
    if v_member_row.id is null or v_member_row.status not in ('active', 'cancelling') then
      perform private.fail('member_inactive', 'This membership is not active');
    end if;
    v_customer := v_member_row.customer_id;
  else
    if nullif(trim(p -> 'customer' ->> 'name'), '') is null then
      perform private.fail('invalid', 'Your name is required');
    end if;
    if v_email is null and v_phone is null then
      perform private.fail('invalid', 'An email or phone number is required');
    end if;
    if v_email is not null then
      select id into v_customer from public.customers where lower(email::text) = lower(v_email) order by created_at limit 1;
    else
      select id into v_customer from public.customers where phone = v_phone order by created_at limit 1;
    end if;
    if v_customer is null then
      insert into public.customers (name, email, phone)
      values (trim(p -> 'customer' ->> 'name'), v_email, v_phone)
      returning id into v_customer;
    end if;
  end if;

  -- Referral: holds still waiting for payment count as reserved uses.
  if v_referral is not null then
    select * into v_code from public.referral_codes where id = v_referral for update;
    if v_code.id is null or not v_code.active or (v_code.valid_until is not null and v_code.valid_until <= v_now)
       or v_code.uses_count + (
         select count(*) from public.bookings
         where referral_code_id = v_referral and status = 'held' and hold_expires_at > v_now
       ) >= v_code.max_uses then
      perform private.fail('referral_invalid', 'This referral code can no longer be used');
    end if;
  end if;

  begin
    insert into public.bookings (
      resource_id, customer_id, member_id, period, status, hold_expires_at, free_minutes_used, referral_code_id,
      pricing_snapshot, total_cents, gst_cents, cancel_token_hash
    ) values (
      v_resource.id, v_customer, v_member, tstzrange(v_start, v_end, '[)'), 'held',
      v_now + make_interval(mins => st.hold_ttl_minutes + 10), v_free, v_referral,
      p -> 'pricing', v_total, (p ->> 'gstCents')::int, p ->> 'cancelTokenHash'
    ) returning * into v_booking;
  exception when exclusion_violation then
    perform private.fail('slot_taken', 'Someone has just booked that time. Please choose another.');
  end;

  if v_free > 0 then
    if v_free > (select balance_minutes from public.member_balances where member_id = v_member) then
      perform private.fail('insufficient_balance', 'Not enough free-play minutes');
    end if;
    insert into public.member_balance_ledger (member_id, delta_minutes, kind, booking_id, reason)
    values (v_member, -v_free, 'use', v_booking.id, 'Online booking');
  end if;

  insert into public.audit_log (action, entity, entity_id, after)
  values ('booking.hold', 'bookings', v_booking.id::text,
          jsonb_build_object('ref', v_booking.ref, 'resource_id', v_resource.id, 'period', v_booking.period, 'total_cents', v_total,
                             'member_id', v_member, 'referral_code_id', v_referral, 'free_minutes', v_free));
  return v_booking;
end;
$$;

revoke execute on function public.booking_hold(jsonb) from public, anon, authenticated;
grant execute on function public.booking_hold(jsonb) to service_role;

-- ── At the counter: free play in 15-minute blocks ───────────────────────────
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

revoke execute on function public.pos_close_session(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.pos_close_session(uuid, uuid, jsonb) to service_role;
