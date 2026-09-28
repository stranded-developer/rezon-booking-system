-- New opening hours, and one happy hour at flat prices (D73, D74).
--
-- Every change below is applied **only where the value is still the previous launch default**, so
-- a venue that has already set its own hours or prices in the back office is left alone.

-- ── Opening hours (D73) ─────────────────────────────────────────────────────
-- Midnight is stored as 24:00. Postgres reads `date + '24:00'::time` as the following midnight,
-- so a Friday booking can run to 11:59 pm and nothing crosses into Saturday.
update public.opening_hours set open_time = '12:00', close_time = '22:00'
 where day_of_week between 1 and 4 and open_time = '10:00' and close_time = '21:00' and not closed;
update public.opening_hours set open_time = '12:00', close_time = '24:00'
 where day_of_week = 5 and open_time = '10:00' and close_time = '21:00' and not closed;
update public.opening_hours set open_time = '11:00', close_time = '24:00'
 where day_of_week = 6 and open_time = '10:00' and close_time = '21:00' and not closed;
update public.opening_hours set open_time = '11:00', close_time = '22:00'
 where day_of_week = 7 and open_time = '10:00' and close_time = '21:00' and not closed;

-- ── Billiard tables are cheaper (D74) ───────────────────────────────────────
update public.resource_types set base_rate_cents = 2500
 where key = 'billiard' and base_rate_cents = 3000;

-- ── One happy hour, 12:00–15:00 every day, as a flat price (D74) ────────────
-- The percentage happy hour is switched off rather than deleted: with a flat rate band in the
-- same window, a percentage on top would discount twice. Switching it off keeps the history and
-- lets the owner turn it back on in the back office if they ever want percentages again.
update public.happy_hours set active = false
 where name = 'Happy Hour'
   and days_of_week = '{1,2,3,4,5}'::smallint[]
   and start_time = '10:00' and end_time = '15:00'
   and discount_bp = 1000
   and active;

-- Simulators are deliberately not given a happy-hour rate: they are sold online as experiences,
-- which have their own promotional prices, and the hourly rate is only for a walk-in.
insert into public.rate_bands (resource_type_id, days_of_week, start_time, end_time, rate_cents)
select rt.id, '{1,2,3,4,5,6,7}'::smallint[], '12:00', '15:00', v.rate
  from (values ('billiard', 2000), ('vr', 4000)) as v (type_key, rate)
  join public.resource_types rt on rt.key = v.type_key
 where not exists (
   select 1 from public.rate_bands rb
    where rb.resource_type_id = rt.id and rb.start_time = '12:00' and rb.end_time = '15:00'
 );
