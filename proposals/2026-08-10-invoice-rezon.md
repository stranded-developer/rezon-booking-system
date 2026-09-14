# INVOICE / PROPOSAL

**Rezon Gaming Hall — Booking System & Point of Sale Platform**

| | |
|---|---|
| **Invoice No.** | REZ-2026-002 |
| **Date Issued** | 10 August 2026 |
| **Payment Due** | 24 August 2026 (14 days) |
| **Currency** | IDR (Rp) |

**From**
[Your Business Name]
[Address]
[NPWP / ABN]
[Email] · [Phone]

**Billed To**
[Client Name]
Rezon Gaming Hall
[Address]

---

## Summary

| | Amount |
|---|---|
| **Option A — Core Platform** | **Rp 27,000,000** |
| Optional Module 1 — Recurring Subscription Billing Control | Rp 3,000,000 |
| Optional Module 2 — Dynamic Promotions & Rules Engine | Rp 3,000,000 |
| **Option B — Core Platform + Both Modules (recommended)** | **Rp 33,000,000** |

Both optional modules are **genuinely optional**. The platform is complete, launchable, and fully operational at Rp 27,000,000. The modules add owner-side control over things that would otherwise require a developer to change.

---

# SECTION A — CORE PLATFORM

**Rp 27,000,000**

A complete, production-ready booking and point-of-sale platform across two web applications, sharing one database and one pricing engine.

| # | Deliverable | Amount |
|---|---|---|
| A1 | **Architecture, Database & Infrastructure**<br>Monorepo setup; PostgreSQL schema design; database-level double-booking prevention via time-range exclusion constraints; row-level security policies; staff authentication with Admin/Cashier role separation and per-staff PIN attribution; three production environments with automated deployment pipelines; backup and recovery configuration. | Rp 4,000,000 |
| A2 | **Time-Based Billing Engine**<br>The core calculation engine shared by both applications. Per-minute billing with 1-hour minimum charge; automatic session splitting across rate-band and happy-hour boundaries so a session spanning multiple price periods is charged correctly per segment; full `Australia/Sydney` timezone and daylight-saving handling including both annual transition dates; GST-inclusive calculation; itemised price breakdown generated for every receipt and confirmation. Exhaustive automated test suite. | Rp 4,500,000 |
| A3 | **Point of Sale Terminal**<br>Secure staff login with role enforcement; live floor view of all tables and simulators; open/close table with real-time running timers synchronised across multiple terminals; automatic charge calculation on close; tender recording (cash / card / EFTPOS reference); receipt generation with print and email delivery; supervised manual price override with mandatory reason and audit capture. | Rp 5,000,000 |
| A4 | **Cash Shift & Drawer Reconciliation**<br>Shift open with declared opening float; cash-in / cash-out movement logging with reasons; shift close with system-calculated expected cash versus counted actual and automatic variance detection; per-staff shift report covering session count, gross revenue, discount breakdown and tender split; configurable variance threshold flagging for owner review. | Rp 2,000,000 |
| A5 | **Back Office — Core Administration**<br>Rate plan and rate band management (per resource type, per day, per time window); resource management so new tables or simulators are added as configuration rather than code changes; staff account and role administration; complete audit log of every rate change, override, void and refund with before/after values, actor and timestamp. | Rp 3,000,000 |
| A6 | **Membership System & QR Cards**<br>Three-tier membership (Silver / Gold / Platinum) with configurable discount rates and pricing; member record management and membership number issuance; secure QR membership cards using non-forgeable opaque tokens resolved server-side on scan, so a card cannot be duplicated or altered to grant a higher tier; revocation and reissue for lost cards; POS scan-to-apply discount; membership validity, expiry and renewal reminder emails. | Rp 3,500,000 |
| A7 | **Public Booking Website & Online Payments**<br>Public availability timetable per resource; slot and duration selection with live price quotation using the same engine as the POS; discount entry at checkout; temporary slot holds during checkout to prevent two customers paying for the same slot; Stripe payment integration with full payment on booking; automated confirmation emails with calendar invite; 24-hour reminder emails; cancellation and refund processing; arrival handoff so booked customers are opened at the POS without being charged twice. | Rp 4,000,000 |
| A8 | **Reporting, Testing, Launch & Handover**<br>Revenue reporting by day, resource and discount type; utilisation reporting; membership and referral performance reporting; concurrency and edge-case testing; error monitoring and uptime alerting; staff training session and written operating runbook. | Rp 1,000,000 |
| | **Section A Total** | **Rp 27,000,000** |

---

# SECTION B — OPTIONAL MODULES

**Rp 6,000,000 for both**

Each module below can be declined without affecting delivery of the core platform. What each one buys is **owner-side control without developer involvement** — the ability to change commercial rules yourself, at any time, without paying for a change request and waiting for a deployment.

---

## Module 1 — Recurring Subscription Billing Control Suite

### Rp 3,000,000

**What you get:** full owner control over recurring annual membership billing — pricing, renewals, upgrades, pauses, comps and refunds — managed entirely from the back office.

### Why this costs what it does

This module is not a settings screen. It is a **synchronisation problem between two independent financial systems** — your database and the payment gateway — which must agree about money, continuously, over a period of years, without human supervision.

The engineering scope:

**Subscription lifecycle state machine.** A membership is not simply "active" or "expired." It moves through `pending → active → past_due → grace_period → lapsed → cancelled`, with legitimate transitions in both directions (a lapsed member who pays is reinstated; a refunded member is reversed). Each transition has downstream consequences — QR card validity, discount eligibility at the POS, and email notifications. Every path must be implemented and tested, including the ones that occur rarely.

**Webhook ingestion with idempotency guarantees.** The payment gateway notifies our system of events (payment succeeded, payment failed, card expired, subscription cancelled) by calling our servers. These notifications are **retried on failure and are not guaranteed to arrive in order**. Without idempotency protection, a single retried payment notification would extend a customer's membership twice, or charge them twice. We implement signature verification, deduplication keys, and out-of-order event reconciliation so that the same event arriving five times produces exactly one result.

**Scheduled background jobs (cron infrastructure).** Time-based transitions have no user action to trigger them — nobody clicks a button when a membership expires at midnight. This requires scheduled server processes running independently of the applications: a nightly expiry sweep, renewal reminder dispatch at 30 / 7 / 1 days before expiry, grace-period expiry enforcement, failed-payment retry orchestration, and a drift-detection job that compares our records against the gateway's records and reports discrepancies. Each job must be safely re-runnable, must not double-process if it overlaps with the previous run, and must be monitored so a silent failure is detected rather than discovered months later in the accounts.

**Dunning (failed payment recovery).** When a renewal payment fails — expired card, insufficient funds — the customer is not immediately cut off. A retry schedule is attempted over a defined window, with a coordinated email sequence, and a defined outcome if recovery fails. This directly determines how much recurring revenue you retain.

**Proration on mid-term tier changes.** A Silver member upgrading to Platinum four months into their year is owed credit for unused time. Calculating, applying and recording that correctly — in both systems — is required for the upgrade to be safe to offer at all.

**Back office control surface.** Change tier pricing, change billing interval, pause a membership, issue a complimentary membership, manually extend validity, force an early renewal, or issue a refund. Every one of these must reconcile local state with gateway state and record an audit entry, because each is a financial transaction.

**Reconciliation reporting.** A report showing where your records and the gateway's records disagree, so drift is caught in days rather than at end of financial year.

**Compliance.** Card data never touches our servers — payment capture is gateway-hosted, keeping PCI compliance at the lowest possible obligation tier.

> **In short:** the visible part is a settings page. The cost is in the invisible part — the failure paths, the retries, the scheduled jobs, and the guarantee that no customer is ever double-charged and no membership silently expires unnoticed. Roughly 70% of the work here is handling what happens when something goes wrong.

---

## Module 2 — Dynamic Promotions & Rules Engine

### Rp 3,000,000

**What you get:** the ability to invent, launch, modify and retire any promotional structure yourself — referral codes, happy hours, discount stacking behaviour — with no developer involvement and no deployment.

### Why this costs what it does

The distinction that drives this price: **a fixed rule is cheap; a rule the owner can safely change is not.**

Hardcoding "happy hour is 20% off, 6–7pm weekdays" is roughly an hour of work. Building a system where you can define *any* happy hour, at any time, on any resource, and have the billing engine price it correctly and provably in every case — including the cases you have not thought of yet — is a different category of work entirely.

The engineering scope:

**Referral code engine.** Individual and bulk code generation; per-code discount type (percentage, fixed amount, or outright rate override); usage caps with **atomic enforcement under concurrent access** — meaning if a code limited to 50 uses is redeemed simultaneously at the POS and on the website at the exact same moment, database-level row locking guarantees it cannot exceed 50; validity date windows; per-customer redemption limits; instant deactivation. A full redemption ledger records who used which code, when, and on what transaction.

**Happy hour engine.** Unlimited configurable windows; different windows per resource type, so billiard tables and driving simulators can run entirely separate promotions; per-day-of-week scheduling; **overlapping-window precedence resolution** for when two promotions apply to the same moment; and daylight-saving-safe evaluation so a 6pm happy hour remains at 6pm across both annual clock changes rather than silently shifting by an hour twice a year.

**Cross-boundary session pricing.** A customer who starts at 5:45pm and finishes at 7:15pm has played across three different price periods. The engine splits the session at every boundary and prices each segment independently — the alternative is systematically overcharging or undercharging every session that crosses a promotional edge.

**Configurable stacking mode.** Selectable in the back office between **multiplicative** and **additive** discount combination — these produce materially different totals, and the choice becomes yours rather than fixed at build time. Accompanied by a configurable **exclusivity matrix** determining which discount types may combine (currently: happy hour combines with membership; happy hour combines with referral; membership and referral do not combine), precedence rules for conflicts, and a maximum-discount floor that prevents any combination of rules from discounting below a level you set.

**Rules-as-data architecture.** The commercial rule set is stored as validated configuration rather than written into the program. This is the single most expensive element, and it is what makes everything above possible without a developer. It requires a validation schema that rejects impossible or self-contradictory rules before they can be saved, a versioned rule history, and a rollback path.

**Rule simulator.** Before publishing a change, the back office can test it: *"what would a two-hour Gold-member session starting Saturday at 7pm cost under these new rules?"* — with a full itemised breakdown. This prevents discovering a pricing mistake through a week of undercharged customers.

**Test matrix.** Every rule made configurable multiplies the number of combinations that must be verified. Making stacking mode, exclusivity, precedence, caps, windows and code types all owner-editable produces a large combinatorial test surface, and every path is covered by automated tests before release.

> **In short:** you are not paying for a discount feature — the core platform already applies discounts. You are paying for the guarantee that **you** can change the commercial rules whenever you want, that the system will refuse to accept a rule that would lose you money, and that every combination has been proven correct in advance.

---

# PAYMENT SUMMARY

### Option A — Core Platform

| | Amount |
|---|---|
| Total Project Value | Rp 27,000,000 |
| Less: Deposit received (50%) | – Rp 13,500,000 |
| **Balance Outstanding** | **Rp 13,500,000** |

### Option B — Core Platform + Both Optional Modules *(recommended)*

| | Amount |
|---|---|
| Core Platform | Rp 27,000,000 |
| Module 1 — Recurring Subscription Billing Control | Rp 3,000,000 |
| Module 2 — Dynamic Promotions & Rules Engine | Rp 3,000,000 |
| **Total Project Value** | **Rp 33,000,000** |
| Less: Deposit received (paid) | – Rp 13,500,000 |
| **Balance Outstanding** | **Rp 19,500,000** |

### Proposed payment schedule for the balance

| Milestone | Trigger | Option A | Option B |
|---|---|---|---|
| ✅ Deposit | Paid | Rp 13,500,000 | Rp 13,500,000 |
| Milestone 2 | POS system delivered and operational in venue | Rp 6,750,000 | Rp 9,750,000 |
| Milestone 3 | Booking website live and final handover complete | Rp 6,750,000 | Rp 9,750,000 |

**Payment details**
Bank: [Bank Name]
Account Name: [Account Name]
Account Number: [Account Number]
Reference: REZ-2026-002

---

## Notes & Terms

1. **The optional modules may be added later**, but doing so costs more than including them now — the rules-as-data architecture in Module 2 in particular is substantially cheaper to build into the pricing engine from the start than to retrofit around a completed one. If budget is the constraint, Module 2 is the one to prioritise.
2. Third-party running costs are **not included** and are billed directly to the client by the providers: payment gateway transaction fees, hosting, database, domain registration, and transactional email service.
3. Payment gateway transaction fees are set by the provider and are unaffected by this quotation.
4. Prices are quoted in Indonesian Rupiah and are valid for **30 days** from the date of issue.
5. Scope covers the features itemised above. Additional features requested during development will be quoted separately before any work begins.
6. Includes **30 days of post-launch support** for defect resolution. Ongoing maintenance and support can be arranged under a separate agreement.
7. Source code ownership transfers to the client on receipt of final payment.

---

*Thank you for your business.*
