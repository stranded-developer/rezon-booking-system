-- Venue configuration, resources, rates, happy hours.

create table public.venue_settings (
  id smallint primary key default 1 check (id = 1),
  timezone text not null default 'Australia/Sydney',
  business_name text,
  abn text check (abn is null or abn ~ '^[0-9]{11}$'),
  booking_window_days int not null default 7 check (booking_window_days between 0 and 365),
  online_cutoff_minutes int not null default 30 check (online_cutoff_minutes >= 0),
  no_show_hold_minutes int not null default 15 check (no_show_hold_minutes >= 0),
  hold_ttl_minutes int not null default 30 check (hold_ttl_minutes between 30 and 1440),
  walkin_last_open_minutes int not null default 15 check (walkin_last_open_minutes >= 0),
  cash_variance_threshold_cents int not null default 2000 check (cash_variance_threshold_cents >= 0),
  balance_forfeit_days int not null default 30 check (balance_forfeit_days >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on column public.venue_settings.abn is 'Australian Business Number, 11 digits without spaces';
comment on column public.venue_settings.hold_ttl_minutes is 'Min 30: Stripe Checkout sessions cannot expire sooner';

create table public.opening_hours (
  day_of_week smallint primary key check (day_of_week between 1 and 7),
  open_time time not null,
  close_time time not null,
  closed boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (close_time > open_time)
);
comment on column public.opening_hours.day_of_week is 'ISO day: 1 = Monday … 7 = Sunday';

create table public.resource_types (
  id uuid primary key default gen_random_uuid(),
  key text not null unique check (key ~ '^[a-z0-9_]+$'),
  name text not null check (length(trim(name)) > 0),
  base_rate_cents int not null check (base_rate_cents >= 0),
  min_minutes int not null check (min_minutes > 0),
  sort int not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on column public.resource_types.base_rate_cents is 'Hourly rate in cents, GST-inclusive';

create table public.resources (
  id uuid primary key default gen_random_uuid(),
  resource_type_id uuid not null references public.resource_types (id) on delete restrict,
  label text not null check (length(trim(label)) > 0),
  sort int not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (resource_type_id, label)
);
create index resources_type_idx on public.resources (resource_type_id);

create table public.rate_bands (
  id uuid primary key default gen_random_uuid(),
  resource_type_id uuid not null references public.resource_types (id) on delete restrict,
  days_of_week smallint[] not null
    check (cardinality(days_of_week) > 0 and days_of_week <@ '{1,2,3,4,5,6,7}'::smallint[]),
  start_time time not null,
  end_time time not null,
  rate_cents int not null check (rate_cents >= 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_time > start_time)
);
comment on table public.rate_bands is 'Optional overrides of resource_types.base_rate_cents. Overlaps rejected by the API (packages/pricing validateRateBands).';
create index rate_bands_type_idx on public.rate_bands (resource_type_id);

create table public.happy_hours (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) > 0),
  resource_type_ids uuid[] check (resource_type_ids is null or cardinality(resource_type_ids) > 0),
  days_of_week smallint[] not null
    check (cardinality(days_of_week) > 0 and days_of_week <@ '{1,2,3,4,5,6,7}'::smallint[]),
  start_time time not null,
  end_time time not null,
  discount_bp int not null check (discount_bp > 0 and discount_bp < 10000),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_time > start_time)
);
comment on column public.happy_hours.resource_type_ids is 'null = applies to every resource type';

create trigger venue_settings_updated_at before update on public.venue_settings
  for each row execute function private.set_updated_at();
create trigger opening_hours_updated_at before update on public.opening_hours
  for each row execute function private.set_updated_at();
create trigger resource_types_updated_at before update on public.resource_types
  for each row execute function private.set_updated_at();
create trigger resources_updated_at before update on public.resources
  for each row execute function private.set_updated_at();
create trigger rate_bands_updated_at before update on public.rate_bands
  for each row execute function private.set_updated_at();
create trigger happy_hours_updated_at before update on public.happy_hours
  for each row execute function private.set_updated_at();
