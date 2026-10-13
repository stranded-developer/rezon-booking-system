# Step 50 — The tournament list no longer breaks past ~200 tournaments

**Date:** 2026-10-13

**Found:** during step 49's gate, the POS browser test "a superadmin creates … a tournament" failed: Back office → Tournaments showed **"Database error"** and an empty table. The local database had 211 tournaments (each test run adds some). To count sign-ups, the API asked for the entries of *every* tournament in one request with all their ids in the URL; at about 200 ids the URL is too long and the request is refused. A real venue would reach it after a few years of weekly tournaments. Not caused by step 49.

**Done**

- `takenSpots()` in `apps/api/src/services/tournaments.ts`: counts confirmed entries and live holds 100 tournaments at a time, each batch read in full (`selectAll`), so neither many tournaments nor more than 1000 entries can break it or cut it short.
- Used by both places that had the single request: Back office → Tournaments (`GET /admin/config/tournaments`, which now also reads the tournament list a page at a time) and the public tournament list.

**Verified**

1. New API test: with 150 more tournaments than before, the back office list returns all of them and still counts the earlier tournament's 2 sign-ups. The test removes its tournaments afterwards.
2. The failing POS browser test passes (gate).
3. **Gate:** see the commit for this step.
