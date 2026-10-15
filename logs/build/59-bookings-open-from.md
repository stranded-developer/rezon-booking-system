# Step 59 — Online bookings only from 7 November

**Date:** 2026-10-15
**Decisions:** [D110](../decisions/14-2026-10-13-explore-wording-happy-hour.md).

**Done**

- Migration `20261015003700_bookings_open_from.sql`: `venue_settings.bookings_open_from` (date, null = from today), set to 2026-11-07. `booking_hold` (copied from step 57's) refuses an earlier date: `not_open_yet`, "Bookings start on Sat 7 Nov 2026".
- API: `/public/config` has `bookingsOpenFrom`; availability has `firstDate` and treats earlier days as outside the window; the quote refuses an earlier date with the same message; Back office settings accept a date or empty.
- Booking site: the calendar starts at the opening day (opening on its month), greys out the days before, and says "Bookings start on Sat 7 Nov 2026" in lime.
- Back office → Venue & hours → **Bookings open from** (a date box; empty = from today).
- The browser tests book a couple of days ahead, so their setup clears the date and the teardown puts the venue's back, as they already do for the opening hours.
- Spec: `booking-site.md`, `data-model.md`, `back-office.md`.

**Verified**

1. pgTAP: a hold the day before the opening day is refused with "Bookings start on Wed 16 Jan 2030"; the opening day itself can be held.
2. API: config shows the date; the day before is outside the window with `firstDate` set; the opening day is in it; a quote for the day before is refused (`not_open_yet`, "Bookings start on Thu 14 Feb 2030"), the opening day's isn't; the back office refuses "next week" as a date.
3. Browser test: with the opening day four days out, the calendar says "Bookings start on …", the day before is greyed out and the opening day can be picked. The venue's setting is 2026-11-07 again afterwards.
4. **Gate:** see the commit for this step.

**Issues found and fixed**

1. The first browser run hung on "Loading what's available…": a copy of the site I'd started at 14:37 for screenshots was still running and serving the previous build, which the tests reused. Stopped it; the tests pass. (Not a problem in the site.)
2. The gate's real-Stripe API tests (`bookings-stripe`) book two days from the real today, which the 7 November date rightly refused (`not_open_yet`). They now clear the date while they run and put it back, as the browser tests do.
