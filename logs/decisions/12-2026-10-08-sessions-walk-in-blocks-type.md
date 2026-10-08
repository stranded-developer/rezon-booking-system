# Decisions 12 — 2026-10-08: whole sessions online, walk-ins in 15-minute blocks, the mockup's sizes, Garet

**Supersedes:** D63's "then 15-minute steps" for online bookings (D90); per-minute billing of walk-ins after the 15-minute minimum (D91); D88's type sizes (D92); D88's fonts, Unbounded and Manrope (D93).

## D90 — Online bookings are whole 30-minute sessions, starting on :00 or :30 ✅ owner 2026-10-08

**Asked:** "in the booking website, it can ONLY be 30 mins timeframe, not 15 minutes." **(asked)** Start times too: on the hour and the half hour only.

**Decision:**
- A booking's length is a whole number of sessions: 30, 60, 90 … No 45- or 75-minute bookings.
- A booking starts on the session grid of the venue's clock: 2:00 or 2:30, never 2:15 or 2:45. This applies to experiences as well.
- Free play on a booking is spent the same way: whole sessions.
- Enforced in the database (`booking_hold`), the API (availability, quote, hold) and the panel, as D63 was. Bookings already made on a quarter hour are left as they are.
- The session length stays one venue setting (`session_minutes`); the rule follows it.

## D91 — Walk-ins are charged in 15-minute blocks, rounded up ✅ owner 2026-10-08

**Asked:** "in walk in/pos, 15 min options are possible, they are charged with either 15 mins or 30 mins." **(asked)** Of the three readings offered, the owner chose: **round the time played up to the next 15 minutes.**

**Decision:** 15 minutes is still the least anyone pays. Beyond that a walk-in is billed in quarter hours: 5 min → 15, 20 min → 30, 31 min → 45, 45 min → 45. The price of each quarter hour is still worked out minute by minute (happy hour, rate bands), so a block that runs into happy hour is priced fairly.

## D92 — The site's sizes follow the mockup video ✅ owner 2026-10-08

**Asked:** "the spacing in the website is slightly different compared to the design … can you confirm." Confirmed by putting the site at phone width beside frames of the video: the video's headings, body text, buttons and card padding are about 20–25% smaller, so its page is tighter. **(asked)** Match the video on every page, and make the rig images smaller.

## D93 — Garet Bold and Garet Regular on the booking site ✅ owner 2026-10-08

**Asked:** "for the fonts in the booking site use garet bold and garet regular." Garet isn't a free web font, so the owner adds the licensed files to `apps/booking/src/fonts/`. Bold for headings and buttons, Regular for body text.
