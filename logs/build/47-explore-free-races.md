# Step 47 — Explore goes to the top; "x FREE RACES PER MONTH"

**Date:** 2026-10-13
**Decisions:** [D96, D97](../decisions/14-2026-10-13-explore-wording-happy-hour.md).

**Done**

- **Explore** in the bottom bar (`apps/booking/src/components/bottom-bar.tsx`) links to `/`. From another page that opens the home page at the top; on the home page itself a link to the same page does nothing, so the button scrolls up. The `#explore` anchor on Types of driving is gone with it.
- **Tiers:** "2 FREE RACES PER MONTH" (one: "1 FREE RACE PER MONTH") on the membership page (`membership-view.tsx`) and in the home page's members club (`app/page.tsx`).
- Spec: `booking-site.md` (bottom bar, membership page).

**Verified**

1. Booking-site browser test "home page": Explore, tapped far down the home page, brings it back to the very top (`scrollY` 0); tapped from `/book`, it opens `/` at the top.
2. Browser test "membership page": Gold reads "4 FREE RACES PER MONTH".
3. **Gate:** see the commit for this step.
