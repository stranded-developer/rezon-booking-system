# Step 60 — Game, track and car picking only for 1-hour sessions

**Date:** 2026-10-15
**Decisions:** [D111](../decisions/14-2026-10-13-explore-wording-happy-hour.md).

**Done**

- API: `PICK_GAME_FROM_MINUTES = 60`. A hold with a game pick on anything shorter is refused (422, "Picking your game, track and car is for 1-hour sessions"); `/public/config` tells the site the length (`pickGameFromMinutes`).
- Booking site: the "pick your game, track and car" box is shown only when the booking is at least that long (Double Session at launch); a pick is never sent for a shorter one.
- Spec: `booking-site.md`.

**Verified**

1. API (`games.integration`): its test session is now an hour (the game tests pass on it); a new 30-minute session refuses a game pick with that message and books fine without one; the config says 60.
2. Browser tests: Single Session (30 min) has no picker and no "Your setup"; a new test books a Double Session (1 hour), searches and picks a game, a track of that game only, and a car, and sees "Your setup" with all three on the pay step (moved from the Single Session test).
3. **Gate:** see the commit for this step.

**Issues found and fixed**

1. Two game API tests failed at first because their test session was 30 minutes, which the new rule rightly refuses; it is now an hour.
