import { PricingError } from "./errors.js";
import { allocateLargestRemainder, formatBp, formatCents, roundHalfUp } from "./money.js";
import { MINUTE_MS, parseWallTime, toLocal, windowContains } from "./time.js";
import type {
  AppliedDiscount,
  AppliedExperience,
  ExperiencePromo,
  HappyHour,
  MemberDiscount,
  PriceExperienceInput,
  PriceResult,
  PriceSegment,
  PriceSessionInput,
  RateBand,
  ReferralDiscount,
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

/** The discount rules are the same whichever way the subtotal was reached (D9, D10). */
function validateDiscounts(
  member: MemberDiscount | undefined,
  referral: ReferralDiscount | undefined,
  freeMinutes: number | undefined,
): void {
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
}

/**
 * Step 5 of the algorithm, shared by both ways of pricing: apply the member percentage,
 * the referral, or nothing, to an exact subtotal, and round the total once.
 */
function applyDiscount(
  subtotalExact: bigint,
  denominator: bigint,
  subtotalCents: bigint,
  member: MemberDiscount | undefined,
  referral: ReferralDiscount | undefined,
): { totalCents: bigint; discount: AppliedDiscount | null } {
  let totalCents: bigint;
  let draft:
    | { kind: "member"; label: string; valueBp: number }
    | { kind: "referral_percent"; label: string; code: string; valueBp: number }
    | { kind: "referral_fixed"; label: string; code: string; valueCents: number }
    | null = null;

  if (member) {
    totalCents = roundHalfUp(subtotalExact * (BP - BigInt(member.discountBp)), denominator * BP);
    draft = {
      kind: "member",
      label: `${member.tierName} member ${formatBp(member.discountBp)}`,
      valueBp: member.discountBp,
    };
  } else if (referral?.type === "percent") {
    totalCents = roundHalfUp(subtotalExact * (BP - BigInt(referral.value)), denominator * BP);
    draft = {
      kind: "referral_percent",
      label: `Referral ${referral.code} ${formatBp(referral.value)}`,
      code: referral.code,
      valueBp: referral.value,
    };
  } else if (referral?.type === "fixed") {
    const afterFixed = subtotalExact - BigInt(referral.value) * denominator;
    totalCents = roundHalfUp(afterFixed > 0n ? afterFixed : 0n, denominator);
    draft = {
      kind: "referral_fixed",
      label: `Referral ${referral.code} ${formatCents(referral.value)} off`,
      code: referral.code,
      valueCents: referral.value,
    };
  } else {
    totalCents = subtotalCents;
  }

  const discount: AppliedDiscount | null = draft
    ? ({ ...draft, amountCents: Number(subtotalCents - totalCents) } as AppliedDiscount)
    : null;
  return { totalCents, discount };
}

function validateInput(input: PriceSessionInput): void {
  const { startAt, endAt, resourceType, member, referral, freeMinutes } = input;
  if (!Number.isFinite(startAt) || !Number.isFinite(endAt)) {
    throw new PricingError("startAt and endAt must be finite epoch milliseconds");
  }
  if (endAt < startAt) throw new PricingError("endAt is before startAt");
  assertInteger(resourceType.baseRateCents, "resourceType.baseRateCents", 0);
  assertInteger(resourceType.minMinutes, "resourceType.minMinutes", 1);
  validateDiscounts(member, referral, freeMinutes);
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

  const { totalCents, discount } = applyDiscount(
    subtotalExact,
    MINUTE_DENOMINATOR,
    subtotalCents,
    member,
    referral,
  );
  const gstCents = roundHalfUp(totalCents, 11n);

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
      kind: "time" as const,
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
    experience: null,
  };
  return { ...result, explanation: explain(result) };
}

/**
 * Price one experience: a named package with a fixed length and a flat price (D65).
 *
 * The flat price replaces the per-minute rate, but everything after it is the same as
 * `priceSession`: free play first, then the member percentage or a referral, then GST.
 */
export function priceExperience(input: PriceExperienceInput): PriceResult {
  const { startAt, timeZone, experience, member, referral } = input;
  if (!Number.isFinite(startAt)) {
    throw new PricingError("startAt must be finite epoch milliseconds");
  }
  assertInteger(experience.minutes, "experience.minutes", 1);
  assertInteger(experience.priceCents, "experience.priceCents", 0);
  validateDiscounts(member, referral, input.freeMinutes);
  for (const promo of input.promos) {
    assertInteger(promo.priceCents, `promo ${promo.id}.priceCents`, 0);
    parseWallTime(promo.startTime);
    parseWallTime(promo.endTime);
  }

  const minutes = experience.minutes;
  const freeMinutes = Math.min(input.freeMinutes ?? 0, minutes);
  const paidMinutes = minutes - freeMinutes;

  // The cheapest promotion that matches wins. Nothing more is needed to make
  // "the student price is not included in Happy Hour" true: $29 beats $32 (D66).
  const claimed = new Set(input.claimedPromoIds ?? []);
  const local = toLocal(startAt, timeZone);
  let promo: ExperiencePromo | null = null;
  for (const p of input.promos) {
    if (p.experienceId !== experience.id) continue;
    if (p.claimed && !claimed.has(p.id)) continue;
    if (!windowContains(p, local)) continue;
    if (!promo || p.priceCents < promo.priceCents) promo = p;
  }

  // D82: a member's price is a flat price of its own, and it never stacks with a promotion —
  // it is one more candidate, and the cheapest still wins. Without a flat price for the tier, the
  // tier's percentage off the list price stands in for it.
  let chosen: AppliedExperience["promo"] = promo ? { id: promo.id, name: promo.name, priceCents: promo.priceCents } : null;
  if (member) {
    if (input.memberPriceCents !== undefined) assertInteger(input.memberPriceCents, "memberPriceCents", 0);
    const memberPrice =
      input.memberPriceCents ?? Number(roundHalfUp(BigInt(experience.priceCents) * (BP - BigInt(member.discountBp)), BP));
    if (memberPrice <= (chosen?.priceCents ?? experience.priceCents)) {
      chosen = { id: `member:${member.tierName}`, name: `${member.tierName} member price`, priceCents: memberPrice, member: true };
    }
  }

  const priceCents = chosen ? chosen.priceCents : experience.priceCents;
  const applied: AppliedExperience = {
    id: experience.id,
    name: experience.name,
    minutes,
    listPriceCents: experience.priceCents,
    priceCents,
    promo: chosen,
  };

  // Free play covers its pro-rata share of the flat price; kept exact over `minutes`.
  const denominator = BigInt(minutes);
  const subtotalExact = BigInt(priceCents) * BigInt(paidMinutes);
  const subtotalCents = roundHalfUp(subtotalExact, denominator);
  // The membership is already in the price above, so no percentage comes off it again (D82).
  const { totalCents, discount } = applyDiscount(subtotalExact, denominator, subtotalCents, undefined, referral);
  const gstCents = roundHalfUp(totalCents, 11n);

  const drafts: { startIndex: number; count: number; free: boolean; numerator: bigint }[] = [];
  if (freeMinutes > 0) drafts.push({ startIndex: 0, count: freeMinutes, free: true, numerator: 0n });
  if (paidMinutes > 0) drafts.push({ startIndex: freeMinutes, count: paidMinutes, free: false, numerator: subtotalExact });
  const allocated = allocateLargestRemainder(drafts.map((d) => d.numerator), denominator, subtotalCents);

  const segments: PriceSegment[] = drafts.map((d, i) => {
    const segStart = startAt + d.startIndex * MINUTE_MS;
    const segEnd = segStart + d.count * MINUTE_MS;
    return {
      kind: "experience" as const,
      startAt: segStart,
      endAt: segEnd,
      localStart: toLocal(segStart, timeZone).label,
      localEnd: toLocal(segEnd, timeZone).label,
      minutes: d.count,
      free: d.free,
      rateCents: 0,
      rateBandId: null,
      happyHourBp: 0,
      happyHourId: null,
      happyHourName: null,
      amountCents: Number(allocated[i]),
    };
  });

  const result: Omit<PriceResult, "explanation"> = {
    actualMinutes: minutes,
    billedMinutes: minutes,
    minimumApplied: false,
    freeMinutes,
    paidMinutes,
    segments,
    subtotalCents: Number(subtotalCents),
    discount,
    totalCents: Number(totalCents),
    gstCents: Number(gstCents),
    experience: applied,
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

  const exp = r.experience;
  if (exp) {
    lines.push(
      exp.promo
        ? `${exp.name} · ${exp.minutes} min · ${exp.promo.name} ${formatCents(exp.priceCents)} (normally ${formatCents(exp.listPriceCents)})`
        : `${exp.name} · ${exp.minutes} min · ${formatCents(exp.listPriceCents)}`,
    );
    for (const s of r.segments) {
      if (s.free) {
        lines.push(`${span(s)}  ${s.minutes} min free play (member balance)  ${formatCents(0)}`);
      } else if (r.freeMinutes > 0) {
        lines.push(`${span(s)}  ${s.minutes} of ${exp.minutes} min  ${formatCents(s.amountCents)}`);
      }
    }
    lines.push(`Subtotal  ${formatCents(r.subtotalCents)}`);
    if (r.discount) lines.push(`${r.discount.label}  ${formatCents(-r.discount.amountCents)}`);
    lines.push(`Total (incl. GST ${formatCents(r.gstCents)})  ${formatCents(r.totalCents)}`);
    return lines;
  }

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
