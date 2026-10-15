# Step 58 — Hero colours, the happy-hour price in each slot, members' nights, the site icon

**Date:** 2026-10-15
**Decisions:** [D107, D108, D109](../decisions/14-2026-10-13-explore-wording-happy-hour.md).

**Done**

- **Home page heading:** "Sim racing," is lime and "VR lounge" white (they were the other way round).
- **Time slots:** under the Happy hour tag, the happy-hour price for one person ("$29.00", "$29.00 each" for a group), from the slot's `happyHour.priceCents` (the pricing engine's own figure, D99).
- **Membership tiers:** migration `20261015003600_members_nights_perk.sql` adds "SPECIAL MEMBERS NIGHTS ONLY EVENTS" to the end of every tier's perks, once; `seed.sql` does the same for a fresh database.
- **Site icon:** the hexagon RG badge, lime on near-black, Garet Heavy (`assets/brand/racegrounds-icon-512.png`): `favicon.ico` (16/32/48), `icon.png` (512) and `apple-icon.png` (180) in both `apps/booking/src/app` and `apps/pos/src/app`, so Next adds the links itself.

**Verified**

1. Browser tests: the 12:00 pm slot shows $29.00 under its tag and 6:00 pm none; Silver, Gold and Diamond each list the members' nights.
2. pgTAP: the tiers' exact lines now end with the members' nights.
3. Production build: `/favicon.ico` is served (image/x-icon) and the page links the icon and the Apple touch icon. Screenshots of the heading and the slots checked; the icon checked at 160 px and at 32 px.
4. **Gate:** see the commit for this step.

**Issues found and fixed**

1. The perk first went into the tiers' first insert in `seed.sql`, but the seed sets the poster's wording again further down, so it would have been lost on a fresh database. It now goes after that.
