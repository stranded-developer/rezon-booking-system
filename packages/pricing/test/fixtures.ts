import type {
  ExperiencePricing,
  ExperiencePromo,
  HappyHour,
  PriceExperienceInput,
  PriceSessionInput,
  ResourceTypePricing,
} from "../src/index.js";

export const TZ = "Australia/Sydney";

/** Launch configuration from spec/README.md. */
export const billiard: ResourceTypePricing = { id: "billiard", baseRateCents: 30_00, minMinutes: 15 };
export const sim: ResourceTypePricing = { id: "sim", baseRateCents: 60_00, minMinutes: 15 };
export const vr: ResourceTypePricing = { id: "vr", baseRateCents: 50_00, minMinutes: 15 };

export const weekdayHappyHour: HappyHour = {
  id: "hh-weekday",
  name: "Happy Hour",
  resourceTypeIds: null,
  daysOfWeek: [1, 2, 3, 4, 5],
  startTime: "10:00",
  endTime: "15:00",
  discountBp: 1000,
};

export const silver = { tierName: "Silver", discountBp: 1000 };
export const gold = { tierName: "Gold", discountBp: 2000 };
export const diamond = { tierName: "Diamond", discountBp: 2000 };

/**
 * Sydney local time during AEST (UTC+10) → epoch ms.
 * Only for dates between 2026-04-05 03:00 and 2026-10-04 02:00, when no DST applies.
 */
export function aest(local: string): number {
  const ms = Date.parse(`${local}+10:00`);
  if (Number.isNaN(ms)) throw new Error(`Bad fixture time ${local}`);
  return ms;
}

export function base(overrides: Partial<PriceSessionInput> & Pick<PriceSessionInput, "startAt" | "endAt">): PriceSessionInput {
  return {
    timeZone: TZ,
    resourceType: billiard,
    rateBands: [],
    happyHours: [weekdayHappyHour],
    ...overrides,
  };
}

// ── Experiences (D65, D66): launch values from spec/README.md ───────────────

export const quickRace: ExperiencePricing = {
  id: "exp-quick",
  name: "Quick Race",
  resourceTypeId: "sim",
  minutes: 30,
  priceCents: 35_00,
};

export const doubleRace: ExperiencePricing = {
  id: "exp-double",
  name: "Double Race",
  resourceTypeId: "sim",
  minutes: 60,
  priceCents: 58_00,
};

/** Every day 12:00–15:00, applied automatically. */
export const happyHourPrices: ExperiencePromo[] = [
  { id: "hp-quick", name: "Happy Hour", experienceId: "exp-quick", daysOfWeek: [1, 2, 3, 4, 5, 6, 7], startTime: "12:00", endTime: "15:00", priceCents: 29_00, claimed: false },
  { id: "hp-double", name: "Happy Hour", experienceId: "exp-double", daysOfWeek: [1, 2, 3, 4, 5, 6, 7], startTime: "12:00", endTime: "15:00", priceCents: 49_00, claimed: false },
];

/** All hours, but only when the customer asks for it. */
export const studentPrices: ExperiencePromo[] = [
  { id: "st-quick", name: "Student", experienceId: "exp-quick", daysOfWeek: [1, 2, 3, 4, 5, 6, 7], startTime: "00:00", endTime: "24:00", priceCents: 32_00, claimed: true },
  { id: "st-double", name: "Student", experienceId: "exp-double", daysOfWeek: [1, 2, 3, 4, 5, 6, 7], startTime: "00:00", endTime: "24:00", priceCents: 52_00, claimed: true },
];

export const allPromos: ExperiencePromo[] = [...happyHourPrices, ...studentPrices];

export function experience(
  overrides: Partial<PriceExperienceInput> & Pick<PriceExperienceInput, "startAt">,
): PriceExperienceInput {
  return {
    timeZone: TZ,
    experience: quickRace,
    promos: allPromos,
    ...overrides,
  };
}
