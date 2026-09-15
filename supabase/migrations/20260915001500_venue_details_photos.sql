-- Venue contact details and photos for the booking site home page (D58).
-- Edited by a superadmin in the back office through the API; config-change audit trigger as usual.
-- Photo files live in the public Storage bucket `venue-photos`. Visitors can view them, but there are
-- no Storage policies for browser roles, so only the API (service role) can upload or delete.

alter table public.venue_settings
  add column address text check (address is null or length(address) between 1 and 300),
  add column phone text check (phone is null or phone ~ '^\+?[0-9 ()-]{8,20}$'),
  add column contact_email extensions.citext check (contact_email is null or contact_email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  add column intro text check (intro is null or length(intro) between 1 and 1000),
  add column instagram_url text check (instagram_url is null or instagram_url ~ '^https://(www\.)?instagram\.com/[A-Za-z0-9_.]{1,30}/?$');

comment on column public.venue_settings.intro is 'Short welcome text on the booking site home page';

create table public.venue_photos (
  id uuid primary key default gen_random_uuid(),
  storage_path text not null unique check (storage_path ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$'),
  caption text check (caption is null or length(caption) between 1 and 200),
  sort int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.venue_photos is 'Booking site photos; the file is storage_path in the venue-photos bucket';

create trigger venue_photos_updated_at before update on public.venue_photos
  for each row execute function private.set_updated_at();
create trigger venue_photos_audit after insert or update or delete on public.venue_photos
  for each row execute function private.audit_config_change();

alter table public.venue_photos enable row level security;
revoke all on public.venue_photos from public, anon, authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('venue-photos', 'venue-photos', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;
