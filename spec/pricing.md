# Pricing Engine — `packages/pricing`

The most important component. It is a **pure function with no I/O and no runtime dependencies**. The booking site quote, the booking charge, the POS close and the overstay charge all call it. There must never be a second implementation.

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
   billedMinutes  = applyMinimum ? max(actualMinutes, minMinutes) : actualMinutes
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
| T3 | Table, 16 min 10 s | billed 17 min, $8.50 |
| T4 | Sim, Wed 14:30–15:30, Gold | $27.00 + $30.00 = $57.00 − $5.70 = **$51.30**, GST $4.66 |
| T5 | Table, 1 h inside HH, $5 fixed referral | $27.00 − $5.00 = **$22.00** |
| T6 | Table, 1 h inside HH, $30 fixed referral | total floors at **$0.00** |
| T7 | Table, 1 h Saturday 11:00 | no HH, $30.00 |
| T8 | Sim 1 h Mon 10:00, Silver, 45 free minutes | 45 free + 15 paid @ $54/hr = $13.50 − 5% = **$12.83** (12.825 rounds half up) |
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
