# Step 1c — API skeleton, staff auth, PIN operator, audit ✅

**Date:** 2026-09-14

**Done**
- **`packages/db` (`@raceground/db`):**
  - generated `Database` types from the local schema (`pnpm --filter @raceground/db gen:types`)
  - `createServiceClient()` (server-only, no session persistence)
  - `Tables` / `TablesInsert` / `TablesUpdate` helpers
- **Migration `…0800_pin_attempts`:** `register_pin_attempt()`. It is the atomic PIN bookkeeping behind the lockout (details in [spec/architecture.md §3](../../spec/architecture.md)). Service role only.
- **`supabase/config.toml` (local only):** `sign_in_sign_ups` rate limit raised from 30 to 300 per 5 min, so repeated test runs aren't throttled.
- **`apps/api` (`@raceground/api`), Hono 4.13:**

  | File | Contents |
  |---|---|
  | `env.ts` | zod-validated env with defaults (idle 300 s, 5 attempts, 5-min lock, CORS origins) |
  | `middleware/auth.ts` | `requireStaffDevice` (Supabase JWT via `getClaims()` → active staff row), `requireOperator(...roles)` (operator token bound to the device user, staff re-checked every request, sliding renewal) |
  | `lib/pin.ts` | scrypt hash/verify with timing-safe compare |
  | `lib/operator-token.ts` | HS256 sign/verify via `hono/jwt` |
  | `lib/audit.ts` | `writeAudit`, `requestIp` (validated forwarded IP) |
  | `services/staff.ts` | create (auth user + staff row, compensating delete on failure), update (PIN reset clears lockout), list. Before/after audit never includes secrets. |
  | `errors.ts` | `ApiError` + `mapDbError` |
  | `app.ts` | secure headers, CORS, standard JSON errors, 404 |

  Routes:
  - `GET /health`
  - `GET /pos/staff` (lock-screen list)
  - `POST /pos/operator` (PIN → token)
  - `GET /pos/me`
  - `GET|POST /admin/staff`, `PATCH /admin/staff/:id`
  - `GET /admin/audit` (filters + cursor)

  Tooling:
  - `server.ts` for local `pnpm --filter @raceground/api dev` (port 8787)
  - `scripts/create-staff.ts` (`staff:create`) to bootstrap the first superadmin
  - `.env.example` committed; `.env.local` ignored (confirmed with `git status --ignored`)

**Verified**

1. **API tests: 39, all passing** (`pnpm --filter @raceground/api test`, needs local Supabase).
   - **Unit (14):**
     - PIN hash/verify/salting/malformed
     - operator token round-trip; rejects expired, wrong-secret, forged-payload, truncated and garbage tokens
     - `mapDbError` for every mapped code, with no leak of unknown messages
     - `requestIp` parsing
     - env validation and defaults
   - **Integration (25), against real local Supabase with real sign-ins:**
     - **Device session:** no token / garbage / forged JWT → 401; a signed-in non-staff user → 403; lock-screen list contains no PIN hashes.
     - **PIN sign-in:** correct PIN → token + header + audit row; malformed → 422; unknown staff looks identical to a wrong PIN.
     - **Lockout:** 4 wrong → 401 with attempts remaining; 5th → 423; correct PIN while locked → 423; exactly one `staff.pin_locked` audit row; after expiry the correct PIN works and the counter resets.
     - **Race (deterministic):** the test holds the staff row lock from a separate Postgres connection, waits until the API's `register_pin_attempt` is blocked on it, locks the account, and commits. The correct PIN is refused with 423.
     - **Parallel:** 12 simultaneous wrong guesses → exactly 4 × 401 and 8 × 423, one lock audit. Repeated 15× with no flakes.
     - **Operator token:** missing → 401; valid → 200 and renewed with expiry ≥ now + 299 s; expired → 401; other device → 401; other secret → 401; deactivated operator with a live token → 403 immediately; deactivated account's own device → 403.
     - **Superadmin routes:** a cashier operator gets 403 on all 4 admin routes (and the role is unchanged); a superadmin device without an operator → 401; with a cashier operator → 403.
     - **Staff admin:** create cashier → 201, the new cashier can sign in and use their PIN, audit has the actor and no secrets; duplicate email → 409; invalid body → 422 listing all 5 bad fields; update with PIN reset clears the lockout, the new PIN works and the old one doesn't, before/after audit has the reason; unknown id → 404; empty update → 422.
     - **Audit list:** newest first, cursor pagination works.
     - Unknown route → JSON 404.
2. **Database tests: 100, all passing.** `04_pin_attempts` (12) covers counting, lock on the 5th, counter reset, refusal while locked, no re-lock while locked, acceptance after expiry, success reset, inactive/unknown staff refused, and no browser execute privilege.
3. **Mutation check on the API.** Each bug was injected on its own, the suite run, and the source restored (confirmed with a diff):

   | Injected bug | Result |
   |---|---|
   | Operator token not bound to device | 1 failure |
   | Role check skipped | 3 failures |
   | Inactive device staff allowed | 1 failure |
   | Inactive operator allowed | 1 failure |
   | JWT decoded without signature verification | 1 failure |
   | Lockout not audited | 2 failures |
   | `pin_hash` leaking in staff responses | 2 failures |
   | PIN reset keeping the lockout | 2 failures |
   | Trusting the PIN result over the lock state | **survived at first** → deterministic race test added → 1 failure |
   | Token renewal header missing | 1 failure (the first attempt was a syntax-breaking mutation; redone properly) |
   | Renewal keeping a short expiry | 1 failure (after strengthening the sliding test) |

   **Accepted survivor:** removing the pre-check that rejects a locked account before hashing changes no behaviour, because `register_pin_attempt` refuses locked accounts anyway. The pre-check is kept deliberately so a brute-force attempt doesn't make the server hash a PIN on every request.
4. **Real end-to-end run** (the server on port 8787, `curl`, not the in-process test harness):
   - `staff:create` script: usage error on missing args, creates a superadmin, rejects a duplicate with a clear message.
   - **Local Supabase issued an ES256 (asymmetric) token.** The API verified it through JWKS.
   - Wrong PIN → 401 with 4 attempts left; correct PIN → 200.
   - `/pos/me` → operator + device; `POST /admin/staff` → 201; audit rows written with the right actor.
   - **CORS:** preflight from `http://localhost:3001` allowed with `X-Operator-Token`; `https://evil.example` gets no allow-origin header.
5. **Full verification from the repo root:**
   - `pnpm typecheck` → 3/3 packages
   - `pnpm test` → pricing 71 + API 39
   - `pnpm db:test` → 100
   - Also confirmed that tsc really checks the API (14 files; a deliberately wrong probe line fails).

**Issues found and fixed during this step**
1. **Test data piling up.** Test runs left about 280 test staff in the local database, all visible on the lock screen. Tests now deactivate everything they create (`cleanupTestData`). Staff can't be deleted because the append-only audit log references them. One test superadmin always stays active per run, because the last-superadmin guard (correctly) refuses to deactivate it. `pnpm db:reset` gives a clean slate.
2. **State-dependent database tests.** The pgTAP tests assumed an empty database (staff count 0, total audit rows, seeded Table 1/2 and Sim 1/2, bookings on 2026-09-16…18 inside the live booking window). They now use their own fixture resources, dates in 2099, counts scoped to their own fixture ids, and deactivate other superadmins inside their rolled-back transaction. **Verified:** fresh DB → pass; after API tests → pass; API again → pass; DB again → pass.
3. **Flaky parallel test.** The parallel-guess test failed intermittently (6 × 401 instead of ≤ 4). The cause was the test, not the code: the batch included the correct PIN, and a correct PIN legitimately resets the counter. Rewritten with all-wrong guesses and exact expected counts.
4. **Stale config after restart.** `supabase stop` keeps the DB volume, so a restart didn't apply the new migration. Use `pnpm db:reset` after adding migrations.
5. **Typecheck error in test helpers** (TS2742, declaration emit). The API doesn't emit declarations, so `declaration: false` in `apps/api/tsconfig.json`.

**Not yet done (tracked)**
- **Lint** (`pnpm lint`) isn't configured in any package. The quality gate in spec/architecture.md §9 lists it. It will be added together with the first Next.js app, so one ESLint config covers everything.
- **General API rate limiting** (login, referral checks, hold creation) is not built. PIN attempts are protected by the lockout. Planned alongside the booking endpoints and Vercel Firewall at deploy.
