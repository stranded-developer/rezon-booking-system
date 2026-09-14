-- Staff, customers, membership tiers, members.

create table public.staff (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null unique references auth.users (id) on delete restrict,
  display_name text not null check (length(trim(display_name)) > 0),
  role text not null check (role in ('superadmin', 'cashier')),
  pin_hash text not null,
  pin_failed_count int not null default 0 check (pin_failed_count >= 0),
  pin_locked_until timestamptz,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Never leave the venue without an active superadmin.
create or replace function private.guard_last_superadmin()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  others int;
begin
  if old.role = 'superadmin' and old.active
     and (tg_op = 'DELETE' or new.role <> 'superadmin' or not new.active) then
    select count(*) into others
    from public.staff
    where role = 'superadmin' and active and id <> old.id;
    if others = 0 then
      raise exception 'Cannot remove the last active superadmin'
        using errcode = 'check_violation';
    end if;
  end if;
  return coalesce(new, old);
end;
$$;

create trigger staff_guard_last_superadmin before update or delete on public.staff
  for each row execute function private.guard_last_superadmin();
create trigger staff_updated_at before update on public.staff
  for each row execute function private.set_updated_at();

create table public.customers (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid unique references auth.users (id) on delete set null,
  name text not null check (length(trim(name)) > 0),
  email extensions.citext,
  phone text,
  stripe_customer_id text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (email is not null or phone is not null)
);
comment on table public.customers is 'Guests and members. Only members have auth_user_id.';
create index customers_email_idx on public.customers (email);
create index customers_phone_idx on public.customers (phone);
create trigger customers_updated_at before update on public.customers
  for each row execute function private.set_updated_at();

create table public.membership_tiers (
  id uuid primary key default gen_random_uuid(),
  name extensions.citext not null unique check (length(trim(name)) > 0),
  discount_bp int not null check (discount_bp >= 0 and discount_bp < 10000),
  monthly_price_cents int not null check (monthly_price_cents >= 0),
  monthly_free_minutes int not null check (monthly_free_minutes >= 0),
  max_balance_minutes int not null check (max_balance_minutes >= 0),
  stripe_product_id text unique,
  stripe_price_id text unique,
  sort int not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on column public.membership_tiers.monthly_price_cents is 'GST-inclusive';
create trigger membership_tiers_updated_at before update on public.membership_tiers
  for each row execute function private.set_updated_at();

create table public.tier_prices (
  id uuid primary key default gen_random_uuid(),
  tier_id uuid not null references public.membership_tiers (id) on delete restrict,
  amount_cents int not null check (amount_cents >= 0),
  stripe_price_id text unique,
  effective_from timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index tier_prices_tier_idx on public.tier_prices (tier_id, effective_from desc);

create sequence public.member_no_seq start 1;

create table public.members (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null unique references public.customers (id) on delete restrict,
  member_no text not null unique
    default ('RG-' || lpad(nextval('public.member_no_seq')::text, 6, '0')),
  tier_id uuid not null references public.membership_tiers (id) on delete restrict,
  pending_tier_id uuid references public.membership_tiers (id) on delete restrict,
  status text not null default 'pending'
    check (status in ('pending', 'active', 'past_due', 'cancelling', 'ended')),
  qr_token_hash text unique,
  current_period_end timestamptz,
  ended_at timestamptz,
  stripe_subscription_id text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (pending_tier_id is null or pending_tier_id <> tier_id),
  check ((status = 'ended') = (ended_at is not null))
);
comment on column public.members.qr_token_hash is 'sha256 hex of the random QR token; the token itself is never stored';
comment on column public.members.pending_tier_id is 'Tier change applied on the next invoice.paid';
create index members_status_idx on public.members (status);
create trigger members_updated_at before update on public.members
  for each row execute function private.set_updated_at();
