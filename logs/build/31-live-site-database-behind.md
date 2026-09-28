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

---

## Follow-up, after the owner ran `db push`

**What they asked**

They ran the push, then sent back the first 200 characters of `/public/config` and asked *"is this as expected?"*

**Checked, live**

Everything in the table above had applied:

| | Live value |
|---|---|
| Experiences | Quick Race $35 (from $29) · Leaderboard Challenge $35 (from $29) · Double Race $58 (from $49), 2 promotional prices each |
| Billiard table | $25.00/hr, $20.00/hr in happy hour |
| VR seat | $50.00/hr, $40.00/hr in happy hour |
| Hours | Mon–Thu 12:00–22:00 · Fri 12:00–24:00 · Sat 11:00–24:00 · Sun 11:00–22:00 |
| Tiers | Silver $48 / 10% · Gold $78 / 20% · Diamond $128 / 20% |
| `/public/tournaments` | 200 `{"timeZone":"Australia/Sydney","tournaments":[]}` |
| Home page | renders the three experiences |

**One thing was still missing: the tier perks**

Every tier came back with `perks` **empty**. The live membership page showed the three names, prices and percentages, but none of the ★ lines underneath — no "Monday to Friday", no free billiard hours, no food and drink discount, no birthday session.

Exactly the same class of bug as the experiences, and missed for the same reason: `20260923001800` added `perks` as a column with an empty default, and the only thing that fills it is `seed.sql`, which `db push` never runs. Writing `20260928002200` should have prompted a sweep for *every* column and table in the phase that depends on the seed. It did not, so this one surfaced only because the live page was read rather than assumed.

**Done**

`20260928002300_tier_perks_for_existing_venue.sql`, built the same way as `…002200`:

- Fills `perks` only where it is **still empty** (`cardinality(perks) = 0`), per tier.
- Does nothing on a fresh install, because migrations run before the seed and `membership_tiers` is empty at that point.
- Lists only what the system does **not** enforce. The discount, the monthly free play and its roll-over are applied automatically and the page already prints them from the tier's own numbers, so repeating them here would show each one twice (the mistake found and fixed in build step 27).

**Verified**

1. **Wording matches the seed exactly.** Diffed the perk strings in the migration against `supabase/seed.sql`: identical. (It caught one of mine: "host it with us" where the seed says "hold it with us".)
2. **Case A — fresh install.** `pnpm db:reset`, then counted: Silver 1, Gold 4, Diamond 7 — the seed's own values, so the migration added nothing.
3. **Case B — existing venue.** In a rolled-back transaction, set every tier's `perks` to empty to reproduce the hosted database, ran the migration body, and got 1 / 4 / 7 back with the right text (Gold: Monday to Sunday · 2 free hours of billiards a month · 20% off food and drinks · Early access to registrations and promos).
4. **Case C — the owner's own wording is safe.** Set Gold's perks to a single line of "their own", ran the migration: **0 rows updated** for all three tiers and Gold kept its own line. The back office stays in charge of the text once it is set.
5. **Gate:** turbo 11/11 · pgTAP · POS e2e · booking e2e, all green in the same run as the commit.

**What the owner does**

```
corepack pnpm exec supabase db push
```

One migration to apply. The membership page then shows the perks under each tier. No redeploy needed.
