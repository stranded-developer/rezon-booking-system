-- Experiences, promotional prices, tournaments and site events (D65–D70).
--
--   Experience  : a named package with a fixed length and a flat price, e.g. Quick Race,
--                 30 minutes for $35. Simulators are sold this way online. Billiards and VR
--                 keep the hourly rate, and every walk-in stays hourly (D65).
--   Promo price : a named window with its own flat price for one experience. The cheapest
--                 matching one wins, which is what makes "the student price is not included
--                 in Happy Hour" true without a rule for it (D66).
--   Tournament  : a dated event with a number of spots and an entry fee (D68).
--   Site event  : the pop-up and banner on the public site (D69).
--
-- Every price here is GST-inclusive integer cents, like every other price in the database.

-- ── Experiences ─────────────────────────────────────────────────────────────

create table public.experiences (
  id uuid primary key default gen_random_uuid(),
  key text not null unique check (key ~ '^[a-z0-9_]+$'),
  resource_type_id uuid not null references public.resource_types (id) on delete restrict,
  name text not null check (length(trim(name)) > 0),
  tagline text,
  bullets text[] not null default '{}',
  badges text[] not null default '{}',
  minutes int not null check (minutes > 0 and minutes % 15 = 0),
  price_cents int not null check (price_cents >= 0),
  sort int not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.experiences is 'A named package: fixed length, flat price (D65). Not an hourly rate.';
comment on column public.experiences.price_cents is 'Flat price for the whole experience, GST-inclusive';
comment on column public.experiences.badges is 'Short labels shown on the card, e.g. "Most popular"';
create index experiences_type_idx on public.experiences (resource_type_id);

create table public.experience_promos (
  id uuid primary key default gen_random_uuid(),
  experience_id uuid not null references public.experiences (id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  days_of_week smallint[] not null
    check (cardinality(days_of_week) > 0 and days_of_week <@ '{1,2,3,4,5,6,7}'::smallint[]),
  start_time time not null,
  end_time time not null,
  price_cents int not null check (price_cents >= 0),
  claimed boolean not null default false,
  active boolean not null default true,
  sort int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_time > start_time)
);
comment on table public.experience_promos is
  'Flat promotional prices (D66). Overlaps are allowed on purpose: the cheapest matching price wins.';
comment on column public.experience_promos.claimed is
  'true = only applies when the customer asks for it (e.g. a student price)';
create index experience_promos_experience_idx on public.experience_promos (experience_id);

-- A booking may be the sale of an experience rather than a length of time.
alter table public.bookings
  add column experience_id uuid references public.experiences (id) on delete restrict;
comment on column public.bookings.experience_id is 'Set when the booking was sold as an experience (D65)';
create index bookings_experience_idx on public.bookings (experience_id) where experience_id is not null;

-- ── Membership: new launch values, listed perks, tournament entries ─────────

alter table public.membership_tiers
  add column perks text[] not null default '{}',
  add column monthly_free_tournaments int not null default 0 check (monthly_free_tournaments >= 0);
comment on column public.membership_tiers.perks is
  'Listed on the membership page but not enforced by the system (D67). Staff honour them at the counter.';
comment on column public.membership_tiers.monthly_free_tournaments is
  'Free tournament entries a month. 0 at launch: the flow is built, the perk is off (D68).';

-- New prices and percentages (D67). Only tiers still on their previous launch values are moved,
-- so anything the venue has already changed is left alone.
update public.membership_tiers
   set monthly_price_cents = 48_00, discount_bp = 1000
 where name = 'Silver' and monthly_price_cents = 100_00 and discount_bp = 500;
update public.membership_tiers
   set monthly_price_cents = 78_00, discount_bp = 2000
 where name = 'Gold' and monthly_price_cents = 200_00 and discount_bp = 1000;
update public.membership_tiers
   set monthly_price_cents = 128_00, discount_bp = 2000
 where name = 'Diamond' and monthly_price_cents = 300_00 and discount_bp = 1500;

-- tier_prices is a history, so a price change adds a row rather than editing one
-- (the same thing admin_set_tier_price does).
insert into public.tier_prices (tier_id, amount_cents)
select mt.id, mt.monthly_price_cents
  from public.membership_tiers mt
 where not exists (
   select 1 from public.tier_prices tp
    where tp.tier_id = mt.id and tp.amount_cents = mt.monthly_price_cents
 );

-- ── Tournaments ─────────────────────────────────────────────────────────────

create table public.tournaments (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) > 0),
  blurb text,
  starts_at timestamptz not null,
  spots int not null check (spots > 0),
  entry_fee_cents int not null check (entry_fee_cents >= 0),
  published boolean not null default false,
  sort int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.tournaments is 'A dated competition people sign up for (D68)';
create index tournaments_starts_idx on public.tournaments (starts_at);

create table public.tournament_entries (
  id uuid primary key default gen_random_uuid(),
  ref text not null unique default private.random_code(6)
    check (ref ~ '^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{6}$'),
  tournament_id uuid not null references public.tournaments (id) on delete restrict,
  customer_id uuid not null references public.customers (id) on delete restrict,
  member_id uuid references public.members (id) on delete restrict,
  status text not null default 'held'
    check (status in ('held', 'confirmed', 'cancelled', 'expired')),
  hold_expires_at timestamptz,
  -- true when the entry was covered by the member's monthly allowance rather than paid for.
  free_entry boolean not null default false,
  pricing_snapshot jsonb,
  total_cents int check (total_cents >= 0),
  gst_cents int check (gst_cents >= 0),
  stripe_checkout_session_id text unique,
  stripe_payment_intent_id text unique,
  cancel_token_hash text,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tournament_entries_hold_has_expiry check (status <> 'held' or hold_expires_at is not null),
  constraint tournament_entries_paid_has_price check (
    status in ('held', 'expired') or (total_cents is not null and gst_cents is not null)
  ),
  constraint tournament_entries_free_needs_member check (not free_entry or member_id is not null),
  constraint tournament_entries_cancel_details check ((status = 'cancelled') = (cancelled_at is not null))
);
-- One live entry per person per tournament; a cancelled one may be replaced.
create unique index tournament_entries_live_idx
  on public.tournament_entries (tournament_id, customer_id)
  where status in ('held', 'confirmed');
create index tournament_entries_tournament_idx on public.tournament_entries (tournament_id);
create index tournament_entries_member_idx on public.tournament_entries (member_id);

alter table public.payments
  add column tournament_entry_id uuid references public.tournament_entries (id) on delete restrict;
alter table public.payments drop constraint payments_one_target;
alter table public.payments add constraint payments_one_target
  check (num_nonnulls(booking_id, session_id, member_id, tournament_entry_id) = 1);

-- ── Site events: the pop-up and the banner ──────────────────────────────────

create table public.site_events (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(trim(title)) > 0),
  body text,
  detail text,
  cta_label text,
  cta_url text,
  show_from timestamptz,
  show_until timestamptz,
  as_popup boolean not null default true,
  as_banner boolean not null default true,
  active boolean not null default true,
  sort int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint site_events_window check (show_until is null or show_from is null or show_until > show_from),
  constraint site_events_cta_pair check ((cta_label is null) = (cta_url is null))
);
comment on table public.site_events is 'What the public site shows as a pop-up or a banner (D69)';
comment on column public.site_events.detail is 'A short highlight line, e.g. "$2,000 cash prize pool"';

create trigger experiences_updated_at before update on public.experiences
  for each row execute function private.set_updated_at();
create trigger experience_promos_updated_at before update on public.experience_promos
  for each row execute function private.set_updated_at();
create trigger tournaments_updated_at before update on public.tournaments
  for each row execute function private.set_updated_at();
create trigger tournament_entries_updated_at before update on public.tournament_entries
  for each row execute function private.set_updated_at();
create trigger site_events_updated_at before update on public.site_events
  for each row execute function private.set_updated_at();

-- ── Security: same rules as every other table (architecture.md §3) ──────────

do $$
declare
  t text;
begin
  foreach t in array array[
    'experiences', 'experience_promos', 'tournaments', 'tournament_entries', 'site_events'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke insert, update, delete, truncate on public.%I from anon, authenticated', t);
  end loop;
end;
$$;

-- Public configuration, read the same way as resource types and happy hours.
do $$
declare
  t text;
begin
  foreach t in array array['experiences', 'experience_promos', 'site_events'] loop
    execute format('create policy "anon read active" on public.%I for select to anon using (active)', t);
    execute format(
      'create policy "signed-in read active, staff read all" on public.%I for select to authenticated '
      'using (active or (select private.is_staff()))', t
    );
  end loop;
end;
$$;

create policy "anon read published tournaments" on public.tournaments
  for select to anon using (published);
create policy "signed-in read published tournaments, staff read all" on public.tournaments
  for select to authenticated using (published or (select private.is_staff()));

create policy "staff read tournament entries" on public.tournament_entries
  for select to authenticated using ((select private.is_staff()));
create policy "customer reads own tournament entries" on public.tournament_entries
  for select to authenticated using (customer_id = (select private.current_customer_id()));

-- ── Bookings: an experience is a fixed block at a flat price ────────────────
-- Copied from 20260916001700_sessions.sql and changed only where an experience is involved,
-- so nothing else in this money path can drift.

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
  if extract(second from v_local_start) <> 0 or extract(minute from v_local_start)::int % 15 <> 0
     or extract(epoch from (v_end - v_start))::int % 900 <> 0 then
    perform private.fail('invalid_time', 'Bookings start on the quarter hour and last in 15-minute steps');
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
    -- D63: a booking is at least one session, then 15-minute steps.
    if v_minutes < st.session_minutes then
      perform private.fail('invalid_time', format('A booking is at least one %s-minute session', st.session_minutes));
    end if;
    -- Free play is spent the way the time is sold: a whole session, then 15-minute steps.
    if v_free > 0 and (v_free < st.session_minutes or v_free % 15 <> 0) then
      perform private.fail('invalid', format('Free play on a booking starts at %s minutes, then 15-minute steps', st.session_minutes));
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
      pricing_snapshot, total_cents, gst_cents, cancel_token_hash, experience_id
    ) values (
      v_resource.id, v_customer, v_member, tstzrange(v_start, v_end, '[)'), 'held',
      v_now + make_interval(mins => st.hold_ttl_minutes + 10), v_free, v_referral,
      p -> 'pricing', v_total, (p ->> 'gstCents')::int, p ->> 'cancelTokenHash', v_experience
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

-- ── Tournament sign-up (D68) ────────────────────────────────────────────────

-- Spots left: confirmed entries, plus holds still waiting for payment.
create or replace function public.tournament_spots_left(p_tournament uuid, p_now timestamptz default now())
returns int
language sql
stable
set search_path = ''
as $$
  select greatest(0, t.spots - (
    select count(*)::int from public.tournament_entries e
    where e.tournament_id = t.id
      and (e.status = 'confirmed' or (e.status = 'held' and e.hold_expires_at > p_now))
  ))
  from public.tournaments t
  where t.id = p_tournament;
$$;
revoke execute on function public.tournament_spots_left(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.tournament_spots_left(uuid, timestamptz) to service_role, authenticated;

create or replace function public.expire_stale_tournament_holds(p_now timestamptz default now())
returns int
language sql
set search_path = ''
as $$
  with expired as (
    update public.tournament_entries
    set status = 'expired'
    where status = 'held' and hold_expires_at < p_now
    returning 1
  )
  select count(*)::int from expired;
$$;
revoke execute on function public.expire_stale_tournament_holds(timestamptz) from public, anon, authenticated;
grant execute on function public.expire_stale_tournament_holds(timestamptz) to service_role;

/*
  Sign up for a tournament, in one transaction.

  A member whose monthly free entries are not used up is entered straight away, free.
  Everyone else gets a hold and goes to payment, exactly like a booking. The allowance is
  0 for every tier at launch, so today every entry goes to payment (D68).
*/
create or replace function public.tournament_hold(p jsonb)
returns public.tournament_entries
language plpgsql
set search_path = ''
as $$
declare
  st public.venue_settings := private.settings();
  v_now timestamptz := coalesce((p ->> 'now')::timestamptz, now());
  v_tournament uuid := (p ->> 'tournamentId')::uuid;
  t public.tournaments;
  v_member uuid := nullif(p ->> 'memberId', '')::uuid;
  v_member_row public.members;
  v_tier public.membership_tiers;
  v_customer uuid;
  v_email text := nullif(trim(p -> 'customer' ->> 'email'), '');
  v_phone text := nullif(trim(p -> 'customer' ->> 'phone'), '');
  v_total int := (p ->> 'totalCents')::int;
  v_free boolean := false;
  v_used int;
  v_month_start timestamptz;
  v_entry public.tournament_entries;
begin
  if coalesce(p ->> 'cancelTokenHash', '') !~ '^[0-9a-f]{64}$' then
    perform private.fail('invalid', 'Missing entry token');
  end if;
  if v_total is null or v_total < 0 or (p ->> 'gstCents')::int is distinct from private.gst_of(v_total) then
    perform private.fail('invalid', 'Price is missing or inconsistent');
  end if;

  perform public.expire_stale_tournament_holds(v_now);

  select * into t from public.tournaments where id = v_tournament for update;
  if t.id is null or not t.published then
    perform private.fail('not_found', 'That tournament is not open for sign-ups');
  end if;
  if t.starts_at <= v_now then
    perform private.fail('tournament_started', 'That tournament has already started');
  end if;

  -- Who is signing up.
  if v_member is not null then
    select * into v_member_row from public.members where id = v_member for update;
    if v_member_row.id is null or v_member_row.status not in ('active', 'cancelling') then
      perform private.fail('member_inactive', 'This membership is not active');
    end if;
    v_customer := v_member_row.customer_id;
    select * into v_tier from public.membership_tiers where id = v_member_row.tier_id;
    if coalesce(v_tier.monthly_free_tournaments, 0) > 0 then
      -- Free entries reset on the first of the venue's month.
      v_month_start := date_trunc('month', v_now at time zone st.timezone) at time zone st.timezone;
      select count(*)::int into v_used
        from public.tournament_entries
       where member_id = v_member and free_entry
         and status in ('held', 'confirmed')
         and created_at >= v_month_start;
      v_free := v_used < v_tier.monthly_free_tournaments;
    end if;
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

  if v_free then
    v_total := 0;
  end if;

  if public.tournament_spots_left(t.id, v_now) <= 0 then
    perform private.fail('tournament_full', 'That tournament is full');
  end if;

  begin
    insert into public.tournament_entries (
      tournament_id, customer_id, member_id, status, hold_expires_at, free_entry,
      pricing_snapshot, total_cents, gst_cents, cancel_token_hash
    ) values (
      t.id, v_customer, v_member,
      case when v_total = 0 then 'confirmed' else 'held' end,
      case when v_total = 0 then null else v_now + make_interval(mins => st.hold_ttl_minutes + 10) end,
      v_free,
      case when jsonb_typeof(p -> 'pricing') = 'object' then p -> 'pricing' end,
      v_total, private.gst_of(v_total), p ->> 'cancelTokenHash'
    ) returning * into v_entry;
  exception when unique_violation then
    perform private.fail('already_entered', 'You are already signed up for this tournament');
  end;

  if v_total = 0 then
    insert into public.payments (tournament_entry_id, method, amount_cents, gst_cents)
    values (v_entry.id, 'free', 0, 0);
  end if;

  insert into public.audit_log (action, entity, entity_id, after)
  values ('tournament.hold', 'tournament_entries', v_entry.id::text,
          jsonb_build_object('ref', v_entry.ref, 'tournament_id', t.id, 'customer_id', v_customer,
                             'member_id', v_member, 'free_entry', v_free, 'total_cents', v_total));
  return v_entry;
end;
$$;

revoke execute on function public.tournament_hold(jsonb) from public, anon, authenticated;
grant execute on function public.tournament_hold(jsonb) to service_role;

create or replace function public.tournament_attach_checkout(p_entry uuid, p_checkout_session_id text)
returns void
language plpgsql
set search_path = ''
as $$
begin
  update public.tournament_entries
     set stripe_checkout_session_id = p_checkout_session_id
   where id = p_entry and status = 'held';
  if not found then
    perform private.fail('not_found', 'That entry is no longer waiting for payment');
  end if;
end;
$$;
revoke execute on function public.tournament_attach_checkout(uuid, text) from public, anon, authenticated;
grant execute on function public.tournament_attach_checkout(uuid, text) to service_role;

create or replace function public.tournament_confirm(p_entry uuid, p jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  e public.tournament_entries;
  v_intent text := nullif(p ->> 'paymentIntentId', '');
  v_paid int := (p ->> 'amountPaidCents')::int;
  v_payment uuid;
begin
  select * into e from public.tournament_entries where id = p_entry for update;
  if e.id is null then
    perform private.fail('not_found', 'Entry not found');
  end if;
  if e.status = 'confirmed' then
    return jsonb_build_object('confirmed', false, 'reason', 'duplicate', 'ref', e.ref);
  end if;
  if e.status <> 'held' then
    perform private.fail('hold_expired', 'The hold on that spot ended before payment finished');
  end if;
  if v_intent is null then
    perform private.fail('invalid', 'The Stripe payment id is required');
  end if;
  if v_paid is distinct from e.total_cents then
    perform private.fail('amount_mismatch', 'The amount paid does not match the entry');
  end if;

  update public.tournament_entries set
    status = 'confirmed',
    hold_expires_at = null,
    stripe_payment_intent_id = v_intent,
    stripe_checkout_session_id = coalesce(nullif(p ->> 'checkoutSessionId', ''), stripe_checkout_session_id)
  where id = e.id;

  if nullif(trim(p ->> 'email'), '') is not null then
    update public.customers set email = trim(p ->> 'email') where id = e.customer_id and email is null;
  end if;

  insert into public.payments (tournament_entry_id, method, amount_cents, gst_cents, external_ref)
  values (e.id, 'stripe', e.total_cents, e.gst_cents, v_intent)
  returning id into v_payment;

  insert into public.audit_log (action, entity, entity_id, after)
  values ('tournament.confirm', 'tournament_entries', e.id::text,
          jsonb_build_object('ref', e.ref, 'amount_cents', e.total_cents, 'payment_id', v_payment));

  return jsonb_build_object('confirmed', true, 'ref', e.ref, 'paymentId', v_payment);
end;
$$;
revoke execute on function public.tournament_confirm(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.tournament_confirm(uuid, jsonb) to service_role;

create or replace function public.tournament_release_hold(p_entry uuid)
returns text
language plpgsql
set search_path = ''
as $$
declare
  e public.tournament_entries;
begin
  select * into e from public.tournament_entries where id = p_entry for update;
  if e.id is null then
    perform private.fail('not_found', 'Entry not found');
  end if;
  if e.status <> 'held' then
    return e.status;
  end if;
  update public.tournament_entries set status = 'expired' where id = e.id;
  insert into public.audit_log (action, entity, entity_id, after)
  values ('tournament.release', 'tournament_entries', e.id::text, jsonb_build_object('ref', e.ref));
  return 'expired';
end;
$$;
revoke execute on function public.tournament_release_hold(uuid) from public, anon, authenticated;
grant execute on function public.tournament_release_hold(uuid) to service_role;
