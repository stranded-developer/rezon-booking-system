# Decisions 13 — 2026-10-11: the till locks after an hour, longer game lists

**Supersedes:** the 5-minute idle lock in `spec/pos.md` (D94); the 200-name limit on a game's tracks and cars from build step 35 (D95).

## D94 — The till locks after 1 hour without activity ✅ owner 2026-10-11

**Asked:** "autolock currently is at 5 mins make it to after 1 hour of inactivity."

**Decision:** the POS goes back to the PIN screen after **60 minutes** with no tap, key or scroll (was 5). "Lock" still locks at once. The API's operator token lasts the same hour (`OPERATOR_IDLE_SECONDS` default 3600), and the background refresh of the floor still doesn't count as activity, so the screen and the server agree.

**Worth knowing:** for that hour, anyone at the counter can act as the last person who entered a PIN. Pressing "Lock" when stepping away is now the main protection.

## D95 — A game can list up to 1000 tracks and 1000 cars ✅ owner 2026-10-11

**Asked:** "when adding games/tracks/cars … there is a limit of max 200 … is this db enforced … can we change the cap to 1000?"

**Answer:** it was the API, not the database: the back office save refused a list longer than 200. It is now 1000 per list (tracks and cars counted separately, per game). Names stay up to 80 characters.
