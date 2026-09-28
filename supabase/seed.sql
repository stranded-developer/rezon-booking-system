-- Raceground launch configuration (spec/README.md "Launch configuration at a glance").
-- Staff accounts are NOT seeded here: they need real auth users and PINs (created by a setup script).

insert into public.venue_settings (id) values (1);

-- D73. Midnight is stored as 24:00, which Postgres reads as the following midnight.
insert into public.opening_hours (day_of_week, open_time, close_time) values
  (1, '12:00', '22:00'),
  (2, '12:00', '22:00'),
  (3, '12:00', '22:00'),
  (4, '12:00', '22:00'),
  (5, '12:00', '24:00'),
  (6, '11:00', '24:00'),
  (7, '11:00', '22:00');

insert into public.resource_types (key, name, base_rate_cents, min_minutes, sort) values
  ('billiard', 'Billiard Table', 2500, 15, 1),
  ('sim', 'Driving Simulator', 6000, 15, 2),
  ('vr', 'VR Seat', 5000, 15, 3);

insert into public.resources (resource_type_id, label, sort)
select rt.id, v.label, v.sort
from (values
  ('billiard', 'Table 1', 1), ('billiard', 'Table 2', 2),
  ('sim', 'Sim 1', 1), ('sim', 'Sim 2', 2), ('sim', 'Sim 3', 3),
  ('sim', 'Sim 4', 4), ('sim', 'Sim 5', 5), ('sim', 'Sim 6', 6),
  ('vr', 'VR 1', 1), ('vr', 'VR 2', 2)
) as v (type_key, label, sort)
join public.resource_types rt on rt.key = v.type_key;

-- D74: one happy hour, 12:00–15:00 every day, expressed as a flat price everywhere.
-- On the hourly types that is a rate band; on the experiences it is a promotional price.
-- There is deliberately no percentage happy hour: with a flat rate in the same window a
-- percentage on top would discount twice.
insert into public.rate_bands (resource_type_id, days_of_week, start_time, end_time, rate_cents)
select rt.id, '{1,2,3,4,5,6,7}'::smallint[], '12:00', '15:00', v.rate
from (values ('billiard', 2000), ('vr', 4000)) as v (type_key, rate)
join public.resource_types rt on rt.key = v.type_key;

-- Tiers (D67). Free play is in sessions: Silver 2, Gold 4, Diamond 8 a month (D63).
-- `perks` are listed on the membership page but not enforced by the system.
insert into public.membership_tiers
  (name, discount_bp, monthly_price_cents, monthly_free_minutes, max_balance_minutes, sort, perks)
values
  -- `perks` lists ONLY what the system does not enforce. The discount, the monthly free play and
  -- its roll-over are applied automatically and the site shows them from the tier's own numbers;
  -- repeating them here would print each one twice.
  ('Silver', 1000, 48_00, 60, 600, 1, array[
    'Monday to Friday'
  ]),
  ('Gold', 2000, 78_00, 120, 1200, 2, array[
    'Monday to Sunday',
    '2 free hours of billiards a month',
    '20% off food and drinks',
    'Early access to registrations and promos'
  ]),
  ('Diamond', 2000, 128_00, 240, 2400, 3, array[
    'Monday to Sunday',
    '4 free hours of billiards a month',
    '20% off food and drinks',
    'Free entry to one monthly tournament',
    'Live Watch Party access with exclusive seating',
    'Members-only events',
    'A free session on your birthday, and a special offer if you hold it with us'
  ]);

insert into public.tier_prices (tier_id, amount_cents)
select id, monthly_price_cents from public.membership_tiers;

-- ── Experiences and their promotional prices (D65, D66) ─────────────────────
-- Simulators are sold online as named packages at a flat price. Billiards and VR keep the
-- hourly rate, and every walk-in stays hourly.

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
join public.resource_types rt on rt.key = v.type_key;

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
join public.experiences e on e.key = v.exp_key;
