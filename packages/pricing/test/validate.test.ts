import { describe, expect, it } from "vitest";
import { validateHappyHours, validateRateBands, validateReferral, validateTier } from "../src/index.js";
import type { HappyHour, RateBand } from "../src/index.js";
import { weekdayHappyHour } from "./fixtures.js";

const band = (overrides: Partial<RateBand>): RateBand => ({
  id: "b1",
  resourceTypeId: "billiard",
  daysOfWeek: [6],
  startTime: "10:00",
  endTime: "14:00",
  rateCents: 40_00,
  ...overrides,
});

describe("T20: validateRateBands", () => {
  it("accepts non-overlapping and adjacent bands", () => {
    expect(
      validateRateBands([band({}), band({ id: "b2", startTime: "14:00", endTime: "21:00" })]),
    ).toEqual([]);
  });

  it("accepts the same window on different resource types or days", () => {
    expect(validateRateBands([band({}), band({ id: "b2", resourceTypeId: "sim" })])).toEqual([]);
    expect(validateRateBands([band({}), band({ id: "b2", daysOfWeek: [7] })])).toEqual([]);
  });

  it("rejects overlap on a shared day and type", () => {
    const issues = validateRateBands([
      band({ daysOfWeek: [5, 6] }),
      band({ id: "b2", daysOfWeek: [6, 7], startTime: "13:59", endTime: "15:00" }),
    ]);
    expect(issues).toEqual([{ path: "rateBands.b2", message: "Overlaps rate band b1" }]);
  });

  it.each([
    ["end before start", band({ startTime: "14:00", endTime: "10:00" })],
    ["equal start and end", band({ startTime: "10:00", endTime: "10:00" })],
    ["bad time format", band({ startTime: "9:00" })],
    ["24:00 start", band({ startTime: "24:00" })],
    ["no days", band({ daysOfWeek: [] })],
    ["day 8", band({ daysOfWeek: [8 as 1] })],
    ["negative rate", band({ rateCents: -100 })],
    ["fractional rate", band({ rateCents: 10.5 })],
  ])("rejects %s", (_name, b) => {
    expect(validateRateBands([b]).length).toBeGreaterThan(0);
  });
});

describe("T20: validateHappyHours", () => {
  const hh = (overrides: Partial<HappyHour>): HappyHour => ({ ...weekdayHappyHour, ...overrides });

  it("accepts the launch happy hour", () => {
    expect(validateHappyHours([weekdayHappyHour])).toEqual([]);
  });

  it("rejects overlap when one applies to all types", () => {
    const issues = validateHappyHours([
      hh({}),
      hh({ id: "hh2", name: "Sim lunch", resourceTypeIds: ["sim"], startTime: "12:00", endTime: "13:00" }),
    ]);
    expect(issues).toEqual([{ path: "happyHours.hh2", message: 'Overlaps happy hour "Happy Hour"' }]);
  });

  it("accepts overlapping windows on disjoint resource types", () => {
    expect(
      validateHappyHours([
        hh({ resourceTypeIds: ["billiard"] }),
        hh({ id: "hh2", resourceTypeIds: ["sim", "vr"] }),
      ]),
    ).toEqual([]);
  });

  it.each([
    ["0%", hh({ discountBp: 0 })],
    ["100%", hh({ discountBp: 10_000 })],
    ["empty name", hh({ name: "  " })],
    ["empty type list", hh({ resourceTypeIds: [] })],
    ["end before start", hh({ startTime: "15:00", endTime: "10:00" })],
  ])("rejects %s", (_name, h) => {
    expect(validateHappyHours([h]).length).toBeGreaterThan(0);
  });
});

describe("T20: validateReferral", () => {
  it("accepts valid percent and fixed codes", () => {
    expect(validateReferral({ code: "ABC234", type: "percent", value: 1000 })).toEqual([]);
    expect(validateReferral({ code: "ABC234", type: "fixed", value: 5_00 })).toEqual([]);
  });

  it.each([
    ["0%", { code: "A", type: "percent", value: 0 } as const],
    ["100%", { code: "A", type: "percent", value: 10_000 } as const],
    ["$0", { code: "A", type: "fixed", value: 0 } as const],
    ["negative $", { code: "A", type: "fixed", value: -5 } as const],
  ])("rejects %s", (_name, r) => {
    expect(validateReferral(r).length).toBeGreaterThan(0);
  });
});

describe("T20: validateTier", () => {
  const silver = { name: "Silver", discountBp: 500, monthlyPriceCents: 100_00, monthlyFreeMinutes: 60, maxBalanceMinutes: 600 };

  it("accepts launch tiers", () => {
    expect(validateTier(silver)).toEqual([]);
    expect(validateTier({ ...silver, name: "Diamond", discountBp: 1500, monthlyPriceCents: 300_00 })).toEqual([]);
  });

  it.each([
    ["100% discount", { ...silver, discountBp: 10_000 }],
    ["negative price", { ...silver, monthlyPriceCents: -1 }],
    ["negative allowance", { ...silver, monthlyFreeMinutes: -1 }],
    ["negative cap", { ...silver, maxBalanceMinutes: -1 }],
    ["blank name", { ...silver, name: "" }],
  ])("rejects %s", (_name, t) => {
    expect(validateTier(t).length).toBeGreaterThan(0);
  });
});
