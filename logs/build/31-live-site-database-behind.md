# Phase 8h — The live site was down: its database was on the old schema

**Date:** 2026-09-28
**Decisions:** [D65, D66](../decisions/08-2026-09-23-public-site-experiences-tournaments.md) (the data this restores).
**Migration:** `20260928002200_launch_experiences_for_existing_venue.sql`

**What the owner saw**

The deployed booking site showed *"Our booking system is having a moment. Please try again shortly, or call the venue."* on the home page, and a **database error** when trying to book.

- Booking site: `https://raceground-booking.eatzyeats.com`
- POS: `https://raceground-pos.eatzyeats.com`
- API: `https://raceground-api.vercel.app`

**What was actually wrong**

The apps were deployed with the new code, but **the hosted Supabase database had never had this phase's migrations applied**. Narrowed down from the outside, without touching anything:

| Endpoint | Result | What it touches |
|---|---|---|
| `/health` | ✅ 200 | nothing — proves the API is up and configured |
| `/public/availability` | ✅ 200 | only tables that already existed |
| `/public/config` | ❌ 500 "Database error" | `experiences`, `experience_promos`, `site_events` |
| `/public/tournaments` | ❌ 500 "Database error" | `tournaments` |

The availability response also returned `baseRateCents: 3000` and `open: "10:00"` — the **old** launch values — which confirmed the database was pre-Phase-8 rather than merely missing a table.

The home page asks for `/public/config` first, so the whole page fell back to its error message; the booking panel could not load for the same reason.

**The second problem, which would have been the next surprise**

`supabase db push` applies migrations but **never runs `seed.sql`**. Applying the four pending migrations would have created the `experiences` tables and left them **empty** — the live booking page would have loaded and offered nothing at all. No Quick Race, no Double Race.

**Done**

A migration that inserts the launch experiences and their promotional prices **for a venue that already exists**, and deliberately does nothing on a fresh install:

- On a fresh install, migrations run **before** `seed.sql`, so `resource_types` is still empty, the join matches no rows, and the seed remains the single source of the launch data.
- On a venue already running, the simulator type exists and the rows are inserted once.
- Guarded on *"no experiences at all"* rather than *"none with this key"*, so a venue that has already made its own is left alone.

**Verified**

1. **Case A — fresh install.** `pnpm db:reset` then counted: **exactly 3 experiences and 6 promotional prices**, not 6 and 12. The migration correctly adds nothing when the seed is going to.
2. **Case B — existing venue.** In a transaction: deleted every experience and promotional price to reproduce what the hosted database would look like after `db push`, ran the migration body against that state, and got **3 experiences and 6 promotional prices back with the right amounts** — Quick Race $35 with Happy Hour $29 and Student $32, Double Race $58 with $49 and $52. Rolled back, and confirmed the seeded rows were untouched.
3. **Gate:** turbo **11/11** · pgTAP **468** · POS e2e **6** · booking e2e **10**.

**Not done, on purpose**

Nothing was run against the hosted database. `CLAUDE.md` says to ask the owner before anything involving hosted Supabase, and this is production data. The owner chose *"you run it, I prepare it"*, so the commands are theirs to run. They confirmed there is no real booking, member or payment data yet, and that the new hours, prices and tier values should all be applied.

**The commands the owner runs, from the repo root**

```
supabase db push      # applies the 5 pending migrations to project uwfkwcfdegyhvyuspyqr
```

Then check:

```
curl -s https://raceground-api.vercel.app/public/config | head -c 200
curl -s https://raceground-api.vercel.app/public/tournaments
```

Both should return JSON rather than `{"error":{"code":"internal","message":"Database error"}}`.

**What changes on the live site when they do**

| | Before | After |
|---|---|---|
| Opening hours | 10:00–21:00 every day | Mon–Thu 12:00–22:00 · Fri 12:00–24:00 · Sat 11:00–24:00 · Sun 11:00–22:00 |
| Billiard table | $30.00/hr | $25.00/hr, $20.00/hr in happy hour |
| VR seat | $50.00/hr | $50.00/hr, $40.00/hr in happy hour |
| Silver / Gold / Diamond | $100 5% · $200 10% · $300 15% | $48 10% · $78 20% · $128 20% |
| Happy hour | Mon–Fri 10:00–15:00, 10% off | switched off; flat prices 12:00–15:00 every day |
| Experiences | none | Quick Race, Leaderboard Challenge, Double Race |

No code change and no redeploy is needed — the deployed apps are already the new build.

**Worth knowing**

- **`supabase db push` does not run the seed.** Any launch data a *new* feature needs on an *existing* installation has to come from a migration, guarded so a fresh install does not get it twice. This is the first time the project has needed that, and it will apply to every future phase that adds seeded rows.
- **A deploy exists.** The logs said the deploy was still the owner's to do, so it had not been considered when the migrations were written. The status table in `logs/README.md` is updated.
