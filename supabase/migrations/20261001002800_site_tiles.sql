-- The home page's image tiles (D87): each a title and an optional image, edited in the back office.
--
--   highlights : the 2×2 grid under the hero (Race. Play. Hang out. Compete.)
--   events     : "Book your event" — kinds of session; every tile goes to Book now (#6)
--   driving    : "Types of driving" — shown only, not links (#7)
--
-- Images live in the same public bucket as the website photos, under `tiles/`, and only the API
-- writes them. A tile with no image yet shows a dark placeholder with its title.

create table public.site_tiles (
  id uuid primary key default gen_random_uuid(),
  section text not null check (section in ('highlights', 'events', 'driving')),
  title text not null check (length(trim(title)) > 0),
  image_path text,
  sort int not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.site_tiles is 'Home page image tiles (D87), edited in the back office.';
create index site_tiles_section_idx on public.site_tiles (section, sort);

create trigger site_tiles_updated_at before update on public.site_tiles
  for each row execute function private.set_updated_at();
create trigger site_tiles_audit after insert or update or delete on public.site_tiles
  for each row execute function private.audit_config_change();

alter table public.site_tiles enable row level security;
revoke insert, update, delete, truncate on public.site_tiles from anon, authenticated;
create policy "anon read active" on public.site_tiles for select to anon using (active);
create policy "signed-in read active, staff read all" on public.site_tiles for select to authenticated
  using (active or (select private.is_staff()));

-- The launch tiles. A new table, so this runs the same on a fresh install and an existing venue.
insert into public.site_tiles (section, title, sort)
select v.section, v.title, v.sort
from (values
  ('highlights', 'Race.', 1), ('highlights', 'Play.', 2), ('highlights', 'Hang out.', 3), ('highlights', 'Compete.', 4),
  ('events', 'Solo Race', 1), ('events', 'Race with Friends', 2), ('events', 'VR Race', 3),
  ('events', 'Free Roam', 4), ('events', 'Leaderboard Challenge', 5), ('events', 'Time Attack', 6),
  ('driving', 'F1', 1), ('driving', 'GT3', 2), ('driving', 'Rally', 3), ('driving', 'Drift', 4),
  ('driving', 'Supercars', 5), ('driving', 'Offroad Trucks', 6), ('driving', '& Others', 7)
) as v (section, title, sort)
where not exists (select 1 from public.site_tiles);
