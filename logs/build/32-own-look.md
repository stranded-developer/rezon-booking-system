# Phase 8i — Raceground's own look: colours and fonts

**Date:** 2026-09-30
**Decision:** [D76](../decisions/09-2026-09-30-look-vr-member-prompt-games.md) (replaces D64's colours and fonts; its layout stands).

**Done**

The owner found the site too close to the reference (Velocity) and asked for new colours and fonts across the whole site, with the structure and flow unchanged.

- **Colours:** the theme tokens in `apps/booking/src/app/globals.css` were redefined — the same names every screen already uses (`night`, `paper`, `mist`, `line`, `ink-*`, `flag`, `gold`), so every page changed at once. `flag` is now the POS's volt lime `#e8ff47` on graphite `#0b0d10`; `gold` is amber `#ffb347`. The page wash is a faint lime glow instead of indigo.
- **Lime is light, so text on it is dark:** a new `on-flag` token replaces `text-white` on every lime surface (primary buttons, badges, the chosen calendar day, the active nav link, the event pop-up and banner buttons).
- **Fonts:** headings in **Chakra Petch** (upright, squared capitals), body in **Manrope**, both through `next/font`. The `.display` class is no longer italic.
- **The wide checkered strips** are graphite-on-graphite instead of black-and-white — the reference's most recognisable detail, kept as a texture.
- The two indigo accents on the home page became sky blue. The hero heading is one size smaller, because Chakra Petch is wider than the condensed face and it wrapped to three lines.

**Verified**

1. **Looked at, not just tested:** full-page screenshots of home, `/book` and membership at 1280px and 390px, before and after. Nothing crimson or indigo remains; buttons read dark-on-lime; nothing overflows at phone width.
2. `grep` for `text-white`, crimson and indigo classes in the booking app: only the red "danger" button keeps white text, on red.
3. Gate at the end of this batch (see [35](35-game-track-car.md)).

**Issues found and fixed**

1. **Port 3000 was a two-day-old production build** (`next start` from 28 Sep), so the first screenshots showed the old look. It was stopped and replaced by a dev server for the checks, and the browser suites ran against a fresh build.
