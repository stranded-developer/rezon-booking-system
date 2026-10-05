# Decisions 11 — 2026-10-05: the owner's mockup, and the name Racegrounds

**Supersedes:** D76's colours and fonts and D64/D72's home page layout (D88); the name "Raceground" in everything a customer reads (D89).

The owner sent `logs/screenshots/new-ui/`: seven 3D renders of the venue's simulator rig and a 76-second phone recording of a home page mockup, cycling through four colour schemes. **(asked)** One scheme, not a switcher: lime on purple. **(asked)** The name: Racegrounds everywhere.

## D88 — The home page and the look follow the owner's mockup ✅ owner 2026-10-05

**Look.** Near-black with a purple cast (`#0d0a14`), violet glows and bands (`#6d3fd6`), lime accents (`#d7ff3b`) with dark text on lime. Headings in **Unbounded** (heavy, rounded capitals); small wide-spaced lime labels over each heading; body text stays Manrope. Buttons use small, wide-spaced heavy capitals. The checkered strips are gone (the mockup has none). The wordmark is thin, widely spaced capitals with the A drawn as **Λ**, as on the rigs' screens.

**Header.** One rounded, bordered bar inset from the edges: wordmark, Book now, and a menu button on a phone that opens the links; on a wide screen the links sit in the bar.

**Home page, in the mockup's order:**
1. Hero, left-aligned: "— Sydney", "Sydney's / Sim racing, / Billiards and / VR lounge" (the last in lime), Book now and "See membership ›". Under it (beside it on a wide screen) **the rig, turning through the seven renders** with dots to pick an angle; "Your place on the grid · Triple screens · Bucket seat"; and an **"8 Simulators · Explore"** card.
2. "What you can book / Choose your experience": stacked cards; the badged one (Double Session) is the featured violet card with a lime Book now; "Also by the hour" with Happy Hour under it.
3. "More than a race": four numbered photo tiles — **Sim Racing, VR Sim Racing, Billiards, The Lounge** (renamed from Race./Play./Hang out./Compete., which move to a line beneath them).
4. "Book your event": "Ready? Book your session — Book now ›", then chevron buttons; a tile with "VR" in its title is the featured violet one. An uploaded image shows faintly behind a button.
5. "Types of driving": short photo tiles, titles alternating lime and white; a tile titled "& …" is a caption under the grid.
6. "Members club / Race more, pay less" on a violet band; the middle tier filled in lime.
7. "When we're open / Hours", "Ready to race?" card, footer.

**The rig renders** had a flat grey studio background. It is removed by flood-filling only the grey connected to the image's edges, so grey inside the rig (the seat's highlights) stays; a 1px feather softens the cut.

**Not taken from the mockup:** the "COLOURS" switcher and "Edit site" button (the mockup tool's own controls), and the photo behind the hero (no photo was supplied — the violet glow stands in for it).

## D89 — The name is Racegrounds ✅ owner 2026-10-05

Everything a customer reads — page titles, the site, emails, Stripe payment descriptions, the calendar invite — says **Racegrounds**, matching the rigs. The business name printed on receipts is still the one set in Venue & hours; only its fallback when nothing is set changed. Internal names (the repo, package names) are unchanged.
