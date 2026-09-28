-- The launch experiences and their promotional prices, for a venue that already exists (D65, D66).
--
-- Why this is a migration and not just seed data: `supabase db push` applies migrations but never
-- runs `seed.sql`. A venue set up before this phase therefore gets the `experiences` tables and
-- nothing in them, and its website shows no Quick Race and no Double Race at all — the booking
-- page would simply be empty.
--
-- On a **fresh** install this deliberately does nothing. Migrations run before `seed.sql`, so
-- `resource_types` is still empty at this point, the join below matches no rows, and the seed
-- stays the single source of the launch data. On a venue that is **already running**, the
-- simulator type exists and these are inserted once.
--
-- It also stands back if the venue has already made experiences of its own: the guard is "no
-- experiences at all", not "none with this key".

insert into public.experiences (key, resource_type_id, name, tagline, bullets, badges, minutes, price_cents, sort)
select v.key, rt.id, v.name, v.tagline, v.bullets, v.badges, v.minutes, v.price_cents, v.sort
from (values
  ('quick_race', 'sim', 'Quick Race', 'Single session', array[
    'Perfect for a first time behind the wheel',
    'One 30-minute session',
    'Race on your own or against your friends'
  ], array[]::text[], 30, 35_00, 1),
  ('leaderboard_challenge', 'sim', 'Leaderboard Challenge', 'Time attack', array[
    'Set your fastest lap against the board',
    'One 30-minute qualifying session',
    'Monthly prizes for the top three drivers'
  ], array[]::text[], 30, 35_00, 2),
  ('double_race', 'sim', 'Double Race', 'Dual session', array[
    'Two races, twice the fun',
    'A full hour on the simulator',
    'The best value on the grid'
  ], array['Most popular', 'Save over 20%'], 60, 58_00, 3)
) as v (key, type_key, name, tagline, bullets, badges, minutes, price_cents, sort)
join public.resource_types rt on rt.key = v.type_key
where not exists (select 1 from public.experiences);

-- Happy Hour applies by itself; the student price only when the customer asks for it.
-- Where both match, the cheapest wins, so Happy Hour beats the student price (D66).
insert into public.experience_promos (experience_id, name, days_of_week, start_time, end_time, price_cents, claimed, sort)
select e.id, v.name, v.days, v.start_time, v.end_time, v.price_cents, v.claimed, v.sort
from (values
  ('quick_race', 'Happy Hour', '{1,2,3,4,5,6,7}'::smallint[], '12:00'::time, '15:00'::time, 29_00, false, 1),
  ('leaderboard_challenge', 'Happy Hour', '{1,2,3,4,5,6,7}'::smallint[], '12:00'::time, '15:00'::time, 29_00, false, 1),
  ('double_race', 'Happy Hour', '{1,2,3,4,5,6,7}'::smallint[], '12:00'::time, '15:00'::time, 49_00, false, 1),
  ('quick_race', 'Student', '{1,2,3,4,5,6,7}'::smallint[], '00:00'::time, '24:00'::time, 32_00, true, 2),
  ('leaderboard_challenge', 'Student', '{1,2,3,4,5,6,7}'::smallint[], '00:00'::time, '24:00'::time, 32_00, true, 2),
  ('double_race', 'Student', '{1,2,3,4,5,6,7}'::smallint[], '00:00'::time, '24:00'::time, 52_00, true, 2)
) as v (exp_key, name, days, start_time, end_time, price_cents, claimed, sort)
join public.experiences e on e.key = v.exp_key
where not exists (select 1 from public.experience_promos);
