# Step 45 — The till locks after an hour; games can list 1000 tracks and cars

**Date:** 2026-10-11
**Decisions:** [D94, D95](../decisions/13-2026-10-11-idle-lock-game-lists.md).

**Done**

- **Idle lock 5 min → 1 hour.** `IDLE_LOCK_MS` in `apps/pos/src/components/pos-provider.tsx` is 60 minutes and the lock message says "Locked after an hour without activity." The API's `OPERATOR_IDLE_SECONDS` defaults to 3600 (`apps/api/src/env.ts`, `.env.example`). Spec: `pos.md`, `architecture.md`, `deploy.md`.
- **Tracks and cars: 200 → 1000 per list.** The limit was only in the API's check of the save (`Names` in `apps/api/src/routes/admin-config.ts`, now `MAX_GAME_LIST`). The database never had one.
- **What raising it would have broken, fixed at the same time:**
  - The database hands out at most 1000 rows per request (`max_rows`). The back office list and the booking site's game picker each read *every game's* tracks and cars in one request, so past 1000 rows in total, names would have silently gone missing. This could already happen at 200 per game with six or so full games. Both now read a page at a time (`apps/api/src/lib/select-all.ts`).
  - Reordering a list saved each moved row with its own request: up to 1000 requests in one save. It is now one request.
  - Removing many names put all their ids in one URL; it now removes 100 at a time.

**Verified**

1. New API test (`games.integration.test.ts`): a game saved with 1000 cars reads back all 1000, in order, in the back office and on the booking site; reversed in one save; 1001 is refused (422); cut to 3, the other 997 are gone.
2. The auth tests now expect a one-hour operator token.
3. **Gate:** see the commit for this step.

**Issues found and fixed**

1. One auth test still expected a 300-second token; updated to 3600.
2. A booking-site browser test ("an experience is booked for its own fixed length") failed after the 1000-car test had run: it expected "Aston Martin V8 Vantage GT3" as the first car, but the panel rightly showed the venue's first car, "Ferrari 296 GT3". The test read the cars from the database without asking for the venue's order. After a table has held many rows, the database may return unordered rows alphabetically instead. The test now asks for the order the panel uses. The site itself was right.

**For the live site**

- If `OPERATOR_IDLE_SECONDS` was set on the API's Vercel project, it overrides the new default: remove it or set it to 3600. The POS needs a redeploy for its own one-hour timer.
