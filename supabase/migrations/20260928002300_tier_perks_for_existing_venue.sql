-- The listed membership perks, for a venue that already exists (D67).
--
-- Same reason as `20260928002200`: `supabase db push` applies migrations but never runs
-- `seed.sql`, so a venue set up before this phase got the `perks` column with its empty default
-- and nothing in it. The membership page then shows each tier's price and percentage but none of
-- the perks staff honour by hand — no "Monday to Friday", no free billiard hours, no food and
-- drink discount. That was missed when `20260923001800` added the column.
--
-- On a **fresh** install this does nothing: migrations run before `seed.sql`, so
-- `membership_tiers` is still empty here and the seed remains the single source of the launch
-- data. It also only fills a tier whose perks are **still empty**, so anything the owner has
-- already written in the back office is left alone.
--
-- `perks` lists ONLY what the system does not enforce. The discount, the monthly free play and
-- its roll-over are applied automatically and the site shows them from the tier's own numbers;
-- repeating them here would print each one twice.

update public.membership_tiers set perks = array[
  'Monday to Friday'
] where name = 'Silver' and cardinality(perks) = 0;

update public.membership_tiers set perks = array[
  'Monday to Sunday',
  '2 free hours of billiards a month',
  '20% off food and drinks',
  'Early access to registrations and promos'
] where name = 'Gold' and cardinality(perks) = 0;

update public.membership_tiers set perks = array[
  'Monday to Sunday',
  '4 free hours of billiards a month',
  '20% off food and drinks',
  'Free entry to one monthly tournament',
  'Live Watch Party access with exclusive seating',
  'Members-only events',
  'A free session on your birthday, and a special offer if you hold it with us'
] where name = 'Diamond' and cardinality(perks) = 0;
