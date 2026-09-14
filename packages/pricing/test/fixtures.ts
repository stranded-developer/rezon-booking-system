import type { HappyHour, PriceSessionInput, ResourceTypePricing } from "../src/index.js";

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

export const silver = { tierName: "Silver", discountBp: 500 };
export const gold = { tierName: "Gold", discountBp: 1000 };
export const diamond = { tierName: "Diamond", discountBp: 1500 };

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
