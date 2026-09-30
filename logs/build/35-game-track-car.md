# Phase 8l — Pick your game, track and car

**Date:** 2026-09-30
**Decision:** [D80](../decisions/09-2026-09-30-look-vr-member-prompt-games.md).
**Migration:** `20260930002500_game_track_car.sql`

**Done**

**Database.** `games` (per resource type), `game_tracks` and `game_cars` (per game), each with `sort` and `active`, the same row security as every public configuration table (anyone reads what is switched on, nobody but the API writes) and the audit trigger. `bookings.sim_setup` (jsonb, `{game, track?, car?}`) keeps the **names** chosen. `booking_hold` stores `simSetup` from its payload: the new function is **generated from the previous one** and differs by exactly three lines (checked with `diff`), so nothing else in the money path could drift. The launch list lives in one function, `private.seed_launch_games()`, called by the migration (existing venue) and by `seed.sql` (fresh install); it does nothing if there are already games.

**API.**
- `/public/config` carries `games` with their active tracks and cars.
- `POST /bookings/hold` takes `simSetup: {gameId, trackId?, carId?}`. The API checks the game is on for **what is being booked**, and that the track and car are on and **belong to that game**; then it passes names to the hold. A bad pick is refused with a clear 422 **before** any booking is made.
- The setup is returned on the booking (customer page, member account, back office), on the day list, on the till's **Today's bookings**, and printed in the confirmation email ("Your setup: …").
- Back office: `GET /admin/games`, `POST /admin/games`, `PATCH /admin/games/:id`. Tracks and cars are sent as the whole list in order; the API removes what was left out, adds what is new, re-orders the rest, and keeps a repeated name once. Every write carries the operator and reason for the audit log.

**Back office.** A new **Games, tracks & cars** screen: the games with their counts and on/off, and a dialog with the game's name, order and two text boxes — tracks and cars, one per line.

**Website.** Under "Any of these apply?" and above the name: **"Would you like to pick your game, track and car?"** Ticked, it shows **Game** (full width — names are long) and **Track** and **Car** side by side. Each is a new `SearchSelect`: a combobox you can type into (it ignores case and accents, so "nurburgring" finds "Nürburgring"), with arrow keys, Enter, and Escape closing only the list — not the booking panel around it. Track and Car are disabled until a game is chosen and cleared when it changes. Pay shows **Your setup**.

**Verified**

1. **API, 9 new tests** (`games.integration.test.ts`, own rig, experience and games): the config lists only active games/tracks/cars in order, against the right resource type; a hold with game + track + car stores the names and shows them; **renaming a car afterwards does not change the booking**; a game alone; nothing picked stores nothing; a track or car from another game, a switched-off game or track, and a game for another resource type are all refused; **a refused pick leaves no booking behind**; the back office replaces lists in order, de-duplicates, keeps the surviving row's id, audits with who and why; adding and switching off a game removes it from the site.
2. **pgTAP, 14 new tests** (`15_games.test.sql`): the launch list exists with tracks and cars, running it twice adds nothing, the VR rigs are simulators, anon reads only what is on and cannot write, a signed-in customer cannot edit, a change is audited with actor and reason, the hold stores an object and ignores anything else.
3. **Browser:** the experience test ticks the box, **searches by typing**, checks the other game is filtered out, checks **only that game's tracks are offered**, picks a car by keyboard, and sees "Your setup: Game · Track · Car" on Pay. Screenshot checked: the game name was cut off in a three-column row, so Game got its own row.
4. **Gate** (fresh database, then again on the used one): turbo **11/11** (pricing 101, API 244) · pgTAP **482** · POS e2e **6** (+1 Stripe skipped) · booking e2e **10** (+2 Stripe skipped).

**Issues found and fixed**

1. **The API couldn't see the new tables' types** until the `@raceground/db` package was rebuilt after `gen:types` — the API reads its built output.
2. **A multi-row insert in a test left `active` null** (PostgREST sends the union of the rows' columns). Every row now names every column. The same failed run crashed before its clean-up and left a test experience on, which then broke pgTAP's "three experiences are seeded" — a count that should never have included other suites' rows. It is now scoped to the launch keys, per the "fresh or used database" rule.
3. My first audit assertion in pgTAP ended in `or true` and could never fail. Replaced with one that sets the API's headers and checks the actor and reason.

**Not built**

- The game list is a **starting guess** (ACC, Assetto Corsa, F1 25) — the owner confirms or edits it.
- The picker is offered on simulators only, because only they have games. A game could be added for another resource type in the back office and it would appear there too.

## For the live site — order matters

The deployed apps must not get this code **before** the database has these migrations: the new API reads the `games` tables for `/public/config`, and the home page would fail the way it did in [build/31](31-live-site-database-behind.md). The migrations are safe for the code that is live now.

1. `supabase db push` — applies whatever is pending: `20260928002300_tier_perks…` if it hasn't been applied since build 31, `20260930002400_vr_rigs_are_simulators.sql` and `20260930002500_game_track_car.sql`.
2. Then deploy the three apps.
