# Step 1b — Database schema, constraints, RLS, seed ✅

**Date:** 2026-09-14

**Done**
- **Supabase CLI** 2.117.0 pinned as a root devDependency. `supabase/config.toml`:
  - project id `raceground`
  - storage, edge runtime and analytics disabled (not needed; saves Docker memory)
  - minimum password length 8
- **Root scripts:** `db:start` (skips unused containers), `db:stop`, `db:reset`, `db:test`.
- **7 migrations** in `supabase/migrations/`, implementing [spec/data-model.md](../../spec/data-model.md):

  | Migration | Contents |
  |---|---|
  | `…0100_foundation` | extensions (btree_gist, citext, pgcrypto), `private` schema, `set_updated_at`, `prevent_modification`, `random_code(len)` (unambiguous 31-char alphabet, bias-free) |
  | `…0200_venue_resources` | venue_settings (single row), opening_hours, resource_types, resources, rate_bands, happy_hours |
  | `…0300_people_membership` | staff (last-superadmin guard), customers (email or phone required), membership_tiers, tier_prices, members (`RG-000001` numbers) |
  | `…0400_referrals_bookings_sessions` | referral_codes, bookings, `expire_stale_holds()`, sessions, member_balance_ledger, member_balances view, referral_redemptions |
  | `…0500_money` | shifts, payments, refunds, cash_movements, price_overrides |
  | `…0600_platform` | stripe_events, audit_log, email_log |
  | `…0700_security` | RLS on every table, no client write privileges, role-scoped read policies, hidden secret columns, realtime publication for sessions + bookings |

  Key constraints in those migrations:
  - **bookings:** GiST exclusion constraint (no double-booking for held/confirmed/arrived), half-open non-empty periods, status transition guard, member XOR referral, hold requires expiry, paid requires price snapshot
  - **sessions:** one open session per resource, closed sessions immutable except void
  - **ledger:** per-member row lock, balance can't go negative, append-only, a grant per invoice at most once
  - **referral_codes:** `uses_count ≤ max_uses`, % range / fixed > 0, alphabet check
  - **money:** payments, refunds, cash movements and overrides append-only; refunds ≤ payment; cash/card payments need a shift; shift close variances must equal counted − expected; closed shifts immutable
  - **audit_log:** append-only
- **Seed** `supabase/seed.sql`: the full launch configuration. No staff are seeded; they need real auth users and PINs, which arrive in Step 1c.

**Issues found by the tests and fixed** (migrations are still local-only, so they were edited in place):
1. **Anonymous visitors got "permission denied for function is_staff".** The public-read policies called a staff helper that `anon` can't execute. Fix: separate `anon` policies (`using (active)`) from `authenticated` policies (`active or is_staff()`).
2. **The `member_balances` view still granted INSERT/UPDATE/DELETE/TRUNCATE to `authenticated`.** It's harmless on an aggregate view, but violates the rule. Fix: revoke all, grant select.
3. **Dropped `FORCE ROW LEVEL SECURITY`** before the first run. It would apply RLS to the table owner (migrations/seed) and gives no protection, since browser roles never own tables.
4. A test used an INSERT inside LATERAL (invalid SQL), and one test file had the wrong test count. Both were test bugs, not schema bugs.

**Verified** (`pnpm db:reset && pnpm db:test`, pgTAP via `supabase test db`, real Postgres 17.6)

**89 tests, all passing:**
- **01_schema_seed (17):**
  - exact table list
  - RLS enabled on every table
  - zero write privileges for anon/authenticated
  - every seed value checked against the spec (rates, 2/6/2 resources, opening hours, happy hour, tiers, booking rules)
  - `random_code` alphabet and uniqueness over 500 codes
  - `expire_stale_holds` not executable by anon
- **02_constraints (48):**
  - overlapping hold rejected, adjacent and other-resource slots allowed
  - empty period, hold without expiry, confirmed without price, and member + referral all rejected
  - a stale hold blocks until `expire_stale_holds()` runs, then frees the slot
  - illegal status transitions rejected, and a cancellation frees the slot
  - second open session rejected, a closed session can't be edited but can be voided, a voided session is frozen
  - referral auto-code format, max uses, 100% code and ambiguous characters
  - ledger: grant once per invoice, balance maths, overspend rejected, adjustment needs actor + reason, append-only
  - cash payment without a shift rejected, payments append-only, refunds can't exceed the payment
  - shift variance must be correct, a closed shift is frozen
  - last superadmin protected, member number format, audit log append-only
- **03_rls (24):**
  - **anon:** reads config but not customers, bookings or settings, and can't write
  - **member:** sees only their own customer, booking and membership rows; can't read token hashes; can't see sessions; can't grant themselves minutes
  - **cashier:** reads sessions, bookings and staff names; can't read PIN hashes or the audit log; can't write
  - **superadmin:** reads the audit log
  - **deactivated staff:** lose access

**Mutation check.** Each protection was removed on its own, the suite run, and the database reset:

| Protection removed | Result |
|---|---|
| Double-booking exclusion constraint | 2 failures |
| Ledger balance guard | 1 failure |
| Referral max-uses check | 1 failure |
| Anon insert grant + policy on config | 2 failures |
| Staff read policy on sessions | 1 failure |
| Last-superadmin guard | 1 failure |
| `pin_hash` exposed to staff | 1 failure |
| Payments append-only trigger | 1 failure |

**All 8 caught.** Final clean run: 89/89.

**Environment note.** Docker Desktop has 4 GB, and another project's containers (citrineos) were running at the same time. There were no conflicts. Local Supabase runs with only db, auth, rest, realtime, kong, meta, studio and mailpit.

**Local URLs:**
- Studio: http://127.0.0.1:54323
- API: http://127.0.0.1:54321
- DB: `postgresql://postgres:postgres@127.0.0.1:54322/postgres`

These are the CLI's standard local-only demo keys, not secrets.
