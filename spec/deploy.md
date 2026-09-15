# Deploy and go-live runbook

How Raceground goes from this laptop to a live venue system. **Nothing here has been done yet** — this is the plan we follow together, and every hosted resource is created by the owner, not by the developer.

Read it top to bottom once. Then do §3 (accounts), and we do §4–§9 together.

---

## 1. What runs where

| Piece | Where | What it does |
|---|---|---|
| Booking website | Vercel project `raceground-booking` | Public site: book, pay, member accounts |
| POS + back office | Vercel project `raceground-pos` | Staff screens at the counter |
| API | Vercel project `raceground-api` | Every write that touches money; holds all secrets |
| Database, logins, photos | Supabase (hosted project) | Postgres, member and staff logins, website photos |
| Payments | Stripe | Bookings (one-off) and memberships (subscriptions) |
| Email | Resend | Booking confirmations, reminders, cancellations, plus Supabase's own login emails |

Three Vercel projects from one GitHub repository (D55). Vercel bills per team member, not per project.

## 2. Names and addresses (the one place to change them)

Fill this in once. Everything else in this document refers back to it.

| Thing | Value | Used by |
|---|---|---|
| Booking website | `racegrounds.eatzyeats.com` | Customers; `BOOKING_SITE_URL`; Supabase redirect list |
| POS | `pos.racegrounds.eatzyeats.com` | Staff only |
| API | `api.racegrounds.eatzyeats.com` | Both apps; Stripe webhook; cron jobs |
| Email sender | `Raceground <bookings@racegrounds.eatzyeats.com>` | `EMAIL_FROM`; verified in Resend |

**Changing any of these later** means: update the environment variables in Vercel, the redirect list in Supabase Auth, the Resend sending domain, and the Stripe webhook URL. No code changes, no data migration.

> **Spelling:** the brand was settled as **Raceground**, singular (D35). The subdomain above says "racegrounds". Pick one spelling for the URL and the email sender before Resend verification, because changing it afterwards means verifying again.

## 3. Accounts the owner creates (before we can deploy)

| # | What | Notes |
|---|---|---|
| 1 | **GitHub** repository access | The code is committed locally; it needs somewhere to live before Vercel can build it. |
| 2 | **Vercel** account or team | Check the current plan terms: the free Hobby plan is for non-commercial use and limits scheduled jobs (see §7). A business taking payments will most likely need Pro. |
| 3 | **Supabase** project (production, Sydney region if offered) | Keep the database password somewhere safe; it is not recoverable. |
| 4 | **Resend** account + the sending domain verified | Needs DNS records on `eatzyeats.com`. A `.vercel.app` address cannot be verified, which is why the domain matters. |
| 5 | **Stripe** — test mode now, live later | Live mode needs business details, ABN and a payout bank account. |
| 6 | **DNS access** for `eatzyeats.com` | For the subdomains in §2 and the Resend records. |

**What the developer needs back:** the Supabase project URL and its two keys, the Resend API key, and the Stripe keys. Everything is pasted into Vercel's settings, never into the code.

## 4. Vercel project settings

Each project is created from the same repository with a different **Root Directory**. Everything else is already in the repo (`vercel.json` in each app).

| Setting | `raceground-api` | `raceground-pos` | `raceground-booking` |
|---|---|---|---|
| Root Directory | `apps/api` | `apps/pos` | `apps/booking` |
| Include files outside the root directory | **On** (needed: it is a monorepo) | On | On |
| Framework preset | Other | Next.js | Next.js |
| Build command | from `vercel.json` | from `vercel.json` | from `vercel.json` |
| Node version | 22 | 22 | 22 |
| Production branch | `main` | `main` | `main` |

The build commands build the shared packages first (`@raceground/pricing`, `@raceground/db`); they are in each app's `vercel.json` and have been run locally exactly as Vercel will run them.

**Custom domains:** add the three addresses from §2 to their projects. Vercel gives the DNS records to add.

## 5. Environment variables

Set these in each Vercel project (Settings → Environment Variables). Use **Preview** values that point at test mode, and **Production** values for the real thing.

### `raceground-api`

| Name | Production value | Notes |
|---|---|---|
| `SUPABASE_URL` | Supabase project URL | |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase secret key | Server only. Never in a browser app. |
| `OPERATOR_TOKEN_SECRET` | 32+ random characters | `openssl rand -hex 32` |
| `QR_TOKEN_SECRET` | 32+ random characters | **Never change this after launch:** every member card stops working if you do. |
| `CRON_SECRET` | 32+ random characters | Vercel sends it to the scheduled jobs itself. |
| `STRIPE_SECRET_KEY` | `sk_live_…` (test: `sk_test_…`) | |
| `STRIPE_WEBHOOK_SECRET` | `whsec_…` from the endpoint in §6 | |
| `BOOKING_SITE_URL` | `https://racegrounds.eatzyeats.com` | Links in emails and Stripe returns. |
| `CHECKOUT_SUCCESS_URL` | `https://api.racegrounds.eatzyeats.com/checkout/complete` | Counter membership sale. |
| `CHECKOUT_CANCEL_URL` | `https://api.racegrounds.eatzyeats.com/checkout/cancelled` | |
| `CORS_ORIGINS` | `https://racegrounds.eatzyeats.com,https://pos.racegrounds.eatzyeats.com` | Only these browsers may call the API. |
| `EMAIL_TRANSPORT` | `console` until Resend is wired in (Phase 7) | |
| `EMAIL_FROM` | `Raceground <bookings@racegrounds.eatzyeats.com>` | |
| `OPERATOR_IDLE_SECONDS`, `PIN_MAX_ATTEMPTS`, `PIN_LOCK_MINUTES` | defaults are fine | |

`apps/api/.env.example` lists every setting the API reads, and a test fails if the two ever drift apart.

### `raceground-pos` and `raceground-booking`

| Name | Value |
|---|---|
| `NEXT_PUBLIC_API_URL` | `https://api.racegrounds.eatzyeats.com` |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Supabase publishable key (safe in a browser) |

The booking site needs all three; the POS needs all three. **The service-role key never goes in either app.**

## 6. Supabase (hosted) setup

1. **Create the project**, then apply the database: `supabase link` and `supabase db push` from this repo. Every table, rule and function comes from `supabase/migrations/`, including the `venue-photos` storage bucket.
2. **Seed the launch data** (resource types, rates, happy hour, tiers) — `supabase/seed.sql` is applied for a fresh project; we check the values in the back office afterwards.
3. **Auth settings that must be right (D56):**
   - Email confirmation **on**. Without it, anyone could sign up with a member's email and take over their membership.
   - Site URL: `https://racegrounds.eatzyeats.com`
   - Redirect list: `https://racegrounds.eatzyeats.com/**`
   - **SMTP through Resend.** Supabase's built-in email sender is for development and is rate limited; sign-ups and password resets will silently fail without this.
4. **Create the first superadmin** with `pnpm --filter @raceground/api staff:create` pointed at the hosted project, then set their PIN in the back office.
5. **Back up:** turn on point-in-time recovery if the plan offers it.

## 7. Scheduled jobs

Already defined in `apps/api/vercel.json`:

| Job | Schedule (UTC) | Sydney time | What it does |
|---|---|---|---|
| `/cron/reminders` | `0 22 * * *` | 08:00 AEST / 09:00 AEDT | Emails everyone with a booking tomorrow (D54) |
| `/cron/forfeit` | `20 22 * * *` | 08:20 / 09:20 | Forfeits balances of members ended over 30 days |
| `/cron/holds` | `40 22 * * *` | 08:40 / 09:40 | Tidies expired holds (optional: correctness doesn't depend on it) |

- Vercel schedules in **UTC**, so the Sydney time shifts by an hour at daylight saving. That is fine for these jobs.
- **Plan limits:** check the current Vercel limits on the number of cron jobs and how often they may run. If the plan allows only two, drop `/cron/holds` — expired holds are also cleaned up whenever anyone books.
- Vercel calls these with a GET and adds `Authorization: Bearer CRON_SECRET` itself. The API accepts GET and POST, and every job is safe to run twice.

## 8. Stripe setup

1. **Webhook endpoint:** `https://api.racegrounds.eatzyeats.com/webhooks/stripe`, with these events:
   `checkout.session.completed`, `checkout.session.expired`, `invoice.paid`, `invoice.payment_failed`,
   `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `charge.refunded`.
   Copy its signing secret into `STRIPE_WEBHOOK_SECRET`.
2. **Sync the tiers:** back office → Membership tiers → **Sync with Stripe**. This creates the products and prices. Do it once per Stripe mode (test and live are separate worlds).
3. **Customer Portal:** created automatically by the API the first time a member opens it (card, invoices, cancel at period end; no plan switching).
4. **Business details** on the Stripe account: legal name and ABN, so invoices are valid tax invoices.
5. **Smart Retries** on, with Stripe's failed-payment emails on.

## 9. Go-live order

Do this in order. Each step is checked before the next.

1. Push the repository to GitHub.
2. Create the Supabase production project and apply the database (§6).
3. Create the three Vercel projects with **test-mode Stripe keys** and preview domains. Deploy.
4. Check on the real deployment: open the booking site, make a booking with a Stripe **test card**, confirm the email arrives, cancel it and see the refund. Sign in to the POS and open a till.
5. Point the custom domains at the projects and update `BOOKING_SITE_URL`, `CORS_ORIGINS` and the Supabase redirect list to match.
6. Set up Resend, verify the domain, and switch Supabase SMTP and the API's email transport over. Send a test of each email.
7. Enter the real venue details in the back office: business name, ABN, address, phone, contact email, intro, photos, opening hours, rates and tiers.
8. Activate Stripe live mode. Swap `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` (a live-mode endpoint has its own secret), and re-run the tier sync in live mode.
9. **One real payment**, with a real card, for a small booking. Refund it. Check the money in the Stripe dashboard.
10. Train the staff on the POS, then open bookings to the public.

## 10. After go-live

- **Rolling back:** Vercel keeps every deployment. A bad release is undone by promoting the previous one, which takes seconds. Database changes are not undone this way, which is why migrations are additive.
- **Watch for:** failed Stripe webhooks (Stripe's dashboard shows retries), emails not sending (Resend dashboard), and the audit log in the back office.
- **Never change after launch:** `QR_TOKEN_SECRET` (every member card dies), and email confirmation must stay on.
- **Costs to expect:** Vercel plan, Supabase plan, Resend plan, plus Stripe's fee on each payment. Confirm current prices when signing up — they change.

## 11. Not covered yet

Reports (revenue, usage, membership, free play), real email templates through Resend, and the final legal wording for the terms and privacy pages. All Phase 7, none of them block a deploy in test mode.
