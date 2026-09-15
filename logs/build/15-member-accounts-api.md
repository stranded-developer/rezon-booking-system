# Phase 6b-2 — Member accounts API, online membership, reminders, back office booking cancel

**Date:** 2026-09-15
**Decisions:** [D54–D57](../decisions/06-2026-09-15-booking-site-accounts.md): daily reminders, three Vercel projects, confirmed-email linking, re-showable member QR.

**Done**

**Database** (migration `20260915001400_member_accounts.sql`)
- `member_link_account(auth user, email, name, phone)`:
  - links a login to the oldest unlinked customer with the same email (any case), or creates one
  - refuses staff logins, and emails already linked to another login
  - audited
- `members.qr_version` + trigger: moves on whenever `qr_token_hash` changes (not when the same hash is written again), and can't be set directly.
- Local Supabase: **email confirmation on**, site URL `http://localhost:3000`, redirect URLs for the booking site.

**API**

| Area | What |
|---|---|
| Login (`middleware/account.ts`) | Supabase JWT → customer. First use links the account, **only if Supabase shows the email confirmed**. Staff logins refused (`staff_account`). |
| Member pricing | `/public/quote` and `/bookings/hold` accept an optional login. Active/cancelling members get their discount and can use free minutes (no form needed). Lapsed members are priced as guests with a `memberNotice`, and their account details fill the booking. Member + referral refused. |
| `GET /me` | Customer, membership (tier, pending tier, status, renewal, balance, billed online), member QR. An active member without a card gets one here. |
| `GET /me/ledger`, `GET /me/bookings`, `GET /me/bookings/:ref`, `POST /me/bookings/:ref/cancel` | Balance history; the customer's own bookings only (others → 404); cancel from the account with the same refund rules |
| `POST /me/qr/reissue` | New QR, old ones stop (active/cancelling only) |
| `POST /me/membership/checkout` | Online sign-up: Stripe subscription Checkout returning to `/account` (Adaptive Pricing off) |
| `POST /me/membership/tier`, `/cancel`, `/resume` | Same Stripe flows as the back office; venue-managed (complimentary) members are sent to the counter |
| `POST /me/portal` | Stripe Customer Portal with our settings, created once: card update, invoices, cancel at period end, **no plan switching** |
| `POST /cron/reminders` | D54: emails tomorrow's confirmed bookings once each |
| `GET /admin/bookings?date&q`, `GET /admin/bookings/:id`, `GET /admin/bookings/:id/cancel-quote`, `POST /admin/bookings/:id/cancel` | Superadmin: a venue day's bookings with customer, member no and payment; cancel with a reason, as venue fault (full refund + minutes, any time) or with a set refund amount; real Stripe refund; customer emailed with the reason |

**Other changes**
- Member QR tokens are derived (`lib/qr.ts`), in the POS first card, back office complimentary member and back office reissue.
- **Print card** prints the member's existing QR instead of failing.
- One shared `cancelBooking` for customers, members and staff.
- Welcome email points to the account page.
- New required env `QR_TOKEN_SECRET`, generated into the git-ignored `apps/api/.env.local`.
- **Spec updated:** `membership.md` §6, `architecture.md` §4–5, `booking-site.md` emails.

**Verified**
1. **pgTAP `10_member_accounts` (17):**
   - linking: any case, oldest first, already linked, conflict, staff refused, new customer from sign-up details, audit
   - QR version: bumps, the same hash doesn't bump, can't be set directly, reissue without staff
   - privileges

   Full pgTAP **353/353**.
2. **`test/account.integration.test.ts`, 18 tests** (local DB, fixed clock Mon 4 Mar 2030, own resource type):
   - login required; bad token; staff refused
   - **unconfirmed email is not linked**: the test un-confirms the user in the database and gets `email_unconfirmed`, with no customer created
   - new account created from sign-up details
   - counter-sold member linked by email in a different case
   - QR stable across loads, scans at the POS, the cashier's Print card prints the same QR, reissue makes the old QR fail at the POS
   - member quote 10% off ($36.00), 30 free minutes ($18.00), referral refused, balance limit
   - free-play booking with no form and no payment, shown in the account and ledger
   - another account can't see or cancel it
   - account cancel returns minutes
   - lapsed member: guest price, no QR, can't reissue, booking filled from account details
   - venue-managed member sent to the counter for billing changes
   - reminders: only tomorrow's confirmed booking (not a cancelled one, not the day after), sent once across two runs, cron secret required
   - back office list, search and date filter; cashier forbidden; under 2 h needs venue fault or a set refund, reason required, refund can't exceed paid
   - venue-fault cancel returns minutes, emails the reason, audits the actor
3. **`test/account-stripe.integration.test.ts`, 4 tests, real Stripe test mode:**
   - online Silver sign-up (real Checkout: subscription, returns to `/account`, AUD only)
   - activation from a real subscription + real paid invoice delivered signed: active, 60 min, QR, welcome email with the account link
   - Customer Portal session (real URL; settings created once, with plan switching off)
   - tier change to Gold from the account (Stripe price switched, pending tier shown)
   - cancel and resume (Stripe `cancel_at_period_end` true → false)
4. **`bookings-stripe` +1:** staff venue-fault cancel an hour before a paid booking made a real Stripe refund of the full amount, recorded with actor and reason.
5. **Unit +2:**
   - QR token derivation: per member, version and secret; mismatch shows no QR
   - calendar invite escaping and line folding
   - env test now requires `QR_TOKEN_SECRET`
6. **Mutation check, 22 deliberate breaks** across login, pricing, QR, cards, billing, bookings, reminders, back office and the portal.
   - **21 killed.** The survivor, "staff under 2 h without venue fault or refund", is also refused by the database (`booking_cancel` raises `too_late`). It's a duplicate check, accepted like earlier ones.
   - "Reissue for an inactive member" survived at first; a test was added and it is now killed.
7. The three account/booking suites ran twice back to back on the used local database: **45/45 both times**.
8. **Gate** (clean `db reset`, same command as the commit):
   - pgTAP 353
   - turbo typecheck/lint/test 9/9 (pricing 78, API 150)
   - POS build + e2e 3 passed, 1 skipped (real-Stripe e2e needs `stripe listen`)

**Issues found and fixed**
1. **Real bug: online membership sign-up failed** with "Database error". The existing checkout passed `p_staff: undefined` when there's no cashier. supabase-js drops undefined arguments, so PostgREST looked for a function without `p_staff`. The counter always has a cashier, so it never showed until online sign-up. It now sends `null`.
2. **A test polluted Stripe test data during mutation testing.** The "portal settings recreated" mutation left extra configurations, which broke later runs of the "created once" test. That made four mutation results unreliable, so they were re-run after the fix.
   - The test now clears our marker from existing configurations first. Stripe refuses to deactivate the account's default configuration, hence clearing the marker rather than deactivating.
3. The env unit test had no `QR_TOKEN_SECRET` (new required setting); it was updated and now also checks the setting is required.

**Not built yet**
- **Back office bookings page (UI)** for the new admin booking endpoints. Planned with the website (6c).
- **Booking website (6c):** timetable, booking flow, login/sign-up/forgot password, account page, cancel page, browser tests with a real Stripe payment.
- **Go-live setup:**
  - hosted Supabase must keep email confirmation on
  - schedule `/cron/reminders` (~09:00 Sydney) and `/cron/forfeit` daily
  - set `QR_TOKEN_SECRET` and `BOOKING_SITE_URL`
