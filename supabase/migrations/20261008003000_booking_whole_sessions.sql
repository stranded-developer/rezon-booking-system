-- D90: online bookings are sold in whole 30-minute sessions starting on :00 and :30 (no 45- or
-- 75-minute bookings, no 2:15 starts). Walk-ins at the counter are unchanged here.
-- booking_hold is copied from 20260930002500_game_track_car.sql and changed only in its time rules.

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
  v_experience uuid := nullif(p ->> 'experienceId', '')::uuid;
  v_exp public.experiences;
  v_setup jsonb := case when jsonb_typeof(p -> 'simSetup') = 'object' then p -> 'simSetup' end;
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
  -- D90: online, time is sold in whole sessions that start on the session grid (:00 and :30
  -- for a 30-minute session). Walk-ins at the counter keep their 15-minute blocks.
  if extract(second from v_local_start) <> 0
     or (extract(hour from v_local_start)::int * 60 + extract(minute from v_local_start)::int) % st.session_minutes <> 0 then
    perform private.fail('invalid_time', format('Bookings start on a %s-minute mark, e.g. on the hour', st.session_minutes));
  end if;

  -- D65: an experience sets its own length, so the session rules below do not apply to it.
  if v_experience is not null then
    select * into v_exp from public.experiences where id = v_experience;
    if v_exp.id is null or not v_exp.active then
      perform private.fail('experience_unavailable', 'That experience is not available');
    end if;
    if v_exp.resource_type_id <> v_type.id then
      perform private.fail('invalid', 'That experience is not available on this resource');
    end if;
    if v_minutes <> v_exp.minutes then
      perform private.fail('invalid_time', format('%s runs for %s minutes', v_exp.name, v_exp.minutes));
    end if;
    -- Free play on an experience is taken in whole sessions (D65).
    if v_free > 0 and v_free % st.session_minutes <> 0 then
      perform private.fail('invalid', format('Free play on %s is used %s minutes at a time', v_exp.name, st.session_minutes));
    end if;
  else
    -- D90 (replaces D63's 15-minute steps): a booking is a whole number of sessions.
    if v_minutes < st.session_minutes or v_minutes % st.session_minutes <> 0 then
      perform private.fail('invalid_time', format('Bookings are in %s-minute sessions', st.session_minutes));
    end if;
    -- Free play is spent the way the time is sold: whole sessions.
    if v_free > 0 and v_free % st.session_minutes <> 0 then
      perform private.fail('invalid', format('Free play on a booking is used %s minutes at a time', st.session_minutes));
    end if;
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
      pricing_snapshot, total_cents, gst_cents, cancel_token_hash, experience_id, sim_setup
    ) values (
      v_resource.id, v_customer, v_member, tstzrange(v_start, v_end, '[)'), 'held',
      v_now + make_interval(mins => st.hold_ttl_minutes + 10), v_free, v_referral,
      p -> 'pricing', v_total, (p ->> 'gstCents')::int, p ->> 'cancelTokenHash', v_experience, v_setup
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
                             'member_id', v_member, 'referral_code_id', v_referral, 'free_minutes', v_free,
                             'experience_id', v_experience));
  return v_booking;
end;
$$;

revoke execute on function public.booking_hold(jsonb) from public, anon, authenticated;
grant execute on function public.booking_hold(jsonb) to service_role;
