# Step 62 — The owner's web logo as the site icon; the price as one line

**Date:** 2026-10-15
**Decisions:** [D113](../decisions/14-2026-10-13-explore-wording-happy-hour.md).

**Done**

- Icon: the owner's `logo for web.jpg` (2000×2000, wordmark + "SYDNEY SIM RACING LOUNGE" on black), saved as `assets/brand/racegrounds-logo-for-web.jpg`. Cropped to the centre 1160×1160 (the wordmark is 1026 px wide, so nothing of it is cut) to drop empty black, then `favicon.ico` (16/32/48), `icon.png` (512) and `apple-icon.png` (180) in both apps. The RG badge is kept as `assets/brand/racegrounds-rg-badge-512.png`.
- Experience card: "FROM $29.00 · 30 min, normally $35.00" as one line; it wraps after the price on a narrow card.

**Verified**

1. The icon at 160 px reads clearly; at 32 px (browser tab) it is a thin grey line — told the owner, who asked for this file.
2. Production build: `/icon.png` is served. Screenshots of the Single Session card on desktop and phone checked.
3. Browser tests: the card reads "from $29.00 · 30 min, normally $35.00"; the home page Double Session "· 1 hour".
4. **Gate:** see the commit for this step.
