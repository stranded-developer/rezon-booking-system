# Step 61 — The cards' price line back to "from $29.00 · 30 min"

**Date:** 2026-10-15
**Decisions:** [D112](../decisions/14-2026-10-13-explore-wording-happy-hour.md) (supersedes part of D98).

**Done**

- `apps/booking/src/components/experience-card.tsx`: the price lines are the pre-D98 ones again — "from" (when a cheaper price applies by itself), the cheapest price in big lime type, "· 30 min" / "· 1 hour", and "normally $35.00" underneath. Nothing else on the card changed (wording, colours, badges, length pill, happy-hour box, button). Same card on the home page and `/book`.
- Spec: `booking-site.md`.

**Verified**

1. Browser tests: the Single Session card reads "from $29.00 · 30 min" and "normally $35.00", with its happy-hour box and button; the home page's Double Session reads "· 1 hour".
2. Screenshot of the three cards on `/book` checked.
3. **Gate:** see the commit for this step.
