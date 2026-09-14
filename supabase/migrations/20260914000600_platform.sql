-- Stripe event idempotency, audit log, email log.

create table public.stripe_events (
  id text primary key,
  type text not null,
  payload jsonb not null,
  received_at timestamptz not null default now(),
  processed_at timestamptz
);

create table public.audit_log (
  id bigint generated always as identity primary key,
  actor_staff_id uuid references public.staff (id) on delete restrict,
  approver_staff_id uuid references public.staff (id) on delete restrict,
  action text not null check (length(trim(action)) > 0),
  entity text not null check (length(trim(entity)) > 0),
  entity_id text,
  before jsonb,
  after jsonb,
  reason text,
  ip inet,
  created_at timestamptz not null default now()
);
comment on column public.audit_log.actor_staff_id is 'null for system actors (webhooks, cron)';
create index audit_log_entity_idx on public.audit_log (entity, entity_id);
create index audit_log_actor_idx on public.audit_log (actor_staff_id, created_at);
create index audit_log_created_idx on public.audit_log (created_at);
create trigger audit_log_append_only before update or delete on public.audit_log
  for each row execute function private.prevent_modification();

create table public.email_log (
  id uuid primary key default gen_random_uuid(),
  to_address text not null,
  template text not null,
  entity text,
  entity_id text,
  provider_id text,
  status text not null default 'queued' check (status in ('queued', 'sent', 'failed')),
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index email_log_once_per_entity on public.email_log (template, entity, entity_id)
  where status <> 'failed' and entity_id is not null;
create trigger email_log_updated_at before update on public.email_log
  for each row execute function private.set_updated_at();
