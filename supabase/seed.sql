-- Raceground launch configuration (spec/README.md "Launch configuration at a glance").
-- Staff accounts are NOT seeded here: they need real auth users and PINs (created by a setup script).

insert into public.venue_settings (id) values (1);

insert into public.opening_hours (day_of_week, open_time, close_time)
select d, '10:00', '21:00' from generate_series(1, 7) as d;

insert into public.resource_types (key, name, base_rate_cents, min_minutes, sort) values
  ('billiard', 'Billiard Table', 3000, 15, 1),
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

insert into public.happy_hours (name, resource_type_ids, days_of_week, start_time, end_time, discount_bp)
values ('Happy Hour', null, '{1,2,3,4,5}', '10:00', '15:00', 1000);

insert into public.membership_tiers
  (name, discount_bp, monthly_price_cents, monthly_free_minutes, max_balance_minutes, sort)
values
  ('Silver', 500, 10000, 60, 600, 1),
  ('Gold', 1000, 20000, 60, 600, 2),
  ('Diamond', 1500, 30000, 60, 600, 3);

insert into public.tier_prices (tier_id, amount_cents)
select id, monthly_price_cents from public.membership_tiers;
