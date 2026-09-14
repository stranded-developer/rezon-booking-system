-- Row-level security and privileges.
-- Rule (spec/architecture.md §3): only the API (service_role) writes. Browser clients (anon /
-- authenticated) get read access scoped by role, and never see secret-ish columns.
-- Every future migration that adds a table must enable RLS and revoke writes the same way.

-- ── Identity helpers ─────────────────────────────────────────────────────────
create or replace function private.current_staff_role()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select role from public.staff where auth_user_id = auth.uid() and active;
$$;

create or replace function private.is_staff()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.current_staff_role() is not null;
$$;

create or replace function private.is_superadmin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(private.current_staff_role() = 'superadmin', false);
$$;

create or replace function private.current_customer_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select id from public.customers where auth_user_id = auth.uid();
$$;

revoke all on function private.current_staff_role(), private.is_staff(), private.is_superadmin(),
  private.current_customer_id() from public;
grant execute on function private.current_staff_role(), private.is_staff(), private.is_superadmin(),
  private.current_customer_id() to authenticated, service_role;

-- ── Enable RLS everywhere and remove client write privileges ────────────────
do $$
declare
  t text;
begin
  foreach t in array array[
    'venue_settings', 'opening_hours', 'resource_types', 'resources', 'rate_bands', 'happy_hours',
    'staff', 'customers', 'membership_tiers', 'tier_prices', 'members',
    'referral_codes', 'bookings', 'sessions', 'member_balance_ledger', 'referral_redemptions',
    'shifts', 'payments', 'refunds', 'cash_movements', 'price_overrides',
    'stripe_events', 'audit_log', 'email_log'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke insert, update, delete, truncate on public.%I from anon, authenticated', t);
  end loop;
end;
$$;

revoke all on sequence public.member_no_seq from anon, authenticated;
revoke all on public.member_balances from anon, authenticated;
grant select on public.member_balances to authenticated;

-- ── Public configuration (booking site) ─────────────────────────────────────
-- Separate anon and authenticated policies: anon must never evaluate staff helpers
-- (anon has no access to the private schema).
create policy "public read opening hours" on public.opening_hours
  for select to anon, authenticated using (true);

do $$
declare
  t text;
begin
  foreach t in array array['resource_types', 'resources', 'rate_bands', 'happy_hours', 'membership_tiers'] loop
    execute format(
      'create policy "anon read active" on public.%I for select to anon using (active)', t
    );
    execute format(
      'create policy "signed-in read active, staff read all" on public.%I for select to authenticated '
      'using (active or (select private.is_staff()))', t
    );
  end loop;
end;
$$;

-- ── Staff-readable operational data (POS realtime + back office) ─────────────
do $$
declare
  t text;
begin
  foreach t in array array[
    'venue_settings', 'tier_prices', 'customers', 'members', 'referral_codes', 'bookings', 'sessions',
    'member_balance_ledger', 'referral_redemptions', 'shifts', 'payments', 'refunds',
    'cash_movements', 'price_overrides', 'staff'
  ] loop
    execute format(
      'create policy "staff read" on public.%I for select to authenticated using ((select private.is_staff()))',
      t
    );
  end loop;
end;
$$;

create policy "superadmin read audit log" on public.audit_log
  for select to authenticated using ((select private.is_superadmin()));

create policy "superadmin read email log" on public.email_log
  for select to authenticated using ((select private.is_superadmin()));
-- stripe_events: no client policy at all (service_role only).

-- ── Members read their own records ──────────────────────────────────────────
create policy "customer reads self" on public.customers
  for select to authenticated using (auth_user_id = (select auth.uid()));

create policy "member reads own membership" on public.members
  for select to authenticated using (customer_id = (select private.current_customer_id()));

create policy "member reads own ledger" on public.member_balance_ledger
  for select to authenticated using (
    member_id in (select id from public.members where customer_id = (select private.current_customer_id()))
  );

create policy "customer reads own bookings" on public.bookings
  for select to authenticated using (customer_id = (select private.current_customer_id()));

-- ── Hide sensitive columns from browser clients ─────────────────────────────
-- Column privileges apply on top of RLS. Clients must select explicit columns on these tables.
revoke select on public.staff from anon, authenticated;
grant select (id, display_name, role, active) on public.staff to authenticated;

revoke select on public.members from anon, authenticated;
grant select (
  id, customer_id, member_no, tier_id, pending_tier_id, status, current_period_end, ended_at,
  created_at, updated_at
) on public.members to authenticated;

revoke select on public.bookings from anon, authenticated;
grant select (
  id, ref, resource_id, customer_id, member_id, period, status, hold_expires_at, free_minutes_used,
  referral_code_id, pricing_snapshot, total_cents, gst_cents, cancelled_at, cancel_reason, refund_cents,
  created_at, updated_at
) on public.bookings to authenticated;

-- Everything else in the private tables is not for anonymous visitors.
revoke select on public.venue_settings, public.tier_prices, public.customers, public.referral_codes,
  public.sessions, public.member_balance_ledger, public.referral_redemptions, public.shifts,
  public.payments, public.refunds, public.cash_movements, public.price_overrides,
  public.stripe_events, public.audit_log, public.email_log
  from anon;

-- ── Realtime for the POS floor view ─────────────────────────────────────────
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.sessions, public.bookings;
  end if;
end;
$$;
