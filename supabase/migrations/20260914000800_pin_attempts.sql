-- Atomic PIN attempt bookkeeping for POS operator switching (spec/pos.md §1).
-- The API verifies the PIN hash, then records the outcome here under a row lock so parallel
-- guesses cannot exceed the attempt limit. A success is only honoured if the staff member
-- is not locked at the moment it is recorded.

create or replace function public.register_pin_attempt(
  p_staff_id uuid,
  p_success boolean,
  p_max_attempts int default 5,
  p_lock_minutes int default 5
)
returns table (accepted boolean, locked_until timestamptz, just_locked boolean, failed_count int)
language plpgsql
set search_path = ''
as $$
declare
  s public.staff%rowtype;
begin
  select * into s from public.staff where id = p_staff_id for update;
  if not found or not s.active then
    return query select false, null::timestamptz, false, 0;
    return;
  end if;

  if s.pin_locked_until is not null and s.pin_locked_until > now() then
    return query select false, s.pin_locked_until, false, s.pin_failed_count;
    return;
  end if;

  if p_success then
    update public.staff set pin_failed_count = 0, pin_locked_until = null where id = p_staff_id;
    return query select true, null::timestamptz, false, 0;
    return;
  end if;

  if s.pin_failed_count + 1 >= p_max_attempts then
    update public.staff
    set pin_failed_count = 0, pin_locked_until = now() + make_interval(mins => p_lock_minutes)
    where id = p_staff_id
    returning public.staff.pin_locked_until into s.pin_locked_until;
    return query select false, s.pin_locked_until, true, 0;
  else
    update public.staff set pin_failed_count = s.pin_failed_count + 1 where id = p_staff_id;
    return query select false, null::timestamptz, false, s.pin_failed_count + 1;
  end if;
end;
$$;

revoke execute on function public.register_pin_attempt(uuid, boolean, int, int) from public, anon, authenticated;
grant execute on function public.register_pin_attempt(uuid, boolean, int, int) to service_role;
