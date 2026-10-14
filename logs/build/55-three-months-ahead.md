# Step 55 — Bookings open about 3 months ahead

**Date:** 2026-10-14
**Decisions:** [D104](../decisions/14-2026-10-13-explore-wording-happy-hour.md).

**Done**

- Migration `20261014003300_book_three_months_ahead.sql`: `venue_settings.booking_window_days` defaults to 92, and the venue's value moves from 7 to 92 **only if it is still 7** (a value set in the back office is kept).
- Back office → Venue → "Book ahead (days)" accepts up to 365 (the API stopped at 60; the database already allowed 365).
- Home page: "You can book up to 3 months ahead." (`formatBookingWindow`: 56 days or more is said in months.)
- Spec: `data-model.md`.

**Verified**

1. Migration applied to the used local database: 7 → 92.
2. API test: the last bookable day is today + the venue's window and is in the window; the next day isn't. It reads the window from the config instead of assuming 7, so a change in the back office can't break it.
3. pgTAP: the seed's window is 92.
4. New browser test: the home page says "up to 3 months ahead"; in the booking calendar, paging forward reaches the last bookable day (selectable unless it's a closed weekday) and the day after is greyed out.
5. **Gate:** see the commit for this step.

**Issues found and fixed**

1. pgTAP `08_bookings` "no further than 7 days ahead" uses fixed dates; with 92 days it no longer threw. The test now sets the window to 7 inside its own transaction (rolled back), as it already does for the opening hours.
