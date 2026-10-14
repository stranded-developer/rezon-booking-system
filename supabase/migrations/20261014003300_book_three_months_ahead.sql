-- Online bookings open about 3 months ahead (D104), up from 7 days. Still a back-office setting.
alter table public.venue_settings alter column booking_window_days set default 92;
-- Only while it is still the launch value, so a window the venue has set itself is left alone.
update public.venue_settings set booking_window_days = 92 where booking_window_days = 7;
