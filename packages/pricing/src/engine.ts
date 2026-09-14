import { PricingError } from "./errors.js";
import { allocateLargestRemainder, formatBp, formatCents, roundHalfUp } from "./money.js";
import { MINUTE_MS, parseWallTime, toLocal, windowContains } from "./time.js";
import type {
  AppliedDiscount,
  HappyHour,
  PriceResult,
  PriceSegment,
  PriceSessionInput,
  RateBand,
} from "./types.js";

const BP = 10_000n;
/** Minute amounts are kept exact as numerators over (60 minutes × 10000 bp). */
const MINUTE_DENOMINATOR = 60n * BP;

function assertInteger(value: number, name: string, min: number): void {
  if (!Number.isSafeInteger(value) || value < min) {
    throw new PricingError(`${name} must be an integer ≥ ${min}, got ${value}`);
  }
}

function assertBp(value: number, name: string, allowZero: boolean): void {
  if (!Number.isSafeInteger(value) || value < 0 || value >= 10_000 || (!allowZero && value === 0)) {
    throw new PricingError(`${name} must be ${allowZero ? "0" : "1"}–9999 basis points, got ${value}`);
  }
}

function validateInput(input: PriceSessionInput): void {
  const { startAt, endAt, resourceType, member, referral, freeMinutes } = input;
  if (!Number.isFinite(startAt) || !Number.isFinite(endAt)) {
    throw new PricingError("startAt and endAt must be finite epoch milliseconds");
  }
  if (endAt < startAt) throw new PricingError("endAt is before startAt");
  assertInteger(resourceType.baseRateCents, "resourceType.baseRateCents", 0);
  assertInteger(resourceType.minMinutes, "resourceType.minMinutes", 1);
  if (member && referral) {
    throw new PricingError("Membership and referral discounts cannot be combined");
  }
  if (member) assertBp(member.discountBp, "member.discountBp", true);
  if (referral) {
    if (referral.type === "percent") assertBp(referral.value, "referral.value", false);
    else assertInteger(referral.value, "referral.value (cents)", 1);
  }
  if (freeMinutes !== undefined) {
    if (!member) throw new PricingError("freeMinutes requires a member");
    assertInteger(freeMinutes, "freeMinutes", 0);
  }
  for (const band of input.rateBands) {
    assertInteger(band.rateCents, `rateBand ${band.id}.rateCents`, 0);
    parseWallTime(band.startTime);
    parseWallTime(band.endTime);
  }
  for (const hh of input.happyHours) {
    assertBp(hh.discountBp, `happyHour ${hh.id}.discountBp`, false);
    parseWallTime(hh.startTime);
    parseWallTime(hh.endTime);
  }
}

interface MinuteInfo {
  free: boolean;
  rateCents: number;
  rateBandId: string | null;
  happyHour: HappyHour | null;
}

export function priceSession(input: PriceSessionInput): PriceResult {
  validateInput(input);
  const { startAt, endAt, timeZone, resourceType, member, referral } = input;
  const applyMinimum = input.applyMinimum ?? true;

  const actualMinutes = Math.ceil((endAt - startAt) / MINUTE_MS);
  const billedMinutes = applyMinimum ? Math.max(actualMinutes, resourceType.minMinutes) : actualMinutes;
  const minimumApplied = billedMinutes > actualMinutes;
  const freeMinutes = Math.min(input.freeMinutes ?? 0, billedMinutes);

  const bands: RateBand[] = input.rateBands.filter((b) => b.resourceTypeId === resourceType.id);
  const happyHours: HappyHour[] = input.happyHours.filter(
    (h) => h.resourceTypeIds === null || h.resourceTypeIds.includes(resourceType.id),
  );

  // 1. Classify every billed minute by the local wall-clock time of its start instant.
  const minutes: MinuteInfo[] = [];
  for (let i = 0; i < billedMinutes; i++) {
    const instant = startAt + i * MINUTE_MS;
    if (i < freeMinutes) {
      minutes.push({ free: true, rateCents: 0, rateBandId: null, happyHour: null });
      continue;
    }
    const local = toLocal(instant, timeZone);
    const band = bands.find((b) => windowContains(b, local)) ?? null;
    let happyHour: HappyHour | null = null;
    for (const hh of happyHours) {
      if (windowContains(hh, local) && (!happyHour || hh.discountBp > happyHour.discountBp)) {
        happyHour = hh;
      }
    }
    minutes.push({
      free: false,
      rateCents: band ? band.rateCents : resourceType.baseRateCents,
      rateBandId: band ? band.id : null,
      happyHour,
    });
  }

  // 2. Group consecutive identical minutes into segments, keeping exact amounts.
  interface Draft {
    startIndex: number;
    count: number;
    info: MinuteInfo;
    numerator: bigint;
  }
  const drafts: Draft[] = [];
  for (let i = 0; i < minutes.length; i++) {
    const info = minutes[i]!;
    const last = drafts[drafts.length - 1];
    const same =
      last &&
      last.info.free === info.free &&
      last.info.rateCents === info.rateCents &&
      last.info.rateBandId === info.rateBandId &&
      (last.info.happyHour?.id ?? null) === (info.happyHour?.id ?? null);
    const minuteNumerator = info.free
      ? 0n
      : BigInt(info.rateCents) * (BP - BigInt(info.happyHour?.discountBp ?? 0));
    if (same) {
      last.count += 1;
      last.numerator += minuteNumerator;
    } else {
      drafts.push({ startIndex: i, count: 1, info, numerator: minuteNumerator });
    }
  }

  // 3. Subtotal and total, rounded once each.
  const subtotalExact = drafts.reduce((sum, d) => sum + d.numerator, 0n);
  const subtotalCents = roundHalfUp(subtotalExact, MINUTE_DENOMINATOR);

  let totalCents: bigint;
  let discountDraft:
    | { kind: "member"; label: string; valueBp: number }
    | { kind: "referral_percent"; label: string; code: string; valueBp: number }
    | { kind: "referral_fixed"; label: string; code: string; valueCents: number }
    | null = null;

  if (member) {
    totalCents = roundHalfUp(
      subtotalExact * (BP - BigInt(member.discountBp)),
      MINUTE_DENOMINATOR * BP,
    );
    discountDraft = {
      kind: "member",
      label: `${member.tierName} member ${formatBp(member.discountBp)}`,
      valueBp: member.discountBp,
    };
  } else if (referral?.type === "percent") {
    totalCents = roundHalfUp(
      subtotalExact * (BP - BigInt(referral.value)),
      MINUTE_DENOMINATOR * BP,
    );
    discountDraft = {
      kind: "referral_percent",
      label: `Referral ${referral.code} ${formatBp(referral.value)}`,
      code: referral.code,
      valueBp: referral.value,
    };
  } else if (referral?.type === "fixed") {
    const afterFixed = subtotalExact - BigInt(referral.value) * MINUTE_DENOMINATOR;
    totalCents = roundHalfUp(afterFixed > 0n ? afterFixed : 0n, MINUTE_DENOMINATOR);
    discountDraft = {
      kind: "referral_fixed",
      label: `Referral ${referral.code} ${formatCents(referral.value)} off`,
      code: referral.code,
      valueCents: referral.value,
    };
  } else {
    totalCents = subtotalCents;
  }

  const gstCents = roundHalfUp(totalCents, 11n);
  const discountCents = Number(subtotalCents - totalCents);
  const discount: AppliedDiscount | null = discountDraft
    ? ({ ...discountDraft, amountCents: discountCents } as AppliedDiscount)
    : null;

  // 4. Display amounts per segment that sum exactly to the subtotal.
  const allocated = allocateLargestRemainder(
    drafts.map((d) => d.numerator),
    MINUTE_DENOMINATOR,
    subtotalCents,
  );

  const segments: PriceSegment[] = drafts.map((d, idx) => {
    const segStart = startAt + d.startIndex * MINUTE_MS;
    const segEnd = segStart + d.count * MINUTE_MS;
    return {
      startAt: segStart,
      endAt: segEnd,
      localStart: toLocal(segStart, timeZone).label,
      localEnd: toLocal(segEnd, timeZone).label,
      minutes: d.count,
      free: d.info.free,
      rateCents: d.info.rateCents,
      rateBandId: d.info.rateBandId,
      happyHourBp: d.info.happyHour?.discountBp ?? 0,
      happyHourId: d.info.happyHour?.id ?? null,
      happyHourName: d.info.happyHour?.name ?? null,
      amountCents: Number(allocated[idx]),
    };
  });

  const result: Omit<PriceResult, "explanation"> = {
    actualMinutes,
    billedMinutes,
    minimumApplied,
    freeMinutes,
    paidMinutes: billedMinutes - freeMinutes,
    segments,
    subtotalCents: Number(subtotalCents),
    discount,
    totalCents: Number(totalCents),
    gstCents: Number(gstCents),
  };
  return { ...result, explanation: explain(result) };
}

function explain(r: Omit<PriceResult, "explanation">): string[] {
  const lines: string[] = [];
  const firstDate = r.segments[0]?.localStart.slice(0, 10);
  const multiDay = r.segments.some((s) => s.localStart.slice(0, 10) !== firstDate);
  const span = (s: PriceSegment) => {
    const start = multiDay ? s.localStart : s.localStart.slice(11);
    return `${start}–${s.localEnd.slice(11)}`;
  };

  if (r.minimumApplied) {
    lines.push(`Minimum ${r.billedMinutes} min charge (played ${r.actualMinutes} min)`);
  }
  for (const s of r.segments) {
    if (s.free) {
      lines.push(`${span(s)}  ${s.minutes} min free play (member balance)  ${formatCents(0)}`);
      continue;
    }
    let rate = `${formatCents(s.rateCents)}/hr`;
    if (s.happyHourBp > 0) {
      const effective = Number(roundHalfUp(BigInt(s.rateCents) * (BP - BigInt(s.happyHourBp)), BP));
      rate += ` − ${s.happyHourName ?? "Happy Hour"} ${formatBp(s.happyHourBp)} = ${formatCents(effective)}/hr`;
    }
    lines.push(`${span(s)}  ${s.minutes} min @ ${rate}  ${formatCents(s.amountCents)}`);
  }
  lines.push(`Subtotal  ${formatCents(r.subtotalCents)}`);
  if (r.discount) {
    lines.push(`${r.discount.label}  ${formatCents(-r.discount.amountCents)}`);
  }
  lines.push(`Total (incl. GST ${formatCents(r.gstCents)})  ${formatCents(r.totalCents)}`);
  return lines;
}
