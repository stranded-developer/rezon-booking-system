# Step 0 — Spec ✅ (2026-09-14)

**Date:** 2026-09-14

**Done**
- Wrote Decisions Log #4 ([decisions/04](../decisions/04-2026-09-14-final-answers-before-build.md)) with the final owner answers.
- Wrote the consolidated spec in [`spec/`](../../spec/README.md): pricing, data model, POS, back office, membership, booking site, architecture.

**Engineering decisions made while writing the spec** (implementation detail, no business change):
- **Base rate per resource type.** Each type has a `base_rate_cents`, and rate bands are optional overrides. This replaces the "nearest band" rule in D19: a minute outside every band uses the base rate. Launch behaviour is identical (flat rate per type).
- **Per-minute classification.** The engine classifies each billed minute by the local time of its start instant, instead of splitting at boundaries. This makes DST correct by construction.
- **Largest-remainder segment amounts.** Per-segment display amounts use largest-remainder allocation, so receipt lines always add up to the subtotal. The discount line is `subtotal − total`.
- **Hold TTL is 30 minutes** to match Stripe Checkout's minimum session expiry.
- **Walk-ins don't block online availability.** Staff are alerted to wrap up before a booking starts.

**Verified:** n/a (documents).
