# Phase 8a — The pricing engine learns about experiences

**Date:** 2026-09-23
**Decisions:** [D65, D66, D67](../decisions/08-2026-09-23-public-site-experiences-tournaments.md).
**Spec updated:** [pricing.md](../../spec/pricing.md) §9 (new), §8 (T4 and T8 re-worked).

**Why this had to change first**

The owner's price list cannot come from an hourly rate. A 30-minute Quick Race is $35, which is $70 an hour; a 60-minute Double Race is $58, which is $58 an hour. One rate cannot produce both numbers. So the engine needed a second way to reach a subtotal — a flat price for a fixed length — before anything else could be built on top of it.

**Done**

**One engine, two front doors.** `priceSession` is untouched in what it does: every walk-in, and every online booking of a billiard table or VR seat, is still priced per minute at an hourly rate. The new `priceExperience` starts from a flat price instead. Everything after the subtotal — free play, the member percentage or a referral, rounding, GST, the explanation — is **literally the same code**, pulled out into two shared helpers (`validateDiscounts` and `applyDiscount`) that both entry points call. That is the point: there is still one set of money rules, reached two ways.

**What an experience is** (`ExperiencePricing`): a name, the resource type it runs on, a fixed length in minutes and a flat price in cents. The resource type's minimum-billing rule never applies, because the length is not something the customer chose.

**Promotional prices** (`ExperiencePromo`): a named window — days of the week, a start and an end time — with its own flat price for one experience, and a `claimed` flag for prices the customer has to ask for.

- **The cheapest matching promotion wins.** This is the whole rule, and it makes "the student price is not included in Happy Hour" true without a rule for it: during Happy Hour the automatic $29 beats the claimed student $32, so the customer is charged $29. It is also always the answer in the customer's favour, which is the only safe default for a price shown before payment.
- **The start instant decides.** An experience is one indivisible block sold at one price, so a Double Race starting at 14:30 is a Happy Hour Double Race even though it runs to 15:30. Per-minute classification stays the rule for everything priced by the hour, where it matters for DST.
- **Overlapping windows are allowed**, unlike rate bands and percentage happy hours. With "cheapest wins" an overlap is a feature, so `validateExperiencePromos` deliberately does not reject it.

**Free play is pro rata.** On a flat price there are no minutes to zero out, so free minutes cover their share of the price: 30 free minutes of a 60-minute $58 Double Race leaves $29 to pay, and 60 leaves $0. Kept exact as `priceCents × paidMinutes / minutes` over a `BigInt` denominator, so it rounds once like everything else.

**Two new fields on the result**, both additive so nothing downstream breaks:
- `segments[].kind` is `"time"` or `"experience"`. Experience segments carry `rateCents: 0`, because there is no hourly rate to report — reporting a fake one would be worse than reporting none.
- `experience` is `null` from `priceSession`, and from `priceExperience` carries the name, the length, the list price, the price actually used and which promotion (if any) produced it.

**New validators for the back office:** `validateExperience` (name, price ≥ 0, length a whole number of sessions) and `validateExperiencePromos`.

**The launch tier values changed** (D67): Silver 5% → **10%**, Gold 10% → **20%**, Diamond 15% → **20%**. The engine tests use launch configuration by design, so the fixtures and four worked examples moved with them, and `spec/pricing.md` §8 was corrected to match rather than left disagreeing with the tests.

**Verified**

1. **22 new tests, X1–X22**, all listed in `spec/pricing.md` §9.5 so the spec and the suite say the same thing. Pricing total **78 → 100**.
2. **The numbers were checked against the owner's list, not just against themselves:**
   - Quick Race $35.00, Double Race $58.00, Happy Hour $29.00 and $49.00, student $32.00 — all exact.
   - Gold 20% off a Quick Race is **$28.00**, exactly the owner's member price.
   - Two are deliberately *not* the owner's figures, and the tests say so: Silver's Quick Race is **$31.50**, not the listed $32 (10% off $35), and Gold's Double Race is **$46.40**, not the listed $46. The site shows what is actually charged (D67).
3. **Boundaries:** 15:00 is outside a window ending at 15:00 (X6), and a Double Race starting at 14:30 still gets the Happy Hour price (X5).
4. **The old rules still hold on the new path:** membership and referral together throw (X18), free play without a membership throws (X19), a fixed referral floors at $0.00 (X16), and segment amounts always sum exactly to the subtotal (X17).
5. **Gate:** `turbo run typecheck lint test --force` → **11 successful, 11 total**; pricing 100, API 191. Nothing in the API or the POS needed changing, which is the evidence that the two added fields really were additive.

**Issues found and fixed**

1. **The first version of X11 asserted $31.50 and got $33.25.** The test was right about the intent and wrong about the input: it used the `silver` fixture, which still held the old 5%. That exposed something worth more than the test — the tier percentages in D67 had not been carried into the fixtures at all, so four other tests were still asserting old money. Fixing it properly meant moving the fixtures, the four assertions and `spec/pricing.md` §8 together, rather than dodging it with a literal in one test.
2. **A leftover `const endAt` in `priceExperience`** was computed and never used, with a `void endAt` to quiet the linter. Both removed — an experience's end time is the caller's business, not the engine's.

**Not built yet**

- Nothing reads an experience from a database yet; that is the next step. `priceExperience` is pure and has no idea where its input comes from.
- The POS does not sell experiences at the counter. Walk-ins stay hourly (D65), so nothing there needed to change.
