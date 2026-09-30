-- Member prices are flat, per tier, and never stack (D82); Single Session and Double Session
-- (D83); the membership poster's wording and values (D84).

-- ── Member prices (D82) ─────────────────────────────────────────────────────
-- What a tier pays for an experience, as the poster sets it: Silver $32 / $52, Gold and Diamond
-- $28 / $46. A member pays the cheapest of this and any promotion that applies — one or the
-- other, never both. An experience with no row here falls back to the tier's percentage off
-- its list price.

create table public.experience_member_prices (
  id uuid primary key default gen_random_uuid(),
  experience_id uuid not null references public.experiences (id) on delete cascade,
  tier_id uuid not null references public.membership_tiers (id) on delete cascade,
  price_cents int not null check (price_cents >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (experience_id, tier_id)
);
comment on table public.experience_member_prices is
  'A tier''s flat price for an experience (D82). Never combined with a promotional price: the cheapest wins.';
create index experience_member_prices_tier_idx on public.experience_member_prices (tier_id);

create trigger experience_member_prices_updated_at before update on public.experience_member_prices
  for each row execute function private.set_updated_at();
create trigger experience_member_prices_audit after insert or update or delete on public.experience_member_prices
  for each row execute function private.audit_config_change();

alter table public.experience_member_prices enable row level security;
revoke insert, update, delete, truncate on public.experience_member_prices from anon, authenticated;
-- Prices are public: the membership page shows them.
create policy "anyone reads member prices" on public.experience_member_prices for select to anon, authenticated using (true);

-- The poster's prices, in one place for an existing venue (this migration) and a fresh install
-- (`seed.sql`). Only the two sessions are on the poster; Leaderboard Challenge is left to the
-- tier's percentage. Does nothing if the venue already has member prices.
create function private.seed_launch_member_prices()
returns void
language plpgsql
set search_path = ''
as $$
begin
  if exists (select 1 from public.experience_member_prices) then
    return;
  end if;
  insert into public.experience_member_prices (experience_id, tier_id, price_cents)
  select e.id, t.id, v.price_cents
  from (values
    ('quick_race', 'Silver', 32_00), ('quick_race', 'Gold', 28_00), ('quick_race', 'Diamond', 28_00),
    ('double_race', 'Silver', 52_00), ('double_race', 'Gold', 46_00), ('double_race', 'Diamond', 46_00)
  ) as v (exp_key, tier_name, price_cents)
  join public.experiences e on e.key = v.exp_key
  join public.membership_tiers t on t.name = v.tier_name;
end;
$$;
revoke execute on function private.seed_launch_member_prices() from public;
select private.seed_launch_member_prices();

-- ── Single Session and Double Session (D83) ─────────────────────────────────
-- Only while they still carry their launch names, so a name the venue has set is left alone.
update public.experiences
   set name = 'Single Session', tagline = 'Quick Race, Time trial, Drift, and more.'
 where key = 'quick_race' and name = 'Quick Race';
update public.experiences
   set name = 'Double Session', tagline = 'Full Experience, Double Race, Drift, Free Roam, and more'
 where key = 'double_race' and name = 'Double Race';

-- ── The membership poster (D84) ─────────────────────────────────────────────
-- The poster's lines, word for word with the spelling fixed. The races a month and the
-- "% off next bookings" lines come from the tier's own numbers, so they are not repeated here.
update public.membership_tiers set perks = array['Monday - Friday'] where name = 'Silver';
update public.membership_tiers set perks = array[
  'Monday - Sunday',
  'Free 2 Hours Billiard Tables Every Month',
  '20% Off for additional food and drinks',
  'Early Access Registration / promos'
] where name = 'Gold';
update public.membership_tiers set perks = array[
  'Monday - Sunday',
  'Free 4 Hours Billiard Tables',
  '20% off food & drinks',
  'FREE ENTRY 1x MONTHLY TOURNAMENT',
  'Live Watch Party access with exclusive seating',
  'Early Access Registration / promos',
  'Exclusive events for Diamond Members only',
  'Birthday FREE 1 session play and Exclusive promo if you host your birthday with us'
] where name = 'Diamond';
-- The poster gives Diamond a free monthly tournament entry, which settles the question D68 left open.
update public.membership_tiers set monthly_free_tournaments = 1 where name = 'Diamond';
