# Phase 7d — Time is sold in 30-minute sessions

**Date:** 2026-09-16
**Decision:** [D63](../decisions/07-2026-09-15-booking-website.md).

**Done**

**The rule**, in one line: a session is 30 minutes; a booking is at least one session and then 15-minute steps; a walk-in is unchanged.

**Database** (migration `20260916001700_sessions.sql`)
- `venue_settings.session_minutes`, default 30, has to be a whole number of quarter hours. One setting for the venue, editable in the back office.
- `booking_hold`: the minimum is now the **session**, not the resource type's minimum (which stays as the walk-in minimum). Free play on a booking must be **a whole session, then 15-minute steps**.
- `pos_close_session`: free play at the counter comes in **15-minute blocks** — a half-session walk-in costs half a session.
- Tier allowances in sessions: Silver 2, Gold 4, Diamond 8 a month, rolling over for ten months (600 / 1200 / 2400 minutes). Applied to the launch values in `seed.sql` for new installs and, for a venue already running, only to tiers still on the old defaults — anything the owner has changed is left alone.
- Both functions were **copied from their original migrations and changed only where intended**, rather than retyped, so nothing else in those money paths could drift.

**API**
- `/public/config` and `/public/availability` publish `sessionMinutes`, so the website offers the right choices instead of guessing.
- Availability only offers a start time if a **whole session** still fits before closing — the last start on a 21:00 close is now 20:30, not 20:45.
- Quotes and holds refuse a length under a session or off the quarter hour, and free play that isn't a whole session in 15-minute steps. The quote has to check this itself: it never reaches the database, so a wrong amount would price the booking wrongly and only fail at payment.
- Back office: session length is editable, validated to quarter hours.

**Booking website**
- Lengths start at a session and step by 15 minutes. Free play offers "none", then a session, then 15-minute steps.
- Wording follows: "A session is 30 minutes, and you can add 15 minutes at a time", and the home page says what a session costs rather than quoting the walk-in minimum.

**POS**
- Free play at the counter is chosen from 15-minute blocks instead of a free-text number of minutes, so an amount the database would refuse can't be typed.

**Spec updated:** `README.md` (launch values), `membership.md` §1 (allowances in sessions), `booking-site.md` §2 (durations).

**Verified**
1. **pgTAP `13_sessions` (16):** the setting and its quarter-hour rule; 15 and 29 minutes refused, 40 refused as off-grid, 30/45/120 accepted; free play of 15 or 40 minutes refused on a booking, 30 and 45 accepted, balance reduced correctly; the walk-in minimum still 15; free play of 20 minutes refused at the counter and 15 accepted. Full pgTAP **423**.
2. **API:** a new test for the session rules on quotes (15 and 40 refused, 30/45/120 accepted, `sessionMinutes` published), and free-play amounts refused on the **quote** itself. Existing suites updated where the rule changed: availability's last start is 20:30 with 40 slots, and Diamond's renewals now grant 240 minutes.
3. **Browser:** the booking site's length list starts at 30 min with no 15-minute option, and the member's free-play list has no 15-minute option and starts at one session. The POS suite is unchanged and passes.
4. **Mutation check, 8 deliberate breaks, 8 killed** (one only after a test was added):
   - **Database (3):** a booking allowed to be half a session, free play on a booking with no minimum, free play at the counter in any amount.
   - **API (4):** availability offering slots too short for a session, the length check removed, the free-play check removed, the session length not published to the website.
   - "The API stops checking free-play amounts" **survived at first** — the database still refused it, so nothing broke, but the customer would have seen a wrong price and only hit the error at payment. A quote-level test was added and it is now killed.
5. **Gate** (clean `db reset`, same command as the commit): pgTAP 423 · turbo 11/11 (pricing 78, API 191) · POS e2e 6 passed · booking e2e 7 passed.

**Issues found and fixed**
1. **A test from the previous step only passed on a freshly reset database.** It asserted the exact number of memberships the daily expiry ended, which counts every member — so once earlier browser runs had left counter memberships behind, it failed. Now scoped to its own rows, and checked on both a used and a fresh database, as the project requires.
2. The first attempt rewrote `booking_hold` from memory, which quietly lost several checks. Thrown away and replaced with a copy-and-patch of the original.

**Worth knowing**
- **Gold and Diamond earn more than before** (60 → 120 and 240 minutes a month). Existing members keep what they have and earn the new amount from their next renewal.
- The change is in the database, so it applies to the counter, the website and the API at once. Changing the session length later is one setting, not a release.
