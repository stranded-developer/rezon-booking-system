# Phase 6c-3 — Members on the booking website

**Date:** 2026-09-15
**Decisions:** [D56](../decisions/06-2026-09-15-booking-site-accounts.md) confirmed-email linking · [D57](../decisions/06-2026-09-15-booking-site-accounts.md) re-showable QR · [D60](../decisions/07-2026-09-15-booking-website.md) joining online is account first.

**Done**

**Accounts in the browser.** Supabase Auth (email + password) in `apps/booking`, with every API call carrying the member's token. The site never decides a discount itself: it shows what the API returns.

| Page | What a member can do |
|---|---|
| `/signup` | Create an account (name, email, optional phone, password), then confirm by email |
| `/login` | Log in; a login before confirming says so plainly |
| `/forgot-password`, `/reset-password` | Ask for a link and set a new password |
| `/account` | Membership (number, status, renewal, discount), free-play balance and history, member QR with "get a new code", bookings with cancel, tier change, cancel/resume, and the Stripe portal for card and invoices |
| `/membership` | Compare tiers and join online |

**In the booking flow**
- A signed-in active member sees "Gold member · 10% off" and their discount in the price.
- **Free play is offered up to `min(balance, length booked)` and defaults to none.** Minutes are only spent when the member chooses an amount.
- The referral field is hidden for members (a membership and a code never combine).
- A signed-in customer without an active membership books with their account details, and the API's notice explains that member pricing doesn't apply.
- Guests are unchanged: no account needed to book.

**Joining online (D60)**: pick a tier → sign up and confirm → Stripe Checkout (subscription) → back to the account, which shows the membership as soon as Stripe's webhook lands.

**Spec updated:** `booking-site.md` §7 (member area), `membership.md` §6.

**Verified**
1. **`e2e/member.spec.ts` (2), no Stripe needed:**
   - **A counter-sold member joins the website (D56):** signs up with the email the venue holds; logging in before confirming is refused; the confirmation link signs them in; the account then shows their Gold membership, member number, 60 free minutes and their QR (D57).
   - Books an hour with the member discount ($27.00 instead of $30.00), sees the referral field hidden, spends 30 free minutes ($13.50), and the database shows the hold took exactly 30 minutes. Releasing the hold puts the 60 minutes back on the account page.
   - **Password reset:** asks for a link, opens it from the local mail catcher, sets a new password, and logs in with it.
2. **`e2e/member-stripe.spec.ts` (1), real Stripe test mode:** "Join Silver" with no account sends them to sign up first (D60); after confirming, Stripe Checkout takes a real card payment; the account then shows Silver, active, 5% off, 60 free minutes and a QR, with the database holding a real `sub_…` subscription and `cus_…` customer. Cancelling at period end and resuming both work through the account. The test syncs the tier catalogue with Stripe itself, so it doesn't depend on the POS tests running first.
3. **Mutation check, 7 deliberate breaks, 7 killed:** member not recognised by the API (token dropped), free minutes not sent with the booking, free minutes spent without asking, referral field shown to members, sign-up forgets the name and phone, account hides the member QR, password reset link points elsewhere.
4. The whole booking-site suite (7 tests) ran **twice in a row on the used local database: 7 passed both times**.
5. **Gate** (clean `db reset`, same command as the commit): pgTAP 372 · turbo 11/11 (pricing 78, API 161) · POS e2e 4 passed · booking e2e 7 passed, both suites including their real-Stripe test.

**Issues found and fixed**
1. **Free minutes were spent by default.** The first version pre-selected the largest amount, so a member booking an hour silently spent their whole balance — the test caught it as a $0.00 total. Spending someone's balance without being asked is worse than not spending it, so the default is now none.
2. **The login page redirected during render**, which made the form vanish under the customer (and under the test) when the confirmation link arrived with a session. Moved into an effect.
3. Lint caught two more real React problems: state set inside an effect in the account provider, and a `window.location.href` assignment; both fixed (derived state, `location.assign`).
4. Test-only: the confirmation link signs people in, so the test no longer insists on a separate login step; the ledger fixture needed a Stripe invoice id, as the database requires for a grant.
5. **Auth emails hit a rate limit.** Local Supabase allows only **2 auth emails an hour** by default, so the password-reset test failed in a full run after the sign-up emails. Raised to 30 for local development (`supabase/config.toml`). **This matters for go-live:** Supabase's own email service is rate limited and meant for development, so the hosted project must send auth emails through Resend SMTP before real customers sign up.

**Not built yet**
- **Go-live:** the hosted Supabase project needs Resend SMTP for auth emails (its built-in sender is rate limited), email confirmation left on, and the booking site's URL in the auth redirect list.
- **Back office Bookings page (6c-4):** the API is there since 6b-2, the POS screen is not.
- Real emails (Resend) and the final legal wording, both Phase 7.
