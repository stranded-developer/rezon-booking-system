# Phase 8k — "Are you a member?" at the top of Details

**Date:** 2026-09-30
**Decision:** [D79](../decisions/09-2026-09-30-look-vr-member-prompt-games.md).

**Done**

- The Details step opens, for anyone not logged in, with **"Are you a member?"** — *Yes, log in* and *No, continue as a guest*. It was step 3 of the original booking flow in the spec and had been lost when the panel was rebuilt (D71).
- **Yes** links to `/login?next=/book?experience=<key>&date=<date>&time=<HH:MM>` (or `type=<key>` for hourly). `/book` opens that panel **on Details, at that day and time**; the account is now signed in, so the member box, member price and free play appear. The day/time is used only for the panel the link opened — close it and pick something else and it starts fresh.
- If the time was taken while they logged in, the panel goes back to the times with "4:00 pm has just been taken. Please pick another time." (checked once, against the first times looked up for that day).
- **No** hides the question for the rest of that booking — the answer lives on the panel, so going Pay → Details doesn't ask again.
- **The login page only follows a `next` that is a path on this site** (`/…`, not `//…` or a full URL). Before, `?next=https://elsewhere` would have been followed after a successful login.

**Verified**

1. The member browser test now **starts logged out in a fresh browser**, picks a day and 4:00 pm, sees the question, presses *Yes, log in*, logs in, and lands back on `/book?type=…&date=…&time=16:00` with **Details current, 4:00 pm in the summary and the question gone** — then carries on with every member check it already had (tier discount, no referral field, free play in sessions, the hold taking the minutes).
2. The experience test presses *No, continue as a guest* and checks the question goes.

**Issues found and fixed**

1. **Going back to Details asked again.** The guest's "No" was kept inside the Details step, which is rebuilt each time it is shown. Found by the browser test (a second "Continue"-named button appeared on the way back); the answer moved up to the panel.
2. **The browser tests asked for any button named "Continue"**, which now also matches "No, continue as a guest" for a guest who ignores the question (allowed). They ask for exactly "Continue".
3. The password-reset test failed twice while run against the **dev** server — the button was pressed before the page had loaded — and passed against the production build in the gate, as build step 27 warned.
