# Raceground — Product & Technical Spec

**Status:** v1.0, 2026-09-14. This is the **source of truth** for what we build.
- Decisions that led here are in [`logs/decisions/`](../logs/README.md#decisions); the build history is in [`logs/build/`](../logs/README.md#build-steps-in-the-order-they-were-done).
- If the spec and a log disagree, **the spec wins**. Any change to a rule is made here and noted in a new log.

## What Raceground is

A gaming venue in Sydney that rents time on billiard tables and driving simulators (six standard rigs and two VR rigs). The platform has three parts:

| App | Who uses it | URL (for now) |
|---|---|---|
| **Booking site** | Public: book and pay online, tournaments, member sign-up and account | `raceground.vercel.app` |
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
| Opening hours | Mon–Thu 12:00–22:00 · Fri 12:00–24:00 · Sat 11:00–24:00 · Sun 11:00–22:00 (D73). Midnight is stored as `24:00`. |
| Billiard tables | 2 × $25/hr incl. GST, $20/hr in happy hour |
| Driving simulators | 8 × $60/hr incl. GST: Sim 1–6 and VR Sim 1–2. **The VR rigs are simulators at the same price**, not a type of their own (D77) |
| Session | 30 min (D63). Booked online: whole sessions only (30, 60, 90 …), starting on :00 or :30 (D90). Walk-in: from 15 min, then charged in 15-minute blocks rounded up (D91) |
| Experiences (simulators, online) | **Single Session** 30 min $35 ("Quick Race, Time trial, Drift, and more.") · **Double Session** 60 min $58 ("Full Experience, Double Race, Drift, Free Roam, and more") · Leaderboard Challenge 30 min $35, in that order (D65, D78, D83) |
| Member prices (experiences) | Silver $32 / $52 · Gold $28 / $46 · Diamond $28 / $46 (Single / Double). Flat, never stacked with a promotion: the cheapest single price wins (D82). Leaderboard Challenge: the tier's percentage |
| Experience promotions | Happy Hour every day 12:00–15:00: $29 / $29 / $49 · Student, any time on request: $32 / $32 / $52. The cheapest match wins (D66) |
| Happy hour | **12:00–15:00, every day**, as a **flat price everywhere** (D74). Hourly types use a rate band; experiences use a promotional price. There is no percentage happy hour. |
| Tiers | Silver 10% $48/mo · Gold 20% $78/mo · Diamond 20% $128/mo (incl. GST). Perks worded as the membership poster (D84); Diamond gets one free tournament entry a month |
| Arrive early | 15 minutes before the session; the session still runs on the booked time (D85) |
| Free play | Silver 2 sessions, Gold 4, Diamond 8 per month; rolls over, capped at ten months (600 / 1200 / 2400 min) |
| Games, tracks & cars | Assetto Corsa Competizione, Assetto Corsa, F1 25, each with its tracks and cars — a starting list for the owner to edit (D80) |
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
| 8 | Public site rebuilt to the owner's reference: experiences, tournaments, events, new look | Stripe |

Progress is tracked in [`logs/README.md`](../logs/README.md), one file per build step.

## Go-live prerequisites (not blocking development)

- Business/trading name + ABN, needed for tax invoices and Stripe live mode
- Stripe AU account activation (business details + payout bank account)
- Supabase hosted project (production)
- Resend account + a verified sending domain. `.vercel.app` can't be verified for email, so a custom domain is needed before real customer email.
- **Vercel plan:** the free Hobby plan is for non-commercial use and limits cron jobs to once a day. A live business will most likely need **Vercel Pro**. Confirm current terms before launch.
