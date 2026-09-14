-- Referral codes, bookings, sessions, free-play ledger, redemptions.

create table public.referral_codes (
  id uuid primary key default gen_random_uuid(),
  code extensions.citext not null unique default private.random_code(6)
    check (code::text ~ '^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{6}$'),
  discount_type text not null check (discount_type in ('percent', 'fixed')),
  discount_value int not null,
  max_uses int not null check (max_uses > 0),
  uses_count int not null default 0 check (uses_count >= 0),
  valid_until timestamptz,
  active boolean not null default true,
  created_by uuid references public.staff (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint referral_codes_uses_within_max check (uses_count <= max_uses),
  constraint referral_codes_value_valid check (
    (discount_type = 'percent' and discount_value > 0 and discount_value < 10000)
    or (discount_type = 'fixed' and discount_value > 0)
  )
);
comment on column public.referral_codes.discount_value is 'Basis points if percent, cents if fixed';
create trigger referral_codes_updated_at before update on public.referral_codes
  for each row execute function private.set_updated_at();

create table public.bookings (
  id uuid primary key default gen_random_uuid(),
  ref text not null unique default private.random_code(6)
    check (ref ~ '^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{6}$'),
  resource_id uuid not null references public.resources (id) on delete restrict,
  customer_id uuid not null references public.customers (id) on delete restrict,
  member_id uuid references public.members (id) on delete restrict,
  period tstzrange not null,
  status text not null default 'held'
    check (status in ('held', 'confirmed', 'arrived', 'completed', 'cancelled', 'no_show', 'expired')),
  hold_expires_at timestamptz,
  free_minutes_used int not null default 0 check (free_minutes_used >= 0),
  referral_code_id uuid references public.referral_codes (id) on delete restrict,
  pricing_snapshot jsonb,
  total_cents int check (total_cents >= 0),
  gst_cents int check (gst_cents >= 0),
  stripe_checkout_session_id text unique,
  stripe_payment_intent_id text unique,
  cancel_token_hash text,
  cancelled_at timestamptz,
  cancelled_by_staff_id uuid references public.staff (id) on delete restrict,
  cancel_reason text,
  refund_cents int check (refund_cents >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint bookings_period_valid check (
    not isempty(period) and lower_inc(period) and not upper_inc(period)
    and not lower_inf(period) and not upper_inf(period)
  ),
  constraint bookings_member_xor_referral check (member_id is null or referral_code_id is null),
  constraint bookings_free_minutes_need_member check (free_minutes_used = 0 or member_id is not null),
  constraint bookings_hold_has_expiry check (status <> 'held' or hold_expires_at is not null),
  constraint bookings_paid_has_price check (
    status in ('held', 'expired') or (total_cents is not null and gst_cents is not null and pricing_snapshot is not null)
  ),
  constraint bookings_cancel_details check ((status = 'cancelled') = (cancelled_at is not null)),
  -- Double-booking is structurally impossible for live bookings.
  constraint bookings_no_overlap exclude using gist (resource_id with =, period with &&)
    where (status in ('held', 'confirmed', 'arrived'))
);
create index bookings_customer_idx on public.bookings (customer_id);
create index bookings_member_idx on public.bookings (member_id);
create index bookings_period_idx on public.bookings using gist (period);

create or replace function private.guard_booking_status()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status is distinct from old.status and not (
    (old.status = 'held' and new.status in ('confirmed', 'expired', 'cancelled'))
    or (old.status = 'confirmed' and new.status in ('arrived', 'cancelled', 'no_show'))
    or (old.status = 'arrived' and new.status = 'completed')
  ) then
    raise exception 'Booking status cannot change from % to %', old.status, new.status
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger bookings_guard_status before update on public.bookings
  for each row execute function private.guard_booking_status();
create trigger bookings_updated_at before update on public.bookings
  for each row execute function private.set_updated_at();

-- Called in the same transaction before creating a hold, so stale holds never block a slot.
create or replace function public.expire_stale_holds()
returns int
language sql
set search_path = ''
as $$
  with expired as (
    update public.bookings
    set status = 'expired'
    where status = 'held' and hold_expires_at < now()
    returning 1
  )
  select count(*)::int from expired;
$$;
revoke execute on function public.expire_stale_holds() from public, anon, authenticated;
grant execute on function public.expire_stale_holds() to service_role;

create table public.sessions (
  id uuid primary key default gen_random_uuid(),
  resource_id uuid not null references public.resources (id) on delete restrict,
  booking_id uuid references public.bookings (id) on delete restrict,
  kind text not null check (kind in ('walk_in', 'booking', 'overstay')),
  opened_at timestamptz not null,
  closed_at timestamptz,
  opened_by uuid not null references public.staff (id) on delete restrict,
  closed_by uuid references public.staff (id) on delete restrict,
  status text not null default 'open' check (status in ('open', 'closed', 'voided')),
  member_id uuid references public.members (id) on delete restrict,
  referral_code_id uuid references public.referral_codes (id) on delete restrict,
  free_minutes_used int not null default 0 check (free_minutes_used >= 0),
  pricing_snapshot jsonb,
  total_cents int check (total_cents >= 0),
  gst_cents int check (gst_cents >= 0),
  void_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint sessions_booking_kind check ((kind = 'walk_in') = (booking_id is null)),
  constraint sessions_member_xor_referral check (member_id is null or referral_code_id is null),
  constraint sessions_free_minutes_need_member check (free_minutes_used = 0 or member_id is not null),
  constraint sessions_open_state check (
    status <> 'open' or (closed_at is null and closed_by is null and total_cents is null)
  ),
  constraint sessions_closed_state check (
    status = 'open' or (
      closed_at is not null and closed_at >= opened_at and closed_by is not null
      and total_cents is not null and gst_cents is not null and pricing_snapshot is not null
    )
  ),
  constraint sessions_void_reason check ((status = 'voided') = (void_reason is not null))
);
-- One open session per resource.
create unique index sessions_one_open_per_resource on public.sessions (resource_id) where status = 'open';
create index sessions_booking_idx on public.sessions (booking_id);
create index sessions_opened_at_idx on public.sessions (opened_at);

-- A closed session is a financial record: the only permitted change is closed → voided.
create or replace function private.guard_session_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status = 'voided' then
    raise exception 'Voided sessions cannot be changed' using errcode = 'restrict_violation';
  end if;
  if old.status = 'closed' then
    if new.status <> 'voided'
       or (to_jsonb(new) - 'status' - 'void_reason' - 'updated_at')
          is distinct from (to_jsonb(old) - 'status' - 'void_reason' - 'updated_at') then
      raise exception 'Closed sessions can only be voided' using errcode = 'restrict_violation';
    end if;
  end if;
  return new;
end;
$$;

create trigger sessions_guard_update before update on public.sessions
  for each row execute function private.guard_session_update();
create trigger sessions_updated_at before update on public.sessions
  for each row execute function private.set_updated_at();

create table public.member_balance_ledger (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.members (id) on delete restrict,
  delta_minutes int not null check (delta_minutes <> 0),
  kind text not null check (kind in ('grant', 'use', 'return', 'adjust', 'forfeit')),
  booking_id uuid references public.bookings (id) on delete restrict,
  session_id uuid references public.sessions (id) on delete restrict,
  stripe_invoice_id text unique,
  actor_staff_id uuid references public.staff (id) on delete restrict,
  reason text,
  created_at timestamptz not null default now(),
  constraint ledger_sign_matches_kind check (
    (kind in ('grant', 'return') and delta_minutes > 0)
    or (kind in ('use', 'forfeit') and delta_minutes < 0)
    or kind = 'adjust'
  ),
  constraint ledger_use_has_target check (
    kind not in ('use', 'return') or num_nonnulls(booking_id, session_id) = 1
  ),
  constraint ledger_grant_has_invoice check (kind <> 'grant' or stripe_invoice_id is not null),
  constraint ledger_adjust_has_actor check (
    kind <> 'adjust' or (actor_staff_id is not null and reason is not null and length(trim(reason)) > 0)
  )
);
create index ledger_member_idx on public.member_balance_ledger (member_id, created_at);

-- Serialise balance writes per member and keep the balance non-negative.
create or replace function private.guard_ledger_insert()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  balance int;
begin
  perform 1 from public.members where id = new.member_id for update;
  select coalesce(sum(delta_minutes), 0) + new.delta_minutes into balance
  from public.member_balance_ledger
  where member_id = new.member_id;
  if balance < 0 then
    raise exception 'Insufficient free-play balance (would be % min)', balance
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger ledger_guard_insert before insert on public.member_balance_ledger
  for each row execute function private.guard_ledger_insert();
create trigger ledger_append_only before update or delete on public.member_balance_ledger
  for each row execute function private.prevent_modification();

create view public.member_balances
with (security_invoker = true)
as
  select m.id as member_id, coalesce(sum(l.delta_minutes), 0)::int as balance_minutes
  from public.members m
  left join public.member_balance_ledger l on l.member_id = m.id
  group by m.id;

create table public.referral_redemptions (
  id uuid primary key default gen_random_uuid(),
  code_id uuid not null references public.referral_codes (id) on delete restrict,
  booking_id uuid unique references public.bookings (id) on delete restrict,
  session_id uuid unique references public.sessions (id) on delete restrict,
  discount_cents int not null check (discount_cents >= 0),
  created_at timestamptz not null default now(),
  check (num_nonnulls(booking_id, session_id) = 1)
);
create index referral_redemptions_code_idx on public.referral_redemptions (code_id);
create trigger referral_redemptions_append_only before update or delete on public.referral_redemptions
  for each row execute function private.prevent_modification();
