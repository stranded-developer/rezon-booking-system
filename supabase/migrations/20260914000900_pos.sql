-- POS money paths (spec/pos.md). Every function runs in one transaction, so a session close,
-- its payment, ledger use, referral use, cash movement, override and audit row commit together
-- or not at all. Callable by service_role only (the API).
--
-- Domain errors are raised as 'RG:<code>:<message>' (SQLSTATE P0001); the API maps the code.

-- ── One shared till ─────────────────────────────────────────────────────────
-- A small venue has one cash drawer: at most one open shift venue-wide. Any operator can take
-- payments on it (each payment still records its staff member). staff_id = opened by.
drop index public.shifts_one_open_per_staff;
create unique index shifts_one_open on public.shifts ((true)) where closed_at is null;
alter table public.shifts add column closed_by uuid references public.staff (id) on delete restrict;
alter table public.shifts add constraint shifts_closed_by_set check ((closed_at is null) = (closed_by is null));
comment on column public.shifts.staff_id is 'Staff member who opened the shift';

-- Which shift (till) a session was closed in, for per-shift reporting of every close,
-- including $0 and prepaid closes that have no payment on the till.
alter table public.sessions add column closed_in_shift_id uuid references public.shifts (id) on delete restrict;
create index sessions_closed_in_shift_idx on public.sessions (closed_in_shift_id);

-- Sequential receipt / tax invoice numbers.
alter table public.payments add column receipt_no bigint generated always as identity;
alter table public.payments add constraint payments_receipt_no_unique unique (receipt_no);

-- ── Helpers ─────────────────────────────────────────────────────────────────
create or replace function private.fail(p_code text, p_message text)
returns void
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'RG:%:%', p_code, p_message using errcode = 'P0001';
end;
$$;

create or replace function private.settings()
returns public.venue_settings
language sql
stable
set search_path = ''
as $$
  select * from public.venue_settings where id = 1;
$$;

create or replace function private.gst_of(p_total int)
returns int
language sql
immutable
as $$
  select (p_total * 2 + 11) / 22; -- round half up of total / 11
$$;

create or replace function private.open_shift_id()
returns uuid
language sql
stable
set search_path = ''
as $$
  select id from public.shifts where closed_at is null;
$$;

-- ── Shifts ──────────────────────────────────────────────────────────────────
create or replace function public.pos_open_shift(p_staff uuid, p_opening_float_cents int)
returns public.shifts
language plpgsql
set search_path = ''
as $$
declare
  v public.shifts;
begin
  if p_opening_float_cents is null or p_opening_float_cents < 0 then
    perform private.fail('invalid', 'Opening float must be $0.00 or more');
  end if;
  begin
    insert into public.shifts (staff_id, opening_float_cents)
    values (p_staff, p_opening_float_cents)
    returning * into v;
  exception when unique_violation then
    perform private.fail('shift_already_open', 'A shift is already open');
  end;
  insert into public.audit_log (actor_staff_id, action, entity, entity_id, after)
  values (p_staff, 'shift.open', 'shifts', v.id::text, jsonb_build_object('opening_float_cents', p_opening_float_cents));
  return v;
end;
$$;

create or replace function public.pos_cash_movement(p_staff uuid, p_kind text, p_amount_cents int, p_reason text)
returns public.cash_movements
language plpgsql
set search_path = ''
as $$
declare
  v_shift uuid;
  v public.cash_movements;
begin
  if p_kind not in ('paid_in', 'paid_out') then
    perform private.fail('invalid', 'Movement must be paid_in or paid_out');
  end if;
  if p_amount_cents is null or p_amount_cents <= 0 then
    perform private.fail('invalid', 'Amount must be more than $0.00');
  end if;
  if p_reason is null or length(trim(p_reason)) = 0 then
    perform private.fail('invalid', 'A reason is required');
  end if;
  select id into v_shift from public.shifts where closed_at is null for update;
  if v_shift is null then
    perform private.fail('no_open_shift', 'Open a shift first');
  end if;
  insert into public.cash_movements (shift_id, kind, amount_cents, reason, staff_id)
  values (v_shift, p_kind, case when p_kind = 'paid_in' then p_amount_cents else -p_amount_cents end, trim(p_reason), p_staff)
  returning * into v;
  insert into public.audit_log (actor_staff_id, action, entity, entity_id, after, reason)
  values (p_staff, 'shift.' || p_kind, 'cash_movements', v.id::text, to_jsonb(v), trim(p_reason));
  return v;
end;
$$;

-- Expected drawer cash and card total for a shift.
create or replace function public.pos_shift_totals(p_shift uuid)
returns table (expected_cash_cents int, pos_card_total_cents int)
language sql
stable
set search_path = ''
as $$
  select
    (s.opening_float_cents
      + coalesce((select sum(m.amount_cents) from public.cash_movements m where m.shift_id = s.id), 0))::int,
    (coalesce((select sum(p.amount_cents) from public.payments p where p.shift_id = s.id and p.method = 'card_terminal'), 0)
      - coalesce((select sum(r.amount_cents) from public.refunds r join public.payments p on p.id = r.payment_id
                  where r.shift_id = s.id and p.method = 'card_terminal'), 0))::int
  from public.shifts s
  where s.id = p_shift;
$$;

create or replace function public.pos_close_shift(p_staff uuid, p_counted_cash_cents int, p_terminal_card_total_cents int)
returns public.shifts
language plpgsql
set search_path = ''
as $$
declare
  v public.shifts;
  t record;
  threshold int := (private.settings()).cash_variance_threshold_cents;
begin
  if p_counted_cash_cents is null or p_counted_cash_cents < 0
     or p_terminal_card_total_cents is null or p_terminal_card_total_cents < 0 then
    perform private.fail('invalid', 'Counted cash and terminal total must be $0.00 or more');
  end if;
  select * into v from public.shifts where closed_at is null for update;
  if v.id is null then
    perform private.fail('no_open_shift', 'There is no open shift');
  end if;
  if exists (select 1 from public.sessions where status = 'open') then
    perform private.fail('sessions_open', 'Close all open sessions before closing the shift');
  end if;
  select * into t from public.pos_shift_totals(v.id);
  update public.shifts set
    closed_at = now(),
    closed_by = p_staff,
    expected_cash_cents = t.expected_cash_cents,
    counted_cash_cents = p_counted_cash_cents,
    cash_variance_cents = p_counted_cash_cents - t.expected_cash_cents,
    pos_card_total_cents = t.pos_card_total_cents,
    terminal_card_total_cents = p_terminal_card_total_cents,
    card_variance_cents = p_terminal_card_total_cents - t.pos_card_total_cents,
    flagged = abs(p_counted_cash_cents - t.expected_cash_cents) > threshold
           or abs(p_terminal_card_total_cents - t.pos_card_total_cents) > threshold
  where id = v.id
  returning * into v;
  insert into public.audit_log (actor_staff_id, action, entity, entity_id, after)
  values (p_staff, 'shift.close', 'shifts', v.id::text, to_jsonb(v));
  return v;
end;
$$;

-- ── Sessions ────────────────────────────────────────────────────────────────
create or replace function public.pos_open_walk_in(p_resource uuid, p_staff uuid, p_now timestamptz default now())
returns public.sessions
language plpgsql
set search_path = ''
as $$
declare
  st public.venue_settings := private.settings();
  r public.resources;
  oh public.opening_hours;
  v_local timestamp := p_now at time zone st.timezone;
  v public.sessions;
begin
  select * into r from public.resources where id = p_resource;
  if r.id is null or not r.active then
    perform private.fail('resource_unavailable', 'That resource is not available');
  end if;

  select * into oh from public.opening_hours where day_of_week = extract(isodow from v_local)::int;
  if oh.day_of_week is null or oh.closed
     or v_local::time < oh.open_time
     or v_local::time >= oh.close_time - make_interval(mins => st.walkin_last_open_minutes) then
    perform private.fail('outside_opening_hours', 'Walk-ins can only be opened during opening hours');
  end if;

  if exists (
    select 1 from public.bookings
    where resource_id = p_resource and status in ('confirmed', 'arrived') and period @> p_now
  ) then
    perform private.fail('resource_booked', 'This resource is booked right now');
  end if;

  begin
    insert into public.sessions (resource_id, kind, opened_at, opened_by)
    values (p_resource, 'walk_in', p_now, p_staff)
    returning * into v;
  exception when unique_violation then
    perform private.fail('resource_in_use', 'This resource already has an open session');
  end;

  insert into public.audit_log (actor_staff_id, action, entity, entity_id, after)
  values (p_staff, 'session.open', 'sessions', v.id::text, jsonb_build_object('resource_id', p_resource, 'kind', 'walk_in', 'opened_at', p_now));
  return v;
end;
$$;

create or replace function public.pos_arrive_booking(p_booking uuid, p_staff uuid, p_now timestamptz default now())
returns public.sessions
language plpgsql
set search_path = ''
as $$
declare
  b public.bookings;
  v public.sessions;
begin
  select * into b from public.bookings where id = p_booking for update;
  if b.id is null then
    perform private.fail('not_found', 'Booking not found');
  end if;
  if b.status <> 'confirmed' then
    perform private.fail('booking_not_confirmed', 'Only confirmed bookings can be checked in');
  end if;
  if p_now < lower(b.period) - interval '15 minutes' or p_now >= upper(b.period) then
    perform private.fail('booking_not_current', 'Check-in opens 15 minutes before the booking and closes at its end');
  end if;

  begin
    insert into public.sessions (resource_id, booking_id, kind, opened_at, opened_by, member_id)
    values (b.resource_id, b.id, 'booking', p_now, p_staff, b.member_id)
    returning * into v;
  exception when unique_violation then
    perform private.fail('resource_in_use', 'Close the session running on this resource first');
  end;

  update public.bookings set status = 'arrived' where id = b.id;
  insert into public.audit_log (actor_staff_id, action, entity, entity_id, after)
  values (p_staff, 'booking.arrive', 'bookings', b.id::text, jsonb_build_object('session_id', v.id, 'arrived_at', p_now));
  return v;
end;
$$;

create or replace function public.pos_mark_no_show(p_booking uuid, p_staff uuid, p_now timestamptz default now())
returns public.bookings
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
  if b.status <> 'confirmed' then
    perform private.fail('booking_not_confirmed', 'Only confirmed bookings can be marked as no-show');
  end if;
  if p_now < lower(b.period) + make_interval(mins => (private.settings()).no_show_hold_minutes) then
    perform private.fail('no_show_too_early', 'A booking is held for its no-show period after the start time');
  end if;
  update public.bookings set status = 'no_show' where id = b.id returning * into b;
  insert into public.audit_log (actor_staff_id, action, entity, entity_id, after)
  values (p_staff, 'booking.no_show', 'bookings', b.id::text, jsonb_build_object('marked_at', p_now));
  return b;
end;
$$;

/*
 p_payload (built by the API from the pricing engine):
   closedAt            timestamptz   required
   memberId            uuid          optional
   referralCodeId      uuid          optional
   freeMinutes         int           default 0
   pricing             jsonb         required snapshot
   computedTotalCents  int           engine total
   totalCents          int           charged total (≠ computed only with override)
   gstCents            int           must equal round(total / 11)
   discountCents       int           referral discount, for the redemption ledger
   override            { reason, approverStaffId } | null
   method              'cash' | 'card_terminal' | 'free' | null (null only for a prepaid booking with nothing to pay)
   externalRef         text          optional terminal receipt number
   tenderedCents       int           required for cash
*/
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

  if s.status = 'open' then
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
    update public.sessions set status = 'voided', void_reason = trim(p_reason) where id = s.id;
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

-- ── Privileges ──────────────────────────────────────────────────────────────
revoke execute on function
  public.pos_open_shift(uuid, int),
  public.pos_cash_movement(uuid, text, int, text),
  public.pos_shift_totals(uuid),
  public.pos_close_shift(uuid, int, int),
  public.pos_open_walk_in(uuid, uuid, timestamptz),
  public.pos_arrive_booking(uuid, uuid, timestamptz),
  public.pos_mark_no_show(uuid, uuid, timestamptz),
  public.pos_close_session(uuid, uuid, jsonb),
  public.pos_void_session(uuid, uuid, text, timestamptz)
from public, anon, authenticated;

grant execute on function
  public.pos_open_shift(uuid, int),
  public.pos_cash_movement(uuid, text, int, text),
  public.pos_shift_totals(uuid),
  public.pos_close_shift(uuid, int, int),
  public.pos_open_walk_in(uuid, uuid, timestamptz),
  public.pos_arrive_booking(uuid, uuid, timestamptz),
  public.pos_mark_no_show(uuid, uuid, timestamptz),
  public.pos_close_session(uuid, uuid, jsonb),
  public.pos_void_session(uuid, uuid, text, timestamptz)
to service_role;
