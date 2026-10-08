# Pricing Engine — `packages/pricing`

The most important component. It is a **pure function with no I/O and no runtime dependencies**. The booking site quote, the booking charge, the POS close and the overstay charge all call it. There must never be a second implementation.

It has **two entry points**, which share their discount, rounding and GST steps:

| Function | Used for | Price comes from |
|---|---|---|
| `priceSession` | every walk-in, and online bookings of billiard tables | an **hourly rate**, each minute priced on its own, charged in 15-minute blocks (D91) |
| `priceExperience` | online bookings of a named package on the simulators (D65) | a **flat price** for a fixed length |

## 1. Units and representation

| Quantity | Representation | Why |
|---|---|---|
| Money | **Integer cents** (`30_00` = $30.00) | No floating-point money |
| Percentages | **Basis points** (`1000` = 10.00%) | Integer math |
| Instants | UTC epoch milliseconds, or ISO strings converted at the boundary | DST safety |
| Wall-clock times | `"HH:MM"` strings, local to the venue timezone | Happy hour "6pm" stays 6pm |
| Days of week | ISO: `1` = Monday … `7` = Sunday | |

Intermediate amounts are kept as **exact rationals using `BigInt`**. The engine **rounds only at the end** (§5).

## 2. Inputs

```ts
priceSession({
  startAt: number,               // UTC ms — booking start or session opened_at
  endAt: number,                 // UTC ms — booking end or session closed_at
  timeZone: string,              // "Australia/Sydney"
  resourceType: {
    id: string,
    baseRateCents: number,       // per hour, incl. GST
    minMinutes: number,          // 15 at launch
  },
  rateBands: RateBand[],         // optional overrides of the base rate
  happyHours: HappyHour[],
  member?: { tierName: string, discountBp: number },
  referral?: { code: string, type: "percent" | "fixed", value: number }, // bp or cents
  freeMinutes?: number,          // requested free-play minutes (member only)
  applyMinimum?: boolean,        // default true; false for overstay extensions
})
```

```ts
RateBand  = { id, resourceTypeId, daysOfWeek: number[], startTime: "HH:MM", endTime: "HH:MM", rateCents }
HappyHour = { id, name, resourceTypeIds: string[] | null /* null = all */, daysOfWeek, startTime, endTime, discountBp }
```

- A window covers local times `startTime ≤ t < endTime` on the listed days. `endTime` may be `"24:00"`.
- Windows don't cross midnight. A midnight-crossing window is entered as two windows.
- If no rate band matches a minute, that minute uses `baseRateCents`. At launch there are **no rate bands**; every type is priced at its base rate.

**Engine-level errors (thrown):**
- `endAt < startAt`
- both `member` and `referral` given
- `freeMinutes` given without `member`
- a percentage `≥ 10000` or `< 0`
- a fixed amount `≤ 0`
- a negative rate

Back office validation (§7) prevents these from being saved in the first place.

## 3. Algorithm

```
1. actualMinutes  = ceil((endAt − startAt) / 60_000)
   billedMinutes  = applyMinimum ? ceil(max(actualMinutes, minMinutes) / 15) × 15 : actualMinutes
                    // D91: the minimum, then 15-minute blocks rounded up (20 min played → 30 billed)
   (billed period = [startAt, startAt + billedMinutes × 60_000])

2. freeMinutes    = min(requestedFreeMinutes ?? 0, billedMinutes)
   minutes 0 … freeMinutes−1 are free; the rest are paid

3. For each paid minute i (instant = startAt + i × 60_000):
     local = wall-clock of instant in timeZone          // Intl, per instant
     rate  = first matching rate band for resourceType, else baseRateCents
     hh    = largest discountBp among happy hours matching resourceType + local
     minute amount (exact) = rate × (10000 − hh) / (60 × 10000)

4. subtotal (exact) = Σ minute amounts

5. total (exact) =
     member            → subtotal × (10000 − member.discountBp) / 10000
     referral percent  → subtotal × (10000 − referral.value) / 10000
     referral fixed    → max(0, subtotal − referral.value)
     none              → subtotal

6. totalCents    = roundHalfUp(total)
   subtotalCents = roundHalfUp(subtotal)
   discountCents = subtotalCents − totalCents          // so printed lines always add up
   gstCents      = roundHalfUp(totalCents / 11)

7. Group consecutive minutes with the same (free?, rate, hh) into segments.
   Each segment's displayed amount uses largest-remainder allocation so that
   Σ segment amountCents === subtotalCents exactly.

8. Emit explanation[] (human-readable lines, §6).
```

**Why evaluate each minute.** Each minute is classified by the local wall-clock time of **its start instant**. At most about 660 minutes per session, this is trivially cheap, and it makes DST correct by construction:
- Duration comes from real UTC elapsed time.
- Every minute is looked up in local time.
- A skipped hour (October) produces no segment.
- A repeated hour (April) is billed twice, because it really was played twice.

A session starting mid-minute (e.g. 5:59:30pm) has its minutes classified at 5:59:30, 6:00:30, and so on.

## 4. Output

```ts
{
  actualMinutes, billedMinutes, freeMinutes, paidMinutes,
  segments: [{
    startAt, endAt,              // UTC ms
    localStart, localEnd,        // "YYYY-MM-DD HH:MM" in venue time
    minutes, free: boolean,
    rateCents, happyHourBp, happyHourName?,
    amountCents                  // display amount (largest-remainder allocated)
  }],
  subtotalCents,
  discount: null | { kind: "member" | "referral_percent" | "referral_fixed", label, valueBp?, valueCents?, amountCents },
  totalCents, gstCents,
  explanation: string[]
}
```

## 5. Rounding

- Round **half up** to the nearest cent. Totals are never negative, so there is no negative-number ambiguity.
- The engine rounds **once** for the subtotal and **once** for the total. It never sums rounded segment amounts to get the total.
- The displayed discount is `subtotalCents − totalCents`.
- GST = `roundHalfUp(totalCents / 11)`, calculated from the final rounded total.

## 6. Explanation format

One line per segment, then a discount line, total and GST. Example:
```
Sim 3 · Wed 16 Sep 2026
14:30–15:00  30 min @ $60.00/hr − Happy Hour 10% = $54.00/hr   $27.00
15:00–15:30  30 min @ $60.00/hr                                $30.00
Subtotal                                                       $57.00
Gold member 10%                                                −$5.70
Total (incl. GST $4.66)                                        $51.30
```
Free-play example line: `10:00–10:45  45 min free play (member balance)  $0.00`.

## 7. Validation helpers (exported, used by the back office and API)

- `validateRateBands(bands)`: rejects overlap within the same resource type and day, rejects `start ≥ end`, rejects a bad time format, rejects a negative rate.
- `validateHappyHours(hhs)`: rejects overlap for any shared resource type and day, rejects `start ≥ end`, rejects discount outside `0 < bp < 10000`.
- `validateReferral(r)`: percent `0 < bp < 10000`; fixed `> 0`.
- `validateTier(t)`: `0 ≤ bp < 10000`, price `≥ 0`, allowance `≥ 0`, cap `≥ 0`.

## 8. Required test cases

Every case below is an automated test. The dollar values use launch configuration.

| # | Case | Expected |
|---|---|---|
| T1 | Table, 5 min actual, weekday 16:00 (no HH) | billed 15 min, $7.50 |
| T2 | Table, exactly 15:00 min | billed 15, $7.50 |
| T3 | Table, 16 min 10 s | 17 played, billed 30 min (D91), $15.00 |
| T3b | Table, 20 / 31 / 45 / 61 min played | billed 30 / 45 / 45 / 75 min (D91) |
| T4 | Sim, Wed 14:30–15:30, Gold | $27.00 + $30.00 = $57.00 − $11.40 = **$45.60**, GST $4.15 |
| T5 | Table, 1 h inside HH, $5 fixed referral | $27.00 − $5.00 = **$22.00** |
| T6 | Table, 1 h inside HH, $30 fixed referral | total floors at **$0.00** |
| T7 | Table, 1 h Saturday 11:00 | no HH, $30.00 |
| T8 | Sim 1 h Mon 10:00, Silver, 45 free minutes | 45 free + 15 paid @ $54/hr = $13.50 − 10% = **$12.15** |
| T9 | Free minutes > billed minutes | free = billed, total $0.00 |
| T10 | Member + referral both given | throws |
| T11 | VR 1 min @ $50/hr, no minimum | 83.33… → $0.83; segments sum to subtotal |
| T12 | VR 7 segments of thirds | Σ segment amounts === subtotal (largest remainder) |
| T13 | Session crossing midnight Sun→Mon with a Mon-only band | minutes after 00:00 use the Mon band |
| T14 | DST start 2026-10-04: 01:30 → 03:30 local | 60 real minutes billed |
| T15 | DST end 2026-04-05: 01:30 → 03:30 local | 180 real minutes billed |
| T16 | Rate band override (e.g. Sat $40/hr) + HH on different days | correct per-minute rate |
| T17 | Session starting 14:59:30 on a HH day | first minute is HH, subsequent from 15:00:30 are not |
| T18 | Overstay: `applyMinimum = false`, 4 min | billed 4 min |
| T19 | Referral 20% percent + HH | multiplicative |
| T20 | Validation helpers reject overlap, bad bp, bad times | throws/returns errors |


## 9. Experiences — `priceExperience` (D65, D66)

An **experience** is a named package with a **fixed length** and a **flat price**: Quick Race is 30 minutes for $35.00 whatever the simulator's hourly rate happens to be. Its price cannot be expressed as a rate, because a 30-minute Quick Race is $70/hr while a 60-minute Double Race is $58/hr.

### 9.1 Inputs

```ts
priceExperience({
  startAt: number,                 // UTC ms. One fixed block, so this alone decides the promotion.
  timeZone: string,
  experience: { id, name, resourceTypeId, minutes, priceCents },
  promos: ExperiencePromo[],
  claimedPromoIds?: string[],      // the `claimed` promotions the customer asked for
  member?: { tierName, discountBp },
  memberPriceCents?: number,       // the member's tier's own flat price for this experience (D82)
  referral?: { code, type, value },
  freeMinutes?: number,
})
```

```ts
ExperiencePromo = { id, name, experienceId, daysOfWeek, startTime, endTime, priceCents, claimed }
```

### 9.2 Algorithm

```
1. minutes      = experience.minutes            (fixed; the resource type's minimum never applies)
   freeMinutes  = min(requested ?? 0, minutes)
   paidMinutes  = minutes − freeMinutes

2. Candidate promotions: same experience, `daysOfWeek` and `startTime ≤ local(startAt) < endTime`,
   and — if `claimed` — listed in `claimedPromoIds`.
   The one with the LOWEST priceCents wins. Ties keep the first in the list.

3. Member price (D82), only with `member`:
     memberPrice = memberPriceCents ?? round_half_up(experience.priceCents × (10000 − discountBp) / 10000)
   It is ONE MORE CANDIDATE, not a discount: it wins if it is ≤ the price from step 2 (or the
   list price when no promotion matched). A tie goes to the member price.

   priceCents    = the winner's price, else experience.priceCents

4. subtotal (exact) = priceCents × paidMinutes / minutes      // free play is pro rata

5–7. Identical to §3 steps 5–7, except a member's percentage is NEVER applied here — the
     membership is already in the price (D82). A referral still applies for a guest.
     Segments are at most two — the free part and the paid part — allocated by largest remainder.
```

**Why the cheapest promotion wins.** It makes "the student price is not included in Happy Hour" true without a rule for it: during Happy Hour the automatic $29 beats the claimed student $32, so the customer gets $29. It is also always the answer in the customer's favour, which is the only safe default for a price shown before payment.

**Why a member price never stacks (D82).** The owner's poster sets each tier's price outright — Silver $32 / $52, Gold and Diamond $28 / $46 — as the member's cheapest rate. Taking a percentage off Happy Hour on top would undercut it ($29 − 20% = $23.20). So the member price competes with the promotions and the cheapest single price wins: Gold pays $28 in Happy Hour, Silver pays Happy Hour's $29 rather than their $32. Time booked by the hour (billiards) still takes the tier's percentage (§3).

**Why the start instant decides.** An experience is one indivisible block sold at one price. A Double Race starting at 14:30 is a Happy Hour Double Race even though it runs past 15:00. Per-minute classification (§3) stays the rule for everything priced by the hour.

### 9.3 Output

The same `PriceResult` as `priceSession`, with:
- `segments[].kind === "experience"`, `rateCents === 0` — there is no hourly rate to report.
- `experience` set to `{ id, name, minutes, listPriceCents, priceCents, promo }`, where `promo` is `null` unless one applied. `priceSession` sets `experience` to `null`.

### 9.4 Validation helpers

- `validateExperience(values, sessionMinutes)`: name required, price ≥ 0, length a whole number of sessions.
- `validateExperiencePromos(promos)`: each window is real (§7 rules) and the price is ≥ 0. **Overlap is allowed** — the cheapest wins, so overlapping windows are a feature, not an error.

### 9.5 Required test cases

| # | Case | Expected |
|---|---|---|
| X1 | Quick Race, outside every window | $35.00, and the sim's $60/hr is not consulted |
| X2 | Double Race | $58.00, GST $5.27 |
| X3 | Any experience | the resource type's minimum never applies |
| X4 | Quick Race at 13:00 | Happy Hour $29.00 |
| X5 | Double Race starting 14:30 | Happy Hour $49.00, though it ends at 15:30 |
| X6 | Quick Race at 15:00 | $35.00; the window end is exclusive |
| X7 | Student promotion | ignored unless claimed, then $32.00 |
| X8 | Student claimed at 13:00 | $29.00 — the cheapest wins |
| X8b | The same, with the promotions reversed | $29.00 — the order they arrive in makes no difference |
| X9 | A promotion for another experience | ignored |
| X10 | Single Session, Gold, member price $28 | $28.00, no discount line (D82) |
| X11 | Silver $32; Double Session Gold $46 | $32.00 and $46.00 — the poster's prices, not $31.50 / $46.40 |
| X11b | Silver, no flat price set | $31.50 — the tier's percentage stands in, still no discount line |
| X12 | 13:00: Gold $28 vs Happy Hour $29; Silver $32 vs $29 | $28.00 and $29.00 — the cheapest wins, never stacked |
| X12b | Silver $32 vs Student $32 claimed; Gold with no flat price at 13:00 | $32.00 shown as the member price; $28.00, not $23.20 |
| X12c | A member price that isn't whole cents | throws |
| X13 | Double Race, 30 free minutes | $29.00 — free play is pro rata |
| X14 | Quick Race, 30 free minutes | $0.00, GST $0.00 |
| X15 | Free minutes beyond the length | clamped to the length |
| X16 | $5 and $99 fixed referrals | $30.00 and $0.00 |
| X17 | Any split | segment amounts sum exactly to the subtotal |
| X18 | Member + referral | throws |
| X19 | Free minutes without a member | throws |
| X20 | Promotion + free play + member | full explanation, in order |
| X21 | Plain list price | three lines only |
| X22 | Any experience | every segment has `kind: "experience"` |
