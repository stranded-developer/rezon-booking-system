-- The venue gets an email for every confirmed online booking (D105). The address is a back-office
-- setting; empty means no alerts.
alter table public.venue_settings
  add column booking_alert_email text check (booking_alert_email is null or booking_alert_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$');
comment on column public.venue_settings.booking_alert_email is
  'Where a "new booking" email goes for every confirmed online booking (D105). Null = none.';

-- The owner asked for racegrounds@gmail.com.
update public.venue_settings set booking_alert_email = 'racegrounds@gmail.com' where booking_alert_email is null;
