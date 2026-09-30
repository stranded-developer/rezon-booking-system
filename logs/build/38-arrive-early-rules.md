# Phase 8o — Before you arrive: the session rules

**Date:** 2026-10-01
**Decision:** [D85](../decisions/10-2026-10-01-poster-tiles-rules.md).
**Migration:** `20261001002600_arrive_early.sql`

**Done**

- `venue_settings.arrive_early_minutes` (default 15, 0–120), editable in Venue & hours next to No-show hold, carried in `/public/config` and on each booking.
- `SessionRules` / `sessionRules()` in one place: arrive N minutes early; the session starts and ends at the booked time and arriving late doesn't extend it; the spot is held M minutes. Shown on the **Pay** step (above Cancellations), on the **booking page**, in the **terms**, and in the **confirmation and reminder emails**.
- Checked against the till: an arrived booking turns **Overdue** at its *booked* end whatever time it was checked in, so the rule describes what already happens.

**Verified**

1. API: changing Arrive early to 20 shows 20 in the public config; restored after.
2. pgTAP: the launch value is 15.
3. Browser: the experience test sees "Before you arrive" and "Arriving late does not extend it" on Pay.
