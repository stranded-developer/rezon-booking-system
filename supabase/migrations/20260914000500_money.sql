-- Shifts, payments, refunds, cash movements, price overrides. Money records are append-only.

create table public.shifts (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references public.staff (id) on delete restrict,
  opened_at timestamptz not null default now(),
  closed_at timestamptz,
  opening_float_cents int not null check (opening_float_cents >= 0),
  expected_cash_cents int,
  counted_cash_cents int check (counted_cash_cents >= 0),
  cash_variance_cents int,
  pos_card_total_cents int check (pos_card_total_cents >= 0),
  terminal_card_total_cents int check (terminal_card_total_cents >= 0),
  card_variance_cents int,
  flagged boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint shifts_close_complete check (
    closed_at is null or (
      closed_at >= opened_at
      and expected_cash_cents is not null and counted_cash_cents is not null
      and cash_variance_cents = counted_cash_cents - expected_cash_cents
      and pos_card_total_cents is not null and terminal_card_total_cents is not null
      and card_variance_cents = terminal_card_total_cents - pos_card_total_cents
    )
  )
);
create unique index shifts_one_open_per_staff on public.shifts (staff_id) where closed_at is null;

create or replace function private.guard_shift_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- After close only the review flag may change.
  if old.closed_at is not null
     and (to_jsonb(new) - 'flagged' - 'updated_at') is distinct from (to_jsonb(old) - 'flagged' - 'updated_at') then
    raise exception 'Closed shifts cannot be changed' using errcode = 'restrict_violation';
  end if;
  return new;
end;
$$;
create trigger shifts_guard_update before update on public.shifts
  for each row execute function private.guard_shift_update();
create trigger shifts_updated_at before update on public.shifts
  for each row execute function private.set_updated_at();

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid references public.bookings (id) on delete restrict,
  session_id uuid references public.sessions (id) on delete restrict,
  member_id uuid references public.members (id) on delete restrict,
  method text not null check (method in ('cash', 'card_terminal', 'stripe', 'free')),
  amount_cents int not null check (amount_cents >= 0),
  gst_cents int not null check (gst_cents >= 0 and gst_cents <= amount_cents),
  external_ref text,
  staff_id uuid references public.staff (id) on delete restrict,
  shift_id uuid references public.shifts (id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint payments_one_target check (num_nonnulls(booking_id, session_id, member_id) = 1),
  constraint payments_in_venue_needs_shift check (
    method not in ('cash', 'card_terminal') or (shift_id is not null and staff_id is not null)
  ),
  constraint payments_stripe_ref check (method <> 'stripe' or external_ref is not null),
  constraint payments_free_is_zero check (method <> 'free' or amount_cents = 0)
);
create unique index payments_stripe_ref_unique on public.payments (external_ref) where method = 'stripe';
create index payments_shift_idx on public.payments (shift_id);
create index payments_created_idx on public.payments (created_at);
create trigger payments_append_only before update or delete on public.payments
  for each row execute function private.prevent_modification();

create table public.refunds (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references public.payments (id) on delete restrict,
  amount_cents int not null check (amount_cents > 0),
  reason text not null check (length(trim(reason)) > 0),
  stripe_refund_id text unique,
  staff_id uuid references public.staff (id) on delete restrict,
  shift_id uuid references public.shifts (id) on delete restrict,
  created_at timestamptz not null default now()
);
create index refunds_payment_idx on public.refunds (payment_id);

create or replace function private.guard_refund_insert()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  paid int;
  refunded int;
begin
  select amount_cents into paid from public.payments where id = new.payment_id for update;
  select coalesce(sum(amount_cents), 0) into refunded from public.refunds where payment_id = new.payment_id;
  if refunded + new.amount_cents > paid then
    raise exception 'Refunds (% + %) would exceed the payment (%)', refunded, new.amount_cents, paid
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
create trigger refunds_guard_insert before insert on public.refunds
  for each row execute function private.guard_refund_insert();
create trigger refunds_append_only before update or delete on public.refunds
  for each row execute function private.prevent_modification();

create table public.cash_movements (
  id uuid primary key default gen_random_uuid(),
  shift_id uuid not null references public.shifts (id) on delete restrict,
  kind text not null check (kind in ('sale', 'refund', 'paid_in', 'paid_out')),
  amount_cents int not null,
  reason text,
  payment_id uuid references public.payments (id) on delete restrict,
  refund_id uuid references public.refunds (id) on delete restrict,
  staff_id uuid not null references public.staff (id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint cash_movements_sign check (
    (kind in ('sale', 'paid_in') and amount_cents > 0)
    or (kind in ('refund', 'paid_out') and amount_cents < 0)
  ),
  constraint cash_movements_links check (
    (kind = 'sale' and payment_id is not null and refund_id is null)
    or (kind = 'refund' and refund_id is not null and payment_id is null)
    or (kind in ('paid_in', 'paid_out') and payment_id is null and refund_id is null
        and reason is not null and length(trim(reason)) > 0)
  )
);
create index cash_movements_shift_idx on public.cash_movements (shift_id);
create trigger cash_movements_append_only before update or delete on public.cash_movements
  for each row execute function private.prevent_modification();

create table public.price_overrides (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions (id) on delete restrict,
  original_cents int not null check (original_cents >= 0),
  new_cents int not null check (new_cents >= 0),
  reason text not null check (length(trim(reason)) > 0),
  requested_by uuid not null references public.staff (id) on delete restrict,
  approved_by uuid not null references public.staff (id) on delete restrict,
  created_at timestamptz not null default now()
);
create index price_overrides_session_idx on public.price_overrides (session_id);
create trigger price_overrides_append_only before update or delete on public.price_overrides
  for each row execute function private.prevent_modification();
