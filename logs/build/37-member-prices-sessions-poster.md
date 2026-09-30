# Phase 8n — Flat member prices, Single/Double Session, the membership poster

**Date:** 2026-10-01
**Decisions:** [D82, D83, D84](../decisions/10-2026-10-01-poster-tiles-rules.md).
**Migration:** `20261001002700_member_prices_and_sessions.sql`

**Done**

**Pricing engine.** `priceExperience` takes `memberPriceCents`. A member's price is now **one more candidate**, not a discount: the tier's flat price (or, without one, the tier's percentage off the list price) wins if it is ≤ the cheapest promotion that applies, ties going to the member price. The member percentage is no longer applied after that, so it can never come off Happy Hour. The applied price says what set it ("Gold member price $28.00 (normally $35.00)") with `promo.member = true`, and there is no separate discount line. Time by the hour is untouched.

**Database.** `experience_member_prices (experience_id, tier_id, price_cents)`, public read, API-only write, audited; the launch values in `private.seed_launch_member_prices()`, shared by the migration (existing venue) and `seed.sql` (fresh install). The migration renames Quick Race and Double Race only while they still carry their launch names, writes the poster's perk lines, and sets Diamond's free monthly tournament to 1.

**API.** The member's tier id is now on `MemberSummary`; a quote looks up that tier's flat price for the experience. `/public/config` carries each experience's `memberPrices`. Back office: `PUT /admin/experiences/:id/member-prices` (a price or `null` per tier), audited; `GET /admin/experiences` includes them.

**Back office.** Each experience card lists what every tier pays ("Silver $32.00 · Gold $28.00 · Diamond $28.00", or "10% off" where no flat price is set) and has a **Member prices** dialog.

**Website.** The membership page is the poster (see D84). The booking panel's member box says "Gold member price" for an experience and keeps "Gold member · 20% off" for time by the hour.

**Verified**

1. **Pricing, 104 tests** (was 101): X10–X12 rewritten from "stacks" to "never stacks"; new X11b (percentage fallback), X12b (tie goes to the member price; Gold at 13:00 without a flat price is $28, not $23.20), X12c (whole cents only); X20's explanation now reads "Gold member price $46.00" with no discount line.
2. **API, 7 new tests** (`member-prices-tiles.integration.test.ts`, own rig/experience/promos and two real signed-in members): prices saved and audited with who and why, published in the config; **Gold quotes $28 and Silver $32** (not $31.50); at 13:00 **Gold $28 beats Happy Hour $29 and Silver pays $29**; a cheaper claimed price still wins; removing a flat price falls back to the percentage; a guest's price is unchanged.
3. **pgTAP, new `16_…`**: the names and taglines, the six poster prices exactly, none for Leaderboard Challenge, idempotent seeding, one price per tier per experience, the poster's lines, the tiers' numbers, anon can read but not change, a price change audited with actor and reason.
4. **Browser**: the membership page shows Gold's "4 races per month", "(Only $19.50 per race)", "20% off next bookings", Single Session **$28** and "Most popular"; Silver **$32**; "What you'd pay" is gone. The back office test sets a Gold member price on its own experience and sees "Gold $25.00".
5. Screenshots compared with `poster-example.jpeg`.

**Issues found and fixed**

1. "/ Month" came out as "/ MONTH": the heading class sets capitals on everything inside it. The price suffix uses the heading font without the capitals.
2. Four pgTAP assertions expected the old names in error messages ("Quick Race runs for 30 minutes") and Diamond's free tournament being off — both now intended changes.

**Flagged**

- Leaderboard Challenge has no flat member price (not on the poster), so Silver pays $31.50 for it — less than Silver's $32 Single Session.
