# Phase 8q — The owner's mockup: new look, new home page, Racegrounds

**Date:** 2026-10-05
**Decisions:** [D88, D89](../decisions/11-2026-10-05-mockup-layout-racegrounds.md).
**Migration:** `20261005002900_mockup_tile_titles.sql`

**Done**

- **The video was read frame by frame** (ffmpeg: one frame every two seconds into contact sheets, then full-size frames of each section) and the page rebuilt section by section against it. See D88 for the list.
- **Theme:** `globals.css` tokens redefined (same names, so every page changed at once), `violet` / `violet-deep` added, `.kicker` for the small lime labels, Unbounded through `next/font`. `Wordmark` draws "RΛCEGROUNDS" and gives screen readers "Racegrounds".
- **Header** rewritten as the mockup's bar with a menu on phones (closes on Escape and when the page changes). **Footer** simplified, Clothing added to its links. **Buttons** and the **bottom bar** restyled.
- **Home page** rewritten (`page.tsx`, `home-tiles.tsx`); **`RigGallery`** crossfades the seven renders every 3.5 s, dots pick an angle, holds still on hover/focus and never moves for "reduce motion". Only the current angle has alt text.
- **Rig images:** the seven renders cut out of their grey background (`public/rigs/rig-1…7.webp`, 24–50 KB each). A plain colour key also ate the seat's grey highlights; flood-filling only the edge-connected grey keeps them.
- **Tiles:** the four "under the hero" launch tiles renamed to the mockup's titles (only while still on their launch titles).
- **Racegrounds** in 35 files across the site, API emails and descriptions, the calendar invite and the POS page title.

**Verified**

1. **Looked at, not just tested:** full-page captures at 390px (sliced to screen height, compared side by side with the video's frames) and 1280px; the rig checked composited on the page colour; Book, Membership, Tournaments, Contact, Login and both booking-panel steps checked at 390px.
2. Browser: the home test now checks the rig's seven angle buttons, the Simulators card linking to Book now, and the renamed tiles; every earlier check (experience cards, event tiles linking to /book, driving tiles not linking, bottom bar, Explore landing) still passes.
3. pgTAP: the launch tiles' titles by section after both migrations.
4. **Gate:** see the commit for this step.

**Issues found and fixed**

1. **The membership page's "MEMBERSHIP" heading was cut off on a phone** — Unbounded is wider than the previous font. Headings there were sized down for phones; the hero's "Sim racing," was sized down on desktop so it stays on one line.
2. **Renaming through the shell renamed nothing**, twice: zsh doesn't split a variable into words, and macOS `grep -Z` means "decompress", not "null-separated". Done with a short Python script instead; checked that no "Raceground" is left in the apps and no "Racegroundss" was made.
3. The first cut-out kept nothing transparent: the mask was a read-only view of a numpy array, so the flood fill silently did nothing. Copying it first fixed it.
