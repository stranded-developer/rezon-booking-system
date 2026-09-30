# Phase 8j — VR rigs are simulators; Double Race listed second

**Date:** 2026-09-30
**Decisions:** [D77, D78](../decisions/09-2026-09-30-look-vr-member-prompt-games.md).
**Migration:** `20260930002400_vr_rigs_are_simulators.sql`

**Done**

- **VR Sim 1 and VR Sim 2 are resources of the simulator type** (positions 7 and 8), so there are 8 simulators at one price and every experience can be booked on a VR rig. Bookings and sessions point at a resource, never at a type, so nothing historical changes.
- The **VR type and its $40 happy-hour rate band are switched off**, not deleted: audit entries still name them.
- **Double Race is `sort` 2, Leaderboard Challenge 3** — only if they still hold their launch positions, so an order already set in the back office is left alone.
- `seed.sql` now creates the VR rigs as simulators directly and no VR type at all; the migration does nothing on a fresh install (the `vr` type does not exist when migrations run).
- The site: no separate VR card; "Which Driving Simulator?" lists the VR rigs, and the hint says they are the same price. Copy that said "VR seat" now says standard or VR simulator.
- Tests that asserted a separate VR type now assert 2 tables + 8 simulators; the POS happy-hour test is scoped to "Driving Simulator" instead of "VR Seat"; the pgTAP audit test inserts its resource on the sim type.

**Verified**

1. **Existing venue:** the migration applied to the local database as it stood (VR as its own type with a live rate band) → 8 simulators, `vr` inactive, no live VR band, Double Race second.
2. **Replayed in a rolled-back transaction** on a fresh database after recreating the old shape (VR type, VR 1–2, a $40 band, the old order): same result; after the rollback the database was untouched.
3. **Fresh install** (`db:reset`): 2 tables, 8 simulators, no VR type, Double Race second.
4. pgTAP, API and both browser suites — see [35](35-game-track-car.md).

**Flagged for the owner**

- A **walk-in on a VR rig** is now charged the simulator's hourly $60, not $50, and VR has no happy-hour rate any more. Online, the rigs are sold as experiences at the experience prices, which is what "same price" meant.

**Issues found and fixed**

1. `psql` isn't installed on this machine, so the "before" state of the first apply wasn't printed. The replay in step 2 covers it properly; checks go through `docker exec … psql` from now on.
