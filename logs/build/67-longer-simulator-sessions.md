# 67 — A simulator session booked for longer, made of the packages

**Date:** 2026-11-05
**Decision:** [D118](../decisions/16-2026-11-05-happy-hours-longer-sessions.md).

**Done**

- **Pricing engine**
  - `splitIntoPackages(minutes, packages, preferredId)`: a package of exactly that length, else the longest first; null if they can't make it.
  - `priceExperience` takes `minutes`, `packages` and `memberPrices`. Each package is priced at its own start time with the same choice as before (cheapest promotion, or the member's price; D66, D82), now in `choosePrice`. Free play, groups, referrals and GST are unchanged, over the whole length.
  - `experience.pieces` lists the packages, and the explanation has one line per package. A booking that is just the package is unchanged (all 121 earlier tests pass as they were).
- **Database** (`20261105000100_longer_package_bookings.sql`)
  - `experiences.extendable`, on for `quick_race` and `double_race`.
  - `booking_hold` lets an extendable package run longer, in whole sessions only and never shorter. The overlap rule is unchanged.
- **API**
  - `quoteBooking` takes `durationMinutes` with `experienceKey`. A package that isn't extendable refuses another length (422; until now it was quietly ignored).
  - `loadSessionPackages` loads the type's extendable online packages and their promotions. Member prices are loaded for all of them.
  - A student price asked for on the booked package is asked for on every package with a price of that name.
  - `quote.happyHour` on a longer booking: happy-hour price on the packages that start in it, list price on the rest.
  - `/public/config` says `extendable`. The back office saves it.
- **Website** (now depends on `@raceground/pricing`, a workspace package; the Vercel build already builds dependencies first)
  - *How long?* appears for an extendable package. It runs from the package's own length up to what the simulator (or, for a group, every simulator) is free for, and offers only lengths the packages can make.
  - A note says how longer bookings are priced. The quote line shows each package.
- **Back office, *Experiences*:** "Customers can book it for longer online" tick, and a *Can book longer* badge.
- **Spec:** `pricing.md` §9.2a, `booking-site.md`, `data-model.md`, `back-office.md`.

**Verified**

1. **Unit (8 new, 129 in all):**
   - the split: exact length first, longest first, the owner's own 2-hour package, and null;
   - 2 h outside happy hour is $116, with its explanation;
   - 2 h from 14:00 is $49 + $58;
   - 90 min is $93, and 3 h with a $99 2-hour package is $157;
   - a Single booked for an hour is the 1-hour package;
   - member prices per package, free play over the whole length, and a group of 3;
   - a student price on each package;
   - a length that can't be made is refused.
2. **pgTAP `21_longer_package_bookings` (8):**
   - only Single and Double Session are extendable;
   - 2 h and 90 min holds keep their whole length;
   - the second hour of the 2-hour hold is taken for anyone else;
   - Leaderboard Challenge, 75 min, and a length shorter than the package are refused;
   - switching it off refuses again.
   - `14_experiences_tournaments` test 11 now checks a 45-minute Single, since 60 minutes is allowed now.
3. **API (`experiences.integration`, +5, 33 in the file):**
   - 2 h from 14:00 is $107, with the happy-hour figures and the explanation lines;
   - 90 min is $93, and a Single for an hour is $58;
   - the student price;
   - 75 and 30 minutes are refused;
   - a $0 2-hour hold is confirmed, its booking page says 120 min, 10:00–12:00. Availability shows 11:00 taken and 12:00 free on that rig, and a 11:30 booking there is refused `slot_taken`.
   - A non-extendable package now refuses a different length.
4. **Website browser test (new):** Double Session, then 2:00 pm, then *2 hours*. The total is Happy Hour + full price (read from the database). There's one line per hour, and *How long* says 2 hours; the screenshot was checked. The Single Session test now expects the length choice, starting on 30 min.
5. **Local API by hand:**
   - Double from 14:00: 60 min $49 · 90 min $84 · 120 min $107 · 150 min $142;
   - Leaderboard Challenge for 60 minutes is refused.
6. **Gate:** see the commit for this step.

**Issues found and fixed**

1. The first website test run failed on every test. A website server I had started earlier was still running and serving pages from the previous build, whose script files the rebuild had replaced, so the page stayed on "Loading". It was stopped and the run repeated. This was not a code problem.

**Also checked (owner's question 2): "4:30–5:30 went through though 5–6pm was booked"**

Not reproduced, on simulators or billiard tables. With 5–6pm booked on all 8 simulators (and on both tables):
- the 4:30 Double Session shows **Full**;
- a hold for it is refused (`slot_taken`);
- the database's no-overlap rule backs it up.

A 4:30 booking only goes through when another simulator is free. The live availability for 7 November showed 6 simulators free at 4:30 and none from 5:30. Nothing in the code moves a booking to an earlier time. I've asked the owner for the booking reference if it happens again.

**Before deploying:** `supabase db push` (this step's migration) before the new API goes live. The new API reads `experiences.extendable`.
