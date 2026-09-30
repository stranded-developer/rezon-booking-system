-- Guests arrive before their session (D85). A venue setting like the other booking rules, so the
-- website, the email and the owner's back office all say the same number.
alter table public.venue_settings
  add column arrive_early_minutes int not null default 15 check (arrive_early_minutes between 0 and 120);
comment on column public.venue_settings.arrive_early_minutes is
  'How many minutes before the booked start a guest should arrive. The session still starts and ends at the booked time (D85).';
