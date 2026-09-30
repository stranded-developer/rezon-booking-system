# Phase 8p — The home page tiles

**Date:** 2026-10-01
**Decision:** [D87](../decisions/10-2026-10-01-poster-tiles-rules.md).
**Migration:** `20261001002800_site_tiles.sql`

**Done**

**Database.** `site_tiles (section, title, image_path, sort, active)` with `section` one of `highlights`, `events`, `driving`; anon reads what is on, only the API writes, audited. The 17 launch tiles are inserted by the migration itself (a new table, so the same on a fresh install and an existing venue).

**API.** `services/site-tiles.ts`: list, add (at the end of its section), rename / reorder / on-off, delete, and **set or clear an image**. Images are checked by their first bytes (JPEG, PNG or WebP, up to 5 MB — the website photos' rules), stored in the public `venue-photos` bucket under `tiles/`, and the **old file is deleted** only after the tile points at the new one. `/public/config` carries the active tiles.

**Website.** `home-tiles.tsx`, in the owner's reference format: a heading with one word in lime and a line under it, image tiles darkened so the title reads across the middle, a dark gradient placeholder while a tile has no image, and a wide bar under the grid.
- Under the hero: the 2×2 grid (Race., Play., Hang out., Compete.) and **"8 Simulators · Explore"** (the number is the simulators the venue has) → `/book`. Replaces the triptych.
- **Book your event**: six tiles, **every one a link to `/book`**, then "Ready? Book your session". Replaces "Drivers, start your engines".
- **Types of driving**: seven squares, **no links**, 3 columns on a phone and 4 on a wide screen; `id="explore"` for the bottom bar.

**Back office.** **Home page tiles**: one card per section; each tile with its preview, title (Save appears when changed), ↑ ↓, Upload/Change image, Remove image, Turn off/on, Delete; "Add tile" per section. Moving renumbers the whole section 1, 2, 3… so equal positions can't reorder it the wrong way.

**Verified**

1. **API, 5 new tests**: a tile is added at the end of its section; **a file that only claims to be a PNG is refused**; a real PNG is stored, shown in the config, and **fetchable**; replacing it **deletes the old file**; renaming, hiding (gone from the site) and deleting (file gone too); an unknown section is refused.
2. **pgTAP**: the 17 launch tiles by section and order; only three sections; anon never sees a hidden tile and cannot change one.
3. **Browser, site**: the three sections in order; every Book-your-event link goes to `/book`; Types of driving has **no links**; the old four steps are gone.
4. **Browser, back office**: adds a tile, **uploads a real PNG** through the file input, sees the preview, deletes it.
5. **Gate for 8m–8p** (fresh database, then again on the used one): turbo **11/11** (pricing 104, API 256) · pgTAP **500** · POS e2e **7** (+1 Stripe skipped) · booking e2e **11** (+2 Stripe skipped).

**Issues found and fixed**

1. The first reorder swapped the two tiles' numbers, which moves the wrong way when they are equal. Replaced by renumbering the section.
2. On a wide screen three square columns made each "Types of driving" tile ~380px tall; four columns there, three on a phone as in the reference.

**For the owner**

- Upload the photos in **Back office → Home page tiles**. Wide images for the first two sections, square for Types of driving.
- "Compete." was added to make the first grid 2×2; switch it off if not wanted.
