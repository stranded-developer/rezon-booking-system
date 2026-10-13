# Step 51 — The big "come 15 minutes early" notice

**Date:** 2026-10-13
**Decisions:** [D100](../decisions/14-2026-10-13-explore-wording-happy-hour.md), [D98](../decisions/14-2026-10-13-explore-wording-happy-hour.md).

**Done**

- `ArriveEarlyNotice` (`apps/booking/src/components/session-rules.tsx`): a lime band in big capitals, "PLEASE COME 15 MINUTES BEFORE YOUR BOOKING TIME TO CHOOSE CARS, TRACKS AND GAMES". The owner's wording, with "minutes" and "your booking time" for grammar. The minutes are the back office's arrive-early setting (D85), so changing it there changes the notice.
- On the pay step, right above the terms box and the Pay button, so it is the last thing read before finishing. The "Before you arrive" rules stay where they were.
- Spec: `booking-site.md`.

**Issues found and fixed**

1. The summary beside the steps showed the happy-hour price ($29.00) in big type before a start time was picked: it still used the old "from" price. It now shows the normal price ($35.00), as the cards do (D98), until a quote replaces it.

**Verified**

1. Browser test (experience booking): the notice is there on the pay step, reads exactly that sentence with the venue's minutes, and is set in capitals.
2. Screenshot `web-14c-happy-hour` checked: the band sits under Cancellations, above the terms box.
3. **Gate:** see the commit for this step.
