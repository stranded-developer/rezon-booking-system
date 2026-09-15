# Raceground — Product & Technical Spec

**Status:** v1.0, 2026-09-14. This is the **source of truth** for what we build.
- Decisions that led here are in [`logs/decisions/`](../logs/README.md#decisions); the build history is in [`logs/build/`](../logs/README.md#build-steps-in-the-order-they-were-done).
- If the spec and a log disagree, **the spec wins**. Any change to a rule is made here and noted in a new log.

## What Raceground is

A gaming venue in Sydney that rents time on billiard tables, driving simulators and VR seats. The platform has three parts:

| App | Who uses it | URL (for now) |
|---|---|---|
| **Booking site** | Public: book and pay online, member sign-up and account | `raceground.vercel.app` |
| **POS + back office** | Staff: run the floor, take payments, manage everything | `raceground-pos.vercel.app` |
| **API** | Both apps. Owns every write that touches money. | `raceground-api.vercel.app` |

## Spec documents

| File | Covers |
|---|---|
| [pricing.md](./pricing.md) | The pricing engine contract: algorithm, rounding, DST, test cases |
| [data-model.md](./data-model.md) | Database tables, constraints, launch seed data |
| [pos.md](./pos.md) | POS: floor, sessions, payments, shifts, staff PINs, overrides |
| [back-office.md](./back-office.md) | Superadmin settings, reports, audit |
| [membership.md](./membership.md) | Tiers, Stripe subscriptions, free-play balance, QR |
| [booking-site.md](./booking-site.md) | Public booking flow, checkout, cancellations, policies |
| [architecture.md](./architecture.md) | Stack, repo layout, auth, security rules, hosting, jobs, emails |
| [deploy.md](./deploy.md) | Go-live runbook: accounts, Vercel projects, environment variables, Supabase, Stripe, scheduled jobs |

## Launch configuration at a glance

All values below are **editable in the back office**. None are hardcoded.

| Setting | Launch value |
|---|---|
| Timezone | `Australia/Sydney` |
| Opening hours | 10:00–21:00, every day |
| Billiard tables | 2 × $30/hr incl. GST |
| Driving simulators | 6 × $60/hr incl. GST |
| VR seats | 2 × $50/hr incl. GST |
| Minimum session | 15 min, then per minute (partial minutes round up) |
| Happy hour | Mon–Fri 10:00–15:00, 10% off, all resource types |
| Tiers | Silver 5% $100/mo · Gold 10% $200/mo · Diamond 15% $300/mo (incl. GST) |
| Free play | 60 min/month per tier, rolls over, capped at 600 min |
| Booking window | Rolling 7 days |
| Online booking cutoff | Must start ≥ 30 min from now |
| No-show hold | 15 min after start |
| Staff | 1 superadmin, 1 cashier |

## Core business rules (summary)

1. **Stacking:** happy hour + membership stacks, and happy hour + referral stacks. **Membership and referral never combine.** A member never sees the referral field.
2. **Math is multiplicative:** happy hour changes the rate, then the membership % or referral (% or fixed $) applies to the subtotal. No discount cap.
3. **Free-play minutes** cover the **first** minutes of a session, before any pricing.
4. **One engine** (`packages/pricing`) prices every quote, booking and POS close. Booked sessions are prepaid and never charged for running over (D48).
5. **Every change to money or rules** is written to the audit log with actor, before and after.

## Build phases

| Phase | Deliverable | External dependency |
|---|---|---|
| 0 | Spec (this) | — |
| 1a | Monorepo scaffold, shared config, test runner | — |
| 2 | Pricing engine + exhaustive tests | — |
| 1b | Database schema, constraints, seed, RLS | Docker (local Supabase) → hosted Supabase project |
| 1c | API skeleton, staff auth, PIN, audit | Supabase |
| 3 | POS MVP + shifts | Supabase |
| 4 | Back office | Supabase |
| 5 | Membership, Stripe Billing, QR, balance | Stripe (test mode), Resend |
| 6 | Booking site, Stripe Checkout, cancellations | Stripe, Resend |
| 7 | Reports, hardening, deploy, launch | Vercel, GitHub, ABN + Stripe live activation |

Progress is tracked in [`logs/README.md`](../logs/README.md), one file per build step.

## Go-live prerequisites (not blocking development)

- Business/trading name + ABN, needed for tax invoices and Stripe live mode
- Stripe AU account activation (business details + payout bank account)
- Supabase hosted project (production)
- Resend account + a verified sending domain. `.vercel.app` can't be verified for email, so a custom domain is needed before real customer email.
- **Vercel plan:** the free Hobby plan is for non-commercial use and limits cron jobs to once a day. A live business will most likely need **Vercel Pro**. Confirm current terms before launch.
