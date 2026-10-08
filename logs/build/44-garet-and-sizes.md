# Phase 8u / 8t (part 2) — Garet, and the sizes from the owner's video

**Date:** 2026-10-08
**Decisions:** [D92, D93](../decisions/12-2026-10-08-sessions-walk-in-blocks-type.md). Supersedes D88's fonts (Unbounded, Manrope).

**Done**

- **Fonts:** `next/font/local` loads `Garet-Book.woff2` (weight 300) and `Garet-Heavy.woff2` (weight 850) from `apps/booking/src/fonts/garet/`, self-hosted with the site. Body text is set to 300, and headings (`.display`), the small lime labels (`.kicker`) and buttons resolve to Heavy. `font-synthesis: none` stops the browser faking a weight in between. Manrope and Unbounded are gone.
- **Sizes, measured against the video at the same width (384px) and checked side by side at double size:**
  - headings set tighter (letter spacing −0.04em), which is what the video does with Garet Heavy;
  - buttons: the hero's Book now is 44px tall with ~10.5px capitals, as in the video (was 48px and 12px); every button is a little smaller with less letter spacing;
  - body text is 14px on a phone (16px from a small tablet up), and the small text inside cards is 12px on a phone;
  - section headings are 32px on a phone (was 30px) and wrap at about eleven letters, so they break where the video's do: "Choose your / experience", "More than a / race", "Book your / event", "Types of / driving";
  - hero gaps: 68px between the header and "— Sydney" (was 48), 20px between the paragraph and the buttons (was 32).
- **The rounder "a":** Garet has one (`ss01`), but zooming in on the video shows it uses the normal "a", so it is left off.

**Verified**

1. **Looked at, not just tested:** the hero and every home section side by side with the video's frames; Book, Membership and the booking panel at 375px.
2. **No page scrolls sideways** at 375px: home, Book, Membership, Tournaments, Contact, Login, Sign up, Clothing, Terms (`scrollWidth` = 375 on each).
3. **Gate:** see the commit for this step.

**Issues found and fixed**

1. The first capture of Book and Membership said "We couldn't reach Racegrounds". The preview was on port 3005, and the local API only accepts the site from port 3000. Re-captured on 3000. This was not a bug in the site.
2. A scripted edit stopped partway through on a class name used twice in `page.tsx`. Two of three files had already changed, so it was checked with `git diff` and finished by hand. Nothing was lost or doubled.

**Worth knowing**

- The video is a phone recording, so the smaller text applies to phones only. Tablets and computers keep 16px body text.
- The hero's tighter letter spacing and smaller buttons apply at every width.
