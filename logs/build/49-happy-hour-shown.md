# Step 49 — Happy hour shown in the session times and the summary

**Date:** 2026-10-13
**Decisions:** [D99](../decisions/14-2026-10-13-explore-wording-happy-hour.md).

**Done**

- **API** (`apps/api/src/services/happy-hour.ts`): happy hour as a guest sees it — its name, the price, and the normal price — worked out **by the pricing engine itself**, so a label can never disagree with the charge.
  - An experience: the cheapest promotional price that applies by itself at that start time (a student price, which has to be asked for, never counts).
  - Booked by the hour: priced with and without the rate bands and happy hours; cheaper with them means happy hour. A cheaper rate band has no name of its own, so it is called "Happy hour" (the billiards happy hour, D74).
  - `GET /public/availability`: every slot has `happyHour` (or null).
  - `POST /public/quote`: `happyHour` when it set this price. When a member's own price is cheaper it wins (D82) and the booking isn't called happy hour.
- **Booking site** (`booking-panel.tsx`):
  - A violet **Happy hour** tag on each start time in happy hour, above the experience name and the "x spots" that were already there. No "Quick race" label (owner: not needed).
  - In happy hour, a highlighted **"Happy Hour price $29.00 ~~$35.00~~"** in the summary beside the steps and on the pay step, above the line-by-line explanation and the total.
- Spec: `booking-site.md`, `architecture.md`.

**Verified**

1. API tests (`experiences.integration.test.ts`, on a fixed Saturday with this run's own experiences and a half-price rate band 12:00–15:00):
   - availability: 12:00 and 14:30 are happy hour ($29 for $35), 15:00 and 17:00 are not; by the hour, 13:00 is $15 for $30 and 17:00 is not;
   - quote: 13:00 is happy hour; 17:00 isn't; the student price isn't; by the hour, an hour from 14:30 is $45 for $60 (half of it in happy hour), at 17:00 it isn't.
2. Browser tests: on the Single Session times, 12:00 pm and 2:30 pm say "Happy hour", 3:00 pm and 6:00 pm don't. New test: a happy-hour start time shows "Happy Hour price $29.00 $35.00" in both places and a total of $29.00.
3. Screenshots `web-14a-times`, `web-14c-happy-hour` checked.
4. **Gate:** see the commit for this step.

**Issues found and fixed**

1. The new browser test first opened the panel from a `?experience=` link; the calendar wasn't loaded yet, so the day picker paged past the right month. It now opens the panel from the card, as a customer does.
2. The gate's database tests then failed: "happy hour 12:00–15:00 every day: billiards $20/hr" lists every active rate band, and the new API test's half-price band on its own test rig was still there. The API test now deletes its band when it finishes (the leftover from that run was removed by hand), so the check sees only the venue's own.
