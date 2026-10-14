# Step 54 — Sign-up with an existing account; switching Stripe accounts

**Date:** 2026-10-13 – 14
**Decisions:** [D103](../decisions/14-2026-10-13-explore-wording-happy-hour.md).

**Done**

- **Sign-up with an email that already has an account** (`apps/booking/src/components/auth-forms.tsx`): Supabase either refuses it ("User already registered", shown word for word before) or answers as if it worked and sends nothing (an account with no identities), and the page then said "We've sent a confirmation link". Both now show "There's already an account with <email>. Log in, or reset your password if you've forgotten it." with both links.
- **Switching to a new Stripe account** (owner, live): `supabase/one-off/unlink-old-stripe-account.sql`, run once by the owner in the Supabase SQL editor because the old account held only sandbox data. It ends memberships billed by the old account, clears every customer's Stripe customer id, clears the tiers' product and price ids and the price history's, then lists upcoming bookings paid on the old account (to cancel with a $0 refund). "Sync with Stripe" then recreates the tiers in the new account. Not a migration: it is data, run once.
- **`staff:create`** (`apps/api/scripts/create-staff.ts`): its own usage note said `staff:create -- --email …`, which the script refused ("Unexpected argument '--email'"). It now ignores a leading `--`, and the note shows the command without it. The owner created the live superadmin with it.

**Verified**

1. Browser test (member sign-up): after the counter member confirms their account, signing up again with the same email in a fresh browser shows the "already an account" message with the reset link, and not "We've sent a confirmation link".
2. The one-off script, run on the local database inside a transaction and rolled back: no errors; it unlinked 18 customers, ended 24 sandbox memberships and reset 3 tiers; the final list ran.
3. `staff:create -- --email x` reaches the script's own usage check instead of crashing.
4. **Gate:** see the commit for this step.

**Found on the live site while moving to racegrounds.au (owner's settings, no code)**

- `/book` failed on `www.racegrounds.au`: the API's `CORS_ORIGINS` listed only the old `eatzyeats.com` addresses. The owner set it to the new addresses and redeployed; checked from outside that `www.racegrounds.au`, `racegrounds.au` and `pos.racegrounds.au` are allowed. The old addresses no longer are.
- Email sends from `bookings@racegrounds.eatzyeats.com` (Resend, verified on that subdomain); its DNS is intact, so the move to racegrounds.au doesn't affect sending.
- The owner pasted the live Supabase secret key into the chat; advised to replace it (new key in Supabase and in Vercel's `SUPABASE_SERVICE_ROLE_KEY`, then redeploy).
