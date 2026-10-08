# Phase 8r — Online bookings are whole 30-minute sessions, on :00 and :30

**Date:** 2026-10-08
**Decision:** [D90](../decisions/12-2026-10-08-sessions-walk-in-blocks-type.md).
**Migration:** `20261008003000_booking_whole_sessions.sql`

**Checked first (the owner asked "does the repo follow this?"):** it didn't. The website offered 30, 45, 60, 75 … minutes (D63: a session, then 15-minute steps), start times every quarter hour, and free play in 15-minute steps after the first session.

**Done**

- **Database:** `booking_hold` copied from its last migration and changed only in its time rules: a booking starts where the minutes since midnight (venue time) are a whole number of sessions, lasts a whole number of sessions, and uses free play in whole sessions. Experiences follow the same start rule. Walk-ins (`pos_close_session`) are untouched.
- **API:** availability still scans the day in quarter hours but only offers starts on the session grid, and the longest length on each resource is rounded down to whole sessions. Quotes refuse a length that isn't whole sessions, a start off the grid (`invalid_time`) and free play that isn't whole sessions. The old "15-minute steps" check on the request body was removed, because it gave a wrong message.
- **Website:** the length list and the free-play list step by a session. The wording now says "booked in 30 min sessions", the home page says "Book in 30-minute sessions", and the free-play hint says "It is used 30 minutes at a time".
- **Spec:** `booking-site.md` §2 (grid, start rule, durations, availability, member free play), `README.md` launch values.

**Verified**

1. **pgTAP `13_sessions`** (now 20): 15, 29, 40 and **45** minutes refused; starts at **11:15 and 11:45 refused**; 30 at 10:00, **60 at 11:30** and 120 accepted; free play of 15, 40 and **45** refused, 30 and 60 accepted, balance down by 90. `08_bookings` and `14_experiences_tournaments` moved their sample times onto the half hour (they test other rules). Full pgTAP **504**.
2. **API:** availability at 10:10 now starts at **11:00** (10:40 rounded up to the half hour), has 20 starts, all on :00/:30, and the last is 20:30. Quotes: 15/40/45/75 min refused, 30/60/120 accepted, 12:30 accepted, 12:15/12:45 refused. Free play of 15/40/45 refused on the quote, 60 accepted. API **256**.
3. **Browser:** the booking test now also checks that 10:30 am is offered, that no :15/:45 time is shown, that the length list has no 15 or 45, and that "1 hour" follows "30 min".
4. **Gate:** see the commit for this step.

**Issues found and fixed**

1. **"A member can ask for a new password" failed three times, then passed.** It passed on the last commit, and then passed twice with this change after a clean rebuild. The cause was the preview server started for the spacing check: `next dev` and `next build` share `.next`, so the build the browser tests served was a mix of the two. Stopping the dev server and rebuilding fixed it. No code change.
2. The first API run failed in 16 files because the shell wasn't on Node 22 (`nvm use 22` doesn't carry over between commands).

**Worth knowing**

- Bookings already made at a quarter past or a quarter to keep their times. Only new bookings follow the grid.
- Changing the session length in the back office moves the grid with it (a 60-minute session would mean starts on the hour).
