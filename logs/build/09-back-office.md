# Phase 4 — Back office ✅

**Date:** 2026-09-14

### 4a — Database and admin API

**Done**
- **Migration `…1000_admin`:**
  - **`audit_config_change` trigger** on 9 config tables. It reads `x-rg-actor` / `x-rg-reason-b64` from PostgREST's `request.headers`, so the change and its audit commit together.
    - Checked first against the real stack: a probe function returned the header value as `service_role`, and the probe was removed afterwards.
    - No-op updates are skipped, and so are updates that only change a referral code's use count.
  - **Functions:** `admin_create_member` (complimentary), `admin_adjust_balance`, `admin_reissue_qr`, `admin_set_tier_price` (+ `tier_prices` history), `pos_refund_payment` (partial refunds). All service-role only.
- **API** (`routes/admin-config.ts`, `routes/admin-members.ts`, nested in `/admin`, so a superadmin operator is required):

  | Area | Routes and rules |
  |---|---|
  | Settings | ABN normalised to 11 digits |
  | Opening hours | Full week, validated |
  | Resource types and resources | Can't retire one with an open session or upcoming bookings |
  | Rate bands, happy hours | Create / edit / toggle / delete; overlaps rejected using `@raceground/pricing` validators against the active set |
  | Tiers | Benefits validated with `validateTier`; price change returns `stripeSyncPending` |
  | Members | List / search / detail with ledger; complimentary create returns a one-time `rg:m:` card code; balance ±; card reissue |
  | Referral codes | Batch generate up to 100; edit limit / expiry / active; a limit below uses already made gets a clear 422; redemptions list |
  | Sales | By venue day; void; partial refund |
  | Shifts | List with flagged filter |
  | Audit | Actor and approver names |

  Also added:
  - `auditHeaders()` helper; every admin write to a config table uses it
  - `mapDbError` maps foreign-key errors (23503) → 422 `invalid_reference`
  - CORS allows PUT

**Verified**
1. **pgTAP `06_admin`: 35 tests.**
   - **Trigger:** no audit without request headers; actor, before/after and a UTF-8 reason recorded ("Rate rise — Sept"); no-op update skipped; insert and delete audited (delete with before image only); opening hours keyed by day; venue settings audited; use-count bump skipped but deactivation audited; a malformed actor header records "unknown" without breaking the write.
   - **Complimentary member:** contact and reason required; created active with member number and end date; audited.
   - **Balance:** +90 / −30; overdraw refused; reason required; zero refused; before/after audited.
   - **Card reissue:** hash format enforced; old card replaced; audited without the hash.
   - **Tier price:** same price refused; changed with history.
   - **Partial refund:** $20 with a cash-out movement; more than what's left refused; remaining $30 OK; audited twice; reason required; no browser execute privilege.
2. **Found by those tests:** the trigger built its ignore list with `text[] || 'uses_count'`, which Postgres reads as a malformed array literal. It fails only on referral code updates that come through the API, so **every POS close using a referral code would have failed in production.** Fixed with `array_append`.
3. **API `admin.integration.test.ts`: 24 tests.**
   - cashier refused on all 10 areas
   - settings with ABN normalisation and audit, plus validation
   - opening hours: exactly the changed days audited; invalid weeks refused
   - resource type / resource create with audit, duplicate label 409, unknown type 422
   - base rate before/after audit; retirement refused while a session is open
   - rate band add, overlap refused, other day allowed, edit into overlap refused, toggle, delete audited with reason
   - happy hour add, overlap with the weekday happy hour refused, 100% refused
   - tier benefits and validation; price change + pending Stripe flag + duplicate refused
   - complimentary member whose card scans at the POS; missing contact refused
   - balance ±, overdraw 422, reason required, ledger with actor names
   - card reissue: old 404, new 200
   - member search
   - referral batch of 5 unique codes with audit; value validation; limit-below-uses 422; deactivation audited; usable flag
   - sales list by day via a POS sale on a test clock; partial refund; over-refund 409; void → fully refunded
   - shift list with flagged filter
   - audit viewer shows actor names
4. **Mutation check (admin API):**

   | Injected bug | Result |
   |---|---|
   | Actor header not sent | 5 failures |
   | Reason header not sent | 7 failures |
   | Rate band overlap not validated | 2 failures |
   | Happy hour overlap not validated | 1 failure |
   | Resource retired while in use | 2 failures |
   | Old card kept working | 1 failure |
   | Tier validation skipped | **survived** |

   The first attempt at the tier mutation broke the file's syntax; it was redone properly. The accepted survivor is covered by the DB CHECK (`discount_bp < 10000`), which still returns 422.
5. **Test hygiene:**
   - tier values are now restored in `afterAll` (they were restored in test bodies, where a failing assertion would skip the restore)
   - the "unchanged day not audited" assertion scopes to audit rows written after a marker, so it doesn't depend on earlier runs
   - `finishOpenWork` moved into the shared helpers

### 4b — Back office screens (`apps/pos` `/admin`)

**Done**
- **App restructure:** the sign-in and PIN gate moved into the root layout (`PosShell`), so the floor (`/`) and back office routes share the device session and operator. Superadmins get a "Back office" link on the floor; cashiers who open `/admin` see a refusal screen with Lock.
- **Screens:**

  | Screen | What it does |
  |---|---|
  | Sales | Day picker, totals, receipt reprint, partial refund, void |
  | Shifts | Flagged filter; report dialog reusing the POS report view |
  | Members | Search; complimentary member with a printable QR card (`qrcode.react`); detail with balance, ledger, adjust, reissue card |
  | Referral codes | Batch generate (% or $, uses, expiry); status badges; edit limit, remove expiry, on/off |
  | Rates & happy hours | Base rates with GST shown; resources add/retire; rate bands and happy hours add/toggle; retired items hidden unless "Show retired" |
  | Membership tiers | Benefits and price change with reason |
  | Venue & hours | Business name / ABN / booking rules; opening hours week editor |
  | Staff | Add (email, password, PIN, role); rename, reset PIN, change role, deactivate |
  | Audit log | Entity filter, changed-field summary, expandable before/after JSON, paging |

**Verified**
1. Typecheck, lint (React Compiler rules) and production build pass: 12 routes.
2. **Browser test `e2e/admin.spec.ts`** (real API + DB):
   - owner signs in, PIN, opens the back office
   - generates 2 codes at 15% with 3 uses; formats checked; listed as "0 / 3 · Usable"
   - creates a complimentary Gold member → QR card SVG shown
   - finds the member, adds 45 min → balance "45 min" and "+45 min · Goodwill" in history
   - an overlapping happy hour shows "Overlaps happy hour"
   - business name saved
   - audit log shows the venue_settings update and referral inserts by the owner, with the new name
   - staff list shows the cashier
   - after locking and switching to the cashier: refused screen, no Back office link on the floor
   - **Both e2e tests pass.**
3. **Screenshots reviewed.** Member and audit views look right. The rates page listed every retired type, band and happy hour from test runs, which is unusable. Retired items are now hidden by default.
4. **Full run:**
   - turbo typecheck 4/4, lint, build 3/3
   - tests: pricing 78, API 91, pgTAP 200
   - e2e 2/2
   - **Orders checked:** used DB → pass; fresh DB → pass; API → e2e → DB → pass
5. **Issues found at this stage and fixed:**
   - three seed assertions and one audit count assumed only seed data
   - now scoped to seeded keys, "every tier has price history" and a marker audit id

**Not built yet (tracked)**
- Resource type retire/rename in the UI (the API supports it).
- Tier change / cancel for paid members, Stripe price sync and price-change emails (Phase 5).
- Booking cancellations with refunds (Phase 6).
- Reports (Phase 7).
