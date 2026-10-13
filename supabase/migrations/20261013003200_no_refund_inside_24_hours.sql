-- The owner's terms and conditions (D101): a customer cancelling 24 hours or more before the start
-- gets everything back; inside 24 hours a booking can't be cancelled online and nothing is refunded.
-- The 50% refund between 2 and 24 hours is gone. Staff can still cancel for a venue reason (full
-- refund, any time) or set an amount with a reason, exactly as before.

/*
 Policy: customer ≥ 24 h before start → 100 %, minutes returned; < 24 h → not allowed.
 Venue fault (staff only) → 100 % and minutes, any time. Amounts are based on what was paid.
 Referral uses are never restored.
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
  end if;
  return jsonb_build_object('allowed', false, 'reason', 'too_late', 'paidCents', v_paid, 'hoursBefore', v_hours);
end;
$$;
