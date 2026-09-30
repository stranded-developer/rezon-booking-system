# Phase 8m — The bottom bar and Clothing

**Date:** 2026-10-01
**Decisions:** [D81, D86](../decisions/10-2026-10-01-poster-tiles-rules.md).

**Done**

- `BottomBar`: Book now (lime), Events, Explore, fixed to the bottom of every page with a translucent graphite background and room for the iPhone home indicator (`env(safe-area-inset-bottom)`). It sits at z-30 — under the booking panel and the event pop-up (z-50) — and the page is padded by its height so the footer is never hidden behind it. Explore links to `/#explore`, the Types of driving section.
- "Clothing" in the top bar after Contact → `/clothing`: a coming-soon banner, "Follow us for the drop" when the venue has an Instagram link, and six empty catalogue tiles.

**Verified**

1. Browser: the home-page test scrolls 4,000px and checks Book now is still **in the viewport**, checks Events goes to `/tournaments`, clicks Explore and checks **Types of driving is in view**, then uses the bar's Book now to reach `/book`.
2. Browser: a new test opens Clothing from the top bar and sees the coming-soon page.
3. Screenshots at 390px and 1280px.
