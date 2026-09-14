-- Online bookings (spec/booking-site.md). A booking is held while the customer pays, confirmed by the
-- payment, released if unpaid, and cancellable under the refund policy. Service role only (the API).
--
-- Free-play minutes are taken from the member's balance when the hold is made (not at payment), so two
-- open holds can't spend the same minutes; they are returned if the hold expires or is released.
-- A referral code's use is reserved by a live hold and becomes a real use on payment.

-- ── Holds expire: return any free minutes they took ────────────────────────
drop function public.expire_stale_holds();

create function public.expire_stale_holds(p_now timestamptz default now())
returns int
language plpgsql
set search_path = ''
as $$
declare
  b record;
  v_count int := 0;
begin
  for b in
    select id, member_id, free_minutes_used from public.bookings
    where status = 'held' and hold_expires_at < p_now
    for update skip locked
  loop
    update public.bookings set status = 'expired' where id = b.id;
    if b.free_minutes_used > 0 then
      insert into public.member_balance_ledger (member_id, delta_minutes, kind, booking_id, reason)
      values (b.member_id, b.free_minutes_used, 'return', b.id, 'Booking hold expired');
    end if;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

-- ── Referral uses respect live online holds ─────────────────────────────────
-- A POS close or a booking confirmation adds a use. Uses plus holds still waiting for payment may not
-- exceed max_uses, so a walk-in can't take the use an online customer is paying for right now.
create or replace function private.guard_referral_reservations()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- Going over max_uses on its own is left to the referral_codes_uses_within_max check constraint.
  if new.uses_count > old.uses_count and new.uses_count <= new.max_uses and new.uses_count + (
    select count(*) from public.bookings
    where referral_code_id = new.id and status = 'held' and hold_expires_at > now()
  ) > new.max_uses then
    perform private.fail('referral_invalid', 'This referral code can no longer be used');
  end if;
  return new;
end;
$$;

create trigger referral_codes_guard_reservations before update of uses_count on public.referral_codes
  for each row execute function private.guard_referral_reservations();

-- ── Hold ────────────────────────────────────────────────────────────────────
/*
 p:
   resourceId, startsAt, endsAt (timestamptz), now (timestamptz, defaults to now())
   memberId (uuid, the signed-in member) | customer { name, email, phone } for guests
   referralCodeId (uuid), freeMinutes (int)
   pricing (jsonb snapshot from the engine), totalCents, gstCents
   cancelTokenHash (sha256 hex of the token in the booking link)

 hold_expires_at = now + hold_ttl_minutes + 10 min grace. The API sets the Stripe Checkout expiry to
 about now + hold_ttl_minutes (Stripe needs ≥ 30 min), so a customer who pays at the last moment
 still finds the hold in place when the webhook arrives.
*/
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
  if v_minutes < v_type.min_minutes then
    perform private.fail('invalid_time', format('The minimum booking is %s minutes', v_type.min_minutes));
  end if;
  if v_free > v_minutes then
    perform private.fail('invalid', 'Free minutes cannot exceed the booking length');
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

-- ── Attach the Stripe Checkout session to a hold ────────────────────────────
create or replace function public.booking_attach_checkout(p_booking uuid, p_checkout_session_id text)
returns void
language plpgsql
set search_path = ''
as $$
begin
  if coalesce(trim(p_checkout_session_id), '') = '' then
    perform private.fail('invalid', 'Checkout session id is required');
  end if;
  update public.bookings set stripe_checkout_session_id = p_checkout_session_id where id = p_booking and status = 'held';
  if not found then
    perform private.fail('booking_not_held', 'This booking is no longer waiting for payment');
  end if;
end;
$$;

-- ── Confirm ─────────────────────────────────────────────────────────────────
/*
 p: method ('stripe' | 'free'), amountPaidCents, paymentIntentId (required for stripe), checkoutSessionId,
    email (the email Stripe collected; saved to a customer who has none)
 A second confirmation of an already confirmed booking changes nothing and returns reason 'duplicate'.
 An expired or cancelled booking raises hold_expired; the API then refunds the payment.
*/
create or replace function public.booking_confirm(p_booking uuid, p jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  b public.bookings;
  v_method text := p ->> 'method';
  v_paid int := (p ->> 'amountPaidCents')::int;
  v_intent text := nullif(p ->> 'paymentIntentId', '');
  v_payment uuid;
begin
  select * into b from public.bookings where id = p_booking for update;
  if b.id is null then
    perform private.fail('not_found', 'Booking not found');
  end if;
  if b.status in ('confirmed', 'arrived', 'completed', 'no_show') then
    return jsonb_build_object('confirmed', false, 'reason', 'duplicate', 'ref', b.ref);
  end if;
  if b.status <> 'held' then
    perform private.fail('hold_expired', 'The booking hold ended before payment finished');
  end if;
  if v_method is null or v_method not in ('stripe', 'free') then
    perform private.fail('invalid', 'Unknown payment method');
  end if;
  if v_method = 'stripe' and v_intent is null then
    perform private.fail('invalid', 'The Stripe payment id is required');
  end if;
  if v_paid is distinct from b.total_cents or (v_method = 'free') <> (b.total_cents = 0) then
    perform private.fail('amount_mismatch', 'The amount paid does not match the booking');
  end if;

  update public.bookings set
    status = 'confirmed',
    hold_expires_at = null,
    stripe_payment_intent_id = v_intent,
    stripe_checkout_session_id = coalesce(nullif(p ->> 'checkoutSessionId', ''), stripe_checkout_session_id)
  where id = b.id;

  if nullif(trim(p ->> 'email'), '') is not null then
    update public.customers set email = trim(p ->> 'email') where id = b.customer_id and email is null;
  end if;

  insert into public.payments (booking_id, method, amount_cents, gst_cents, external_ref)
  values (b.id, v_method, b.total_cents, b.gst_cents, v_intent)
  returning id into v_payment;

  if b.referral_code_id is not null then
    update public.referral_codes set uses_count = uses_count + 1 where id = b.referral_code_id;
    insert into public.referral_redemptions (code_id, booking_id, discount_cents)
    values (b.referral_code_id, b.id, greatest(coalesce((b.pricing_snapshot ->> 'discountCents')::int, 0), 0));
  end if;

  insert into public.audit_log (action, entity, entity_id, after)
  values ('booking.confirm', 'bookings', b.id::text,
          jsonb_build_object('ref', b.ref, 'method', v_method, 'amount_cents', b.total_cents, 'payment_id', v_payment));

  return jsonb_build_object('confirmed', true, 'ref', b.ref, 'paymentId', v_payment);
end;
$$;

-- Checkout expired or abandoned: release the slot, the minutes and the referral reservation now.
create or replace function public.booking_release_hold(p_booking uuid)
returns text
language plpgsql
set search_path = ''
as $$
declare
  b public.bookings;
begin
  select * into b from public.bookings where id = p_booking for update;
  if b.id is null then
    perform private.fail('not_found', 'Booking not found');
  end if;
  if b.status <> 'held' then
    return b.status;
  end if;
  update public.bookings set status = 'expired' where id = b.id;
  if b.free_minutes_used > 0 then
    insert into public.member_balance_ledger (member_id, delta_minutes, kind, booking_id, reason)
    values (b.member_id, b.free_minutes_used, 'return', b.id, 'Booking hold released');
  end if;
  insert into public.audit_log (action, entity, entity_id, after)
  values ('booking.release', 'bookings', b.id::text, jsonb_build_object('ref', b.ref, 'minutes_returned', b.free_minutes_used));
  return 'expired';
end;
$$;

-- ── Cancellation and refunds ────────────────────────────────────────────────
/*
 Policy: customer ≥ 24 h before start → 100 %, minutes returned; 2–24 h → 50 % (half cent rounds
 down), minutes kept; < 2 h → not allowed. Venue fault (staff only) → 100 % and minutes, any time.
 Amounts are based on what was paid. Referral uses are never restored.
*/
create or replace function public.booking_cancel_quote(p_booking uuid, p_now timestamptz, p_venue_fault boolean default false)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  b public.bookings;
  v_hours numeric;
  v_paid int;
begin
  select * into b from public.bookings where id = p_booking;
  if b.id is null then
    perform private.fail('not_found', 'Booking not found');
  end if;
  if b.status <> 'confirmed' then
    return jsonb_build_object('allowed', false, 'reason', 'not_cancellable', 'status', b.status);
  end if;
  select coalesce(sum(amount_cents), 0) into v_paid from public.payments where booking_id = b.id;
  v_hours := round(extract(epoch from (lower(b.period) - p_now)) / 3600, 2);
  if p_venue_fault then
    return jsonb_build_object('allowed', true, 'rule', 'venue', 'refundCents', v_paid, 'paidCents', v_paid,
                              'returnMinutes', b.free_minutes_used, 'hoursBefore', v_hours);
  elsif lower(b.period) - p_now >= interval '24 hours' then
    return jsonb_build_object('allowed', true, 'rule', 'full', 'refundCents', v_paid, 'paidCents', v_paid,
                              'returnMinutes', b.free_minutes_used, 'hoursBefore', v_hours);
  elsif lower(b.period) - p_now >= interval '2 hours' then
    return jsonb_build_object('allowed', true, 'rule', 'half', 'refundCents', v_paid / 2, 'paidCents', v_paid,
                              'returnMinutes', 0, 'hoursBefore', v_hours);
  end if;
  return jsonb_build_object('allowed', false, 'reason', 'too_late', 'paidCents', v_paid, 'hoursBefore', v_hours);
end;
$$;

/*
 p:
   now                  timestamptz
   staffId              uuid, null when the customer cancels through their link
   venueFault           boolean, staff only
   reason               text, required for staff
   refundCents          must equal the quote (the customer saw it), unless overrideRefundCents is given
   overrideRefundCents  staff only, with a reason: any amount up to what was paid, even < 2 h before
   returnMinutes        with an override: whether to return the free minutes (default false)
   stripeRefundId       required when the refund is > $0 (the API refunds through Stripe first)
*/
create or replace function public.booking_cancel(p_booking uuid, p jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  b public.bookings;
  v_now timestamptz := coalesce((p ->> 'now')::timestamptz, now());
  v_staff uuid := nullif(p ->> 'staffId', '')::uuid;
  v_reason text := nullif(trim(p ->> 'reason'), '');
  v_fault boolean := coalesce((p ->> 'venueFault')::boolean, false);
  v_override int := (p ->> 'overrideRefundCents')::int;
  v_quote jsonb;
  v_refund int;
  v_return int;
  v_rule text;
  v_payment public.payments;
  v_refund_row uuid;
begin
  if v_staff is null and (v_fault or v_override is not null) then
    perform private.fail('forbidden', 'Only staff can cancel for a venue reason or set the refund');
  end if;
  if v_staff is not null and v_reason is null then
    perform private.fail('invalid', 'A reason is required');
  end if;

  select * into b from public.bookings where id = p_booking for update;
  if b.id is null then
    perform private.fail('not_found', 'Booking not found');
  end if;
  v_quote := public.booking_cancel_quote(p_booking, v_now, v_fault);
  if v_quote ->> 'reason' = 'not_cancellable' then
    perform private.fail('not_cancellable', 'This booking can''t be cancelled');
  end if;
  select * into v_payment from public.payments where booking_id = b.id for update;

  if v_override is not null then
    if v_override < 0 or v_override > coalesce(v_payment.amount_cents, 0) then
      perform private.fail('invalid', 'Refund must be between $0.00 and the amount paid');
    end if;
    v_refund := v_override;
    v_return := case when coalesce((p ->> 'returnMinutes')::boolean, false) then b.free_minutes_used else 0 end;
    v_rule := 'override';
  else
    if not (v_quote ->> 'allowed')::boolean then
      perform private.fail('too_late', 'Bookings can''t be cancelled less than 2 hours before the start');
    end if;
    v_refund := (v_quote ->> 'refundCents')::int;
    if (p ->> 'refundCents')::int is distinct from v_refund then
      perform private.fail('refund_changed', 'The refund amount has changed; please check it again');
    end if;
    v_return := (v_quote ->> 'returnMinutes')::int;
    v_rule := v_quote ->> 'rule';
  end if;

  update public.bookings set
    status = 'cancelled', cancelled_at = v_now, cancelled_by_staff_id = v_staff,
    cancel_reason = coalesce(v_reason, 'Cancelled by customer'),
    refund_cents = v_refund
  where id = b.id;

  if v_refund > 0 then
    if v_payment.method is distinct from 'stripe' then
      perform private.fail('invalid', 'Only online payments can be refunded here');
    end if;
    if nullif(p ->> 'stripeRefundId', '') is null then
      perform private.fail('invalid', 'The Stripe refund id is required');
    end if;
    insert into public.refunds (payment_id, amount_cents, reason, stripe_refund_id, staff_id)
    values (v_payment.id, v_refund, coalesce(v_reason, 'Booking cancelled by customer'), p ->> 'stripeRefundId', v_staff)
    returning id into v_refund_row;
  end if;

  if v_return > 0 then
    insert into public.member_balance_ledger (member_id, delta_minutes, kind, booking_id, actor_staff_id, reason)
    values (b.member_id, v_return, 'return', b.id, v_staff, 'Booking cancelled');
  end if;

  insert into public.audit_log (actor_staff_id, action, entity, entity_id, before, after, reason)
  values (v_staff, 'booking.cancel', 'bookings', b.id::text, jsonb_build_object('status', b.status),
          jsonb_build_object('status', 'cancelled', 'rule', v_rule, 'refund_cents', v_refund, 'refund_id', v_refund_row,
                             'minutes_returned', v_return, 'hours_before', v_quote -> 'hoursBefore'),
          v_reason);

  return jsonb_build_object('refundCents', v_refund, 'minutesReturned', v_return, 'rule', v_rule);
end;
$$;

-- ── Privileges ──────────────────────────────────────────────────────────────
revoke execute on function
  public.expire_stale_holds(timestamptz),
  public.booking_hold(jsonb),
  public.booking_attach_checkout(uuid, text),
  public.booking_confirm(uuid, jsonb),
  public.booking_release_hold(uuid),
  public.booking_cancel_quote(uuid, timestamptz, boolean),
  public.booking_cancel(uuid, jsonb)
from public, anon, authenticated;

grant execute on function
  public.expire_stale_holds(timestamptz),
  public.booking_hold(jsonb),
  public.booking_attach_checkout(uuid, text),
  public.booking_confirm(uuid, jsonb),
  public.booking_release_hold(uuid),
  public.booking_cancel_quote(uuid, timestamptz, boolean),
  public.booking_cancel(uuid, jsonb)
to service_role;
