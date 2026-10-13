# Step 46 — The owner's logo everywhere

**Date:** 2026-10-13

**Done**

- The owner supplied `RACEGROUNDS_Logo_HD_Transparent.png` (7100×1009, white on transparent). The original is kept at `assets/brand/racegrounds-logo-hd.png`.
- Each app gets a web copy, trimmed of its empty border and scaled to 1600×88 (32 KB): `apps/booking/src/assets/racegrounds-logo.png` and `apps/pos/src/assets/racegrounds-logo.png`. Imported statically, so Next sizes and caches it.
- `Wordmark` (booking `src/components/ui.tsx`, POS `src/components/wordmark.tsx`) now shows the image instead of text, alt text "Racegrounds". Callers size it by width:
  - Booking: header `w-36 sm:w-44`, footer `w-48`.
  - POS: login `w-64`, lock screen `w-48`, till header `w-40`, back office sidebar `w-40`.
- The logo is white, so it only works on dark backgrounds. Both apps are dark everywhere it appears.

**Verified**

1. Screenshots: booking header on desktop (176 px wide) and phone (144 px, fits beside Book now and the menu), booking footer, POS login. The image loads (`naturalWidth` 1600) and sits where the old text did.
2. **Gate:** see the commit for this step.

**Issues found and fixed**

1. On the POS login, "Sign in this counter device" sat tight under the logo; the gap is now `mt-3`.
