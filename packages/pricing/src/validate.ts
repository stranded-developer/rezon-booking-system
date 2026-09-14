import { isWallTime, parseWallTime } from "./time.js";
import type { HappyHour, IsoDayOfWeek, RateBand, ReferralDiscount, WallTime } from "./types.js";

export interface ValidationIssue {
  path: string;
  message: string;
}

interface WindowLike {
  id: string;
  daysOfWeek: IsoDayOfWeek[];
  startTime: WallTime;
  endTime: WallTime;
}

function checkWindow(w: WindowLike, path: string, issues: ValidationIssue[]): boolean {
  let ok = true;
  if (w.daysOfWeek.length === 0) {
    issues.push({ path: `${path}.daysOfWeek`, message: "Select at least one day" });
    ok = false;
  }
  if (w.daysOfWeek.some((d) => !Number.isInteger(d) || d < 1 || d > 7)) {
    issues.push({ path: `${path}.daysOfWeek`, message: "Days must be 1 (Mon) to 7 (Sun)" });
    ok = false;
  }
  if (new Set(w.daysOfWeek).size !== w.daysOfWeek.length) {
    issues.push({ path: `${path}.daysOfWeek`, message: "Duplicate day" });
    ok = false;
  }
  if (!isWallTime(w.startTime) || w.startTime === "24:00") {
    issues.push({ path: `${path}.startTime`, message: "Start time must be HH:MM between 00:00 and 23:59" });
    ok = false;
  }
  if (!isWallTime(w.endTime)) {
    issues.push({ path: `${path}.endTime`, message: "End time must be HH:MM between 00:01 and 24:00" });
    ok = false;
  }
  if (ok && parseWallTime(w.endTime) <= parseWallTime(w.startTime)) {
    issues.push({ path: `${path}.endTime`, message: "End time must be after start time" });
    ok = false;
  }
  return ok;
}

function overlaps(a: WindowLike, b: WindowLike): boolean {
  if (!a.daysOfWeek.some((d) => b.daysOfWeek.includes(d))) return false;
  return (
    parseWallTime(a.startTime) < parseWallTime(b.endTime) &&
    parseWallTime(b.startTime) < parseWallTime(a.endTime)
  );
}

function checkBp(value: number, path: string, issues: ValidationIssue[], allowZero: boolean): void {
  if (!Number.isInteger(value) || value < 0 || value >= 10_000 || (!allowZero && value === 0)) {
    issues.push({
      path,
      message: allowZero ? "Percentage must be 0% or more and less than 100%" : "Percentage must be more than 0% and less than 100%",
    });
  }
}

function checkCents(value: number, path: string, issues: ValidationIssue[], min: number): void {
  if (!Number.isInteger(value) || value < min) {
    issues.push({ path, message: min > 0 ? "Amount must be greater than $0.00" : "Amount cannot be negative" });
  }
}

export function validateRateBands(bands: RateBand[]): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const valid: RateBand[] = [];
  bands.forEach((band, i) => {
    const path = `rateBands[${i}]`;
    const windowOk = checkWindow(band, path, issues);
    checkCents(band.rateCents, `${path}.rateCents`, issues, 0);
    if (windowOk) valid.push(band);
  });
  for (let i = 0; i < valid.length; i++) {
    for (let j = i + 1; j < valid.length; j++) {
      const a = valid[i]!;
      const b = valid[j]!;
      if (a.resourceTypeId === b.resourceTypeId && overlaps(a, b)) {
        issues.push({ path: `rateBands.${b.id}`, message: `Overlaps rate band ${a.id}` });
      }
    }
  }
  return issues;
}

export function validateHappyHours(happyHours: HappyHour[]): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const valid: HappyHour[] = [];
  happyHours.forEach((hh, i) => {
    const path = `happyHours[${i}]`;
    if (!hh.name.trim()) issues.push({ path: `${path}.name`, message: "Name is required" });
    if (hh.resourceTypeIds !== null && hh.resourceTypeIds.length === 0) {
      issues.push({ path: `${path}.resourceTypeIds`, message: "Select at least one resource type, or all" });
    }
    checkBp(hh.discountBp, `${path}.discountBp`, issues, false);
    if (checkWindow(hh, path, issues)) valid.push(hh);
  });
  const sharesType = (a: HappyHour, b: HappyHour) =>
    a.resourceTypeIds === null ||
    b.resourceTypeIds === null ||
    a.resourceTypeIds.some((id) => b.resourceTypeIds!.includes(id));
  for (let i = 0; i < valid.length; i++) {
    for (let j = i + 1; j < valid.length; j++) {
      const a = valid[i]!;
      const b = valid[j]!;
      if (sharesType(a, b) && overlaps(a, b)) {
        issues.push({ path: `happyHours.${b.id}`, message: `Overlaps happy hour "${a.name}"` });
      }
    }
  }
  return issues;
}

export function validateReferral(referral: ReferralDiscount): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (referral.type === "percent") checkBp(referral.value, "value", issues, false);
  else checkCents(referral.value, "value", issues, 1);
  return issues;
}

export interface TierValues {
  name: string;
  discountBp: number;
  monthlyPriceCents: number;
  monthlyFreeMinutes: number;
  maxBalanceMinutes: number;
}

export function validateTier(tier: TierValues): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!tier.name.trim()) issues.push({ path: "name", message: "Name is required" });
  checkBp(tier.discountBp, "discountBp", issues, true);
  checkCents(tier.monthlyPriceCents, "monthlyPriceCents", issues, 0);
  if (!Number.isInteger(tier.monthlyFreeMinutes) || tier.monthlyFreeMinutes < 0) {
    issues.push({ path: "monthlyFreeMinutes", message: "Free minutes cannot be negative" });
  }
  if (!Number.isInteger(tier.maxBalanceMinutes) || tier.maxBalanceMinutes < 0) {
    issues.push({ path: "maxBalanceMinutes", message: "Balance cap cannot be negative" });
  }
  return issues;
}
