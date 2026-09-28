# Raceground — Decisions Log #8 — Public site, experiences, tournaments

**Date:** 2026-09-23
**Status:** D64–D72 follow the owner's brief and answers in chat on 2026-09-23, before Phase 8 started.
**Supersedes:** D59 (the lighter public look) — see D64.

The owner supplied a reference site (`velocitysimlounge.com`) as screenshots and three screen recordings in `logs/screenshots/`, plus a written price list, membership promo prices and notes on tournaments and event pop-ups. The reference is a **look and flow reference only**: every price, time, resource and member rule stays ours.

---

## D64 — The public website follows a dark racing look ✅ owner 2026-09-23

**Decision:**
- The booking website is rebuilt on a **dark racing theme**: deep navy page, crimson primary action, gold/amber for membership, condensed italic display type for headings, and a checkered-flag divider between sections.
- Sections animate in as they scroll into view; cards lift on hover; the header shrinks and sticks. All animation respects `prefers-reduced-motion`.
- The POS and back office are unchanged.

**Why:** the owner wants the public site to look like the reference. This **reverses D59** ("a lighter public look"), which was decided before there was a reference to follow.

**Photos and logos:** the owner asked to ignore assets for now. Anywhere the reference uses a photograph, we draw a CSS/SVG placeholder in the theme's colours, and any real photos uploaded in the back office (D58) are shown where they exist.

## D65 — Time on the simulators is sold as named experiences ✅ owner 2026-09-23

**The problem this solves:** the owner's price list cannot come from an hourly rate. A 30-minute Quick Race is $35 (which is $70/hr) but a 1-hour Double Race is $58 (which is $58/hr). One rate cannot produce both.

**Decision:**
- A new thing called an **experience**: a named product with a **fixed length** and a **flat price**, belonging to one resource type. It has a tagline, bullet points, optional badges, a sort order and an active flag — all editable in the back office.
- **Launch experiences** (all on the Driving Simulator):

  | Experience | Length | Price |
  |---|---|---|
  | Quick Race (Single Session) | 30 min | $35.00 |
  | Leaderboard Challenge | 30 min | $35.00 |
  | Double Race (Dual Session) | 60 min | $58.00, badged "Most popular" and "Save over 20%" |

- **Billiard tables and VR seats keep the hourly rate** and the existing length picker, online and at the counter. The owner gave no package prices for them.
- **Walk-ins are unchanged**: the counter still bills by the minute at the hourly rate, for every resource type including the simulators.
- Booking an experience books its resource type for **exactly its length**. There is no length picker, and the minimum-billing rule does not apply — the length is fixed.

**How an experience is priced** (one engine, as always):
1. Start from the experience's flat price, or a promotional price if one applies (D66).
2. **Free play is pro-rata**: free minutes cover their share of the flat price. 30 free minutes of a 60-minute $58 Double Race leaves $29 to pay; 60 free minutes leaves $0. Free play is taken in whole sessions, up to the experience's length.
3. Then the member percentage **or** a referral, exactly as before — they still never combine (D9).
4. GST is still one eleventh of the final total.

**Why a flat price rather than a price per length:** the owner wants the site to sell "Quick Race" and "Double Race" with badges and blurbs, the way the reference does, not "Driving Simulator, 30 minutes".

## D66 — Promotional prices are flat, per experience ✅ owner 2026-09-23

**Decision:**
- An experience can have **promotional prices**: a named window (days of the week, a start and an end time) with its own flat price.
- **Launch promotions:**

  | Promotion | When | Quick Race | Leaderboard | Double Race |
  |---|---|---|---|---|
  | Happy Hour | every day, 12:00–15:00 | $29.00 | $29.00 | $49.00 |
  | Student | every day, all hours | $32.00 | $32.00 | $52.00 |

- **Which one applies: the cheapest.** Among the promotions that match the experience, the day and the booking's **start time**, the lowest price wins. Nothing else is needed to make "the student promo is not included in Happy Hour" true — during Happy Hour the $29 is cheaper than the student $32, so Happy Hour is what the customer gets.
- A promotion can be marked **claimed**, meaning it only applies when the customer asks for it. The **student** promotion is claimed: the customer ticks "I'm a student" at checkout and is told to show a student card at the counter. Happy Hour is automatic.
- The promotion is decided by the **start time** of the booking, because an experience is one fixed block. A Double Race starting at 14:30 is a Happy Hour Double Race even though it ends at 15:30.

**The existing percentage Happy Hour is left exactly as it is** (Mon–Fri 10:00–15:00, 10% off, every resource type). It still prices billiards, VR and every walk-in. **This means the venue has two different Happy Hour windows** — 10:00–15:00 on the hourly rate and 12:00–15:00 on the experiences. Both are editable in the back office. **Flagged for the owner to align** when they decide what the billiard and VR happy hour should be.

## D67 — New membership prices; which perks the system enforces ✅ owner 2026-09-23

**Decision — the launch tier values are replaced:**

| Tier | Price | Discount | Free play a month | Balance cap |
|---|---|---|---|---|
| Silver | $48.00 | 10% | 2 sessions (60 min) | 600 min |
| Gold | $78.00 | 20% | 4 sessions (120 min) | 1200 min |
| Diamond | $128.00 | 20% | 8 sessions (240 min) | 2400 min |

The free-play allowances are unchanged from D63 — "2 / 4 / 8 races a month" is the same thing as 2 / 4 / 8 sessions. Only the prices and the Gold and Diamond percentages change (Gold 10% → 20%, Diamond 15% → 20%).

**The system enforces:** the monthly price, the percentage off every booking, and the free-play allowance with its roll-over cap.

**The system lists but does not enforce** — a per-tier list of perks written in the back office and shown on the membership page:
- Silver: Monday–Friday
- Gold: Monday–Sunday · 2 free hours of billiards a month · 20% off food and drinks · early access to registrations and promos
- Diamond: Monday–Sunday · 4 free hours of billiards a month · 20% off food and drinks · free entry to one monthly tournament · Live Watch Party access with exclusive seating · members-only events · a free birthday session · early access

The owner chose not to have the system track these. Staff honour them at the counter. Two of them are worth knowing about:
- **Free billiard hours** would need a second balance that can only be spent on billiard tables; today there is one pooled balance.
- **Silver being Monday–Friday** is not checked, so a Silver member booking on a Saturday still gets 10% off.

**Member prices on the marketing page are computed, not typed.** The owner's list rounds them ($32 for a Silver Quick Race); ten percent off $35 is $31.50. The page shows **$31.50**, because that is what the customer is actually charged. Gold's Quick Race is $28.00 exactly, as listed; Gold's Double Race is $46.40 rather than the listed $46.

**Existing members** keep the balance they have. New prices apply to new sales; a member already billed on Stripe moves to the new price at their next renewal.

## D68 — Tournaments ✅ owner 2026-09-23

**Decision:**
- A **tournament** is created in the back office: name, blurb, when it starts, how many spots, the entry fee, and whether it is published.
- The public page shows **"No tournament available right now"** when nothing is published and upcoming. Otherwise it shows each tournament with **spots left** and a **Sign up** button.
- Signing up takes a name and an email or phone (or uses the signed-in account), then goes to Stripe for the entry fee. A $0 entry is confirmed on the spot without Stripe. A member's percentage applies to the entry fee.
- A spot is held while payment is in progress, the same way a booking slot is, and released if payment isn't finished.

**Free entry for members — built but switched off.** The owner's brief describes it: a member with free entry left is registered the moment they press Sign up, and a member who has used theirs goes to payment. When I asked which perks the system should enforce, free tournament entry was not chosen. So:
- Each tier has a **free tournament entries per month** setting, **set to 0 at launch**, and the sign-up flow already has both branches.
- Turning it on for Diamond later is a number in the back office, not a release.

**Flagged for the owner:** the written brief and the answer disagree here. Say the word and Diamond's setting goes to 1.

## D69 — Events: a pop-up and a banner ✅ owner 2026-09-23

**Decision:**
- An **event** is created in the back office: a title, a line of copy, an optional prize or detail line, a button label and where the button goes, the dates it should show between, and whether it shows as a **pop-up**, a **banner**, or both.
- The **pop-up** appears shortly after the home page loads, and can be closed with an X. Once closed, that event's pop-up does not come back for that visitor (remembered in the browser).
- The **banner** is a slim strip pinned above the header with the same copy, the button and its own X.
- With no active event, neither appears and nothing shifts on the page.

## D70 — The site shows how many spots are left ✅ owner 2026-09-23

**Decision:** every start time on the timetable shows **how many spots are left** at that time, as the reference does ("19 Spots"), and an experience card shows the next few times with their spots. A time with no spots is shown as full rather than hidden, so the customer can see the day filling up.

**Why:** the owner asked for it specifically, and the API already returns the number of free resources for each start time — nothing new is needed in the database.

## D71 — Booking happens in a three-step panel ✅ owner 2026-09-23

**Decision:**
- `/book` becomes a **grid of what you can book**: the three simulator experiences, then Billiard Table and VR Seat at their hourly rate.
- Choosing one opens a panel over the page with three steps, as the reference has: **Date → Details → Pay**, with the chosen thing, its blurb and its price beside them. On a phone it fills the screen.
- The **Date** step is a month calendar, then the times for the chosen day with their spots left.
- The **Details** step collects the name and an email or phone, the referral code, the student tick and — for billiards and VR — how long.
- The **Pay** step shows the full price breakdown, the cancellation policy and the terms tick, then goes to Stripe.
- Every rule underneath is unchanged: the same availability, the same quote, the same hold, the same Stripe Checkout.

## D72 — The home page leads with what you can book ✅ owner 2026-09-23

**Decision:** the home page is rebuilt to the reference's shape — a hero with the venue's one-line intro and two buttons, an "eat / drink / race" style triptych built from the venue's photos, a four-step "how it works", a "what you can book" section that shows the real experiences and prices, membership, opening hours and how to find us, then a closing call to action. Every word and number still comes from the back office and the API.

**Why:** the owner asked that "the landing page shows everything straight away, so the flow is clearer".

---

## D73 — New opening hours ✅ owner 2026-09-24

**Decision:** the venue's launch hours become:

| Day | Open |
|---|---|
| Monday – Thursday | 12:00 pm – 10:00 pm |
| Friday | 12:00 pm – midnight |
| Saturday | 11:00 am – midnight |
| Sunday | 11:00 am – 10:00 pm |

Replacing 10:00–21:00 every day. Still editable in the back office, like every other value.

**Note:** midnight is stored as `24:00`, which Postgres reads as the following midnight, so a Friday booking can run to 11:59 pm. Nothing crosses into the next day.

## D74 — One happy hour, 12:00–15:00, at flat prices ✅ owner 2026-09-24

**The problem this solves:** the venue had ended up with two happy hours — a 10% discount 10:00–15:00 Mon–Fri on the hourly rate, and flat prices 12:00–15:00 every day on the experiences. That was flagged in D66 as needing the owner's decision.

**Decision:** there is **one** happy hour — **12:00 to 15:00, every day** — and it is expressed as a **flat price everywhere**, never as a percentage.

| What | Normal | Happy hour |
|---|---|---|
| Quick Race / Leaderboard Challenge (30 min) | $35.00 | $29.00 |
| Double Race (1 hour) | $58.00 | $49.00 |
| **Billiard table** | **$25.00/hr** (was $30.00) | **$20.00/hr** |
| **VR seat** | $50.00/hr | **$40.00/hr** |

- The experiences already used flat promotional prices, so they are unchanged.
- The hourly types use **rate bands**, which already exist for exactly this: a different rate for particular days and times. No new machinery.
- **The percentage happy hour is switched off.** With a flat rate band in the same window, a percentage on top would discount twice.

**Simulators by the hour are unchanged at $60.** They are sold online as experiences; the hourly rate is only for a walk-in, and the owner did not ask for it to move. **Flagged** — say the word and it gets a happy-hour rate like the others.

**The site now shows the cheapest hourly rate** on a card that has one, the same way an experience shows its "from" price.

## D75 — Tournament entries can be added at the counter ✅ owner 2026-09-24

**Decision:** staff can add someone to a tournament from the back office, and choose either:
- **paid at the counter** — cash or the card terminal, recorded on the open shift and in the day's takings, exactly like a membership sold at the counter (D61); or
- **no charge** — the person is entered with nothing taken, for a comp or an arrangement made another way.

Both are audited. The spot counts against the tournament straight away, the same as one bought online.

**Not built, and not asked for:** cancelling or refunding a tournament entry, and any display of the tournament's format — brackets, rounds, heats, results or a leaderboard.
