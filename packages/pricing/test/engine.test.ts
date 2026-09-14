import { describe, expect, it } from "vitest";
import { priceSession, PricingError } from "../src/index.js";
import type { RateBand } from "../src/index.js";
import { aest, base, billiard, diamond, gold, silver, sim, vr, weekdayHappyHour } from "./fixtures.js";

// Calendar reference: 2026-09-14 Mon, 16 Wed, 19 Sat, 20 Sun, 21 Mon.

describe("minimum and per-minute billing (spec D16)", () => {
  it("T1: 5 minutes played bills the 15-minute minimum", () => {
    const r = priceSession(base({ startAt: aest("2026-09-16T16:00:00"), endAt: aest("2026-09-16T16:05:00") }));
    expect(r.actualMinutes).toBe(5);
    expect(r.billedMinutes).toBe(15);
    expect(r.minimumApplied).toBe(true);
    expect(r.totalCents).toBe(7_50);
    expect(r.explanation[0]).toBe("Minimum 15 min charge (played 5 min)");
  });

  it("T2: exactly 15 minutes bills 15 minutes, no minimum line", () => {
    const r = priceSession(base({ startAt: aest("2026-09-16T16:00:00"), endAt: aest("2026-09-16T16:15:00") }));
    expect(r.billedMinutes).toBe(15);
    expect(r.minimumApplied).toBe(false);
    expect(r.totalCents).toBe(7_50);
  });

  it("T3: 16 min 10 s rounds up to 17 minutes", () => {
    const r = priceSession(base({ startAt: aest("2026-09-16T16:00:00"), endAt: aest("2026-09-16T16:16:10") }));
    expect(r.actualMinutes).toBe(17);
    expect(r.billedMinutes).toBe(17);
    expect(r.totalCents).toBe(8_50);
  });

  it("zero-length session still bills the minimum", () => {
    const t = aest("2026-09-16T16:00:00");
    const r = priceSession(base({ startAt: t, endAt: t }));
    expect(r.billedMinutes).toBe(15);
    expect(r.totalCents).toBe(7_50);
  });

  it("T18: overstay extension skips the minimum", () => {
    const r = priceSession(
      base({ startAt: aest("2026-09-19T16:00:00"), endAt: aest("2026-09-19T16:04:00"), applyMinimum: false }),
    );
    expect(r.billedMinutes).toBe(4);
    expect(r.totalCents).toBe(2_00);
  });
});

describe("happy hour and membership (spec D2, D24)", () => {
  it("T4: Gold member on a sim straddling the end of happy hour — the worked example", () => {
    const r = priceSession(
      base({
        resourceType: sim,
        startAt: aest("2026-09-16T14:30:00"),
        endAt: aest("2026-09-16T15:30:00"),
        member: gold,
      }),
    );
    expect(r.segments.map((s) => [s.localStart, s.localEnd, s.minutes, s.happyHourBp, s.amountCents])).toEqual([
      ["2026-09-16 14:30", "2026-09-16 15:00", 30, 1000, 27_00],
      ["2026-09-16 15:00", "2026-09-16 15:30", 30, 0, 30_00],
    ]);
    expect(r.subtotalCents).toBe(57_00);
    expect(r.discount).toMatchObject({ kind: "member", valueBp: 1000, amountCents: 5_70 });
    expect(r.totalCents).toBe(51_30);
    expect(r.gstCents).toBe(4_66);
    expect(r.explanation).toEqual([
      "14:30–15:00  30 min @ $60.00/hr − Happy Hour 10% = $54.00/hr  $27.00",
      "15:00–15:30  30 min @ $60.00/hr  $30.00",
      "Subtotal  $57.00",
      "Gold member 10%  −$5.70",
      "Total (incl. GST $4.66)  $51.30",
    ]);
  });

  it("T7: Saturday has no happy hour", () => {
    const r = priceSession(base({ startAt: aest("2026-09-19T11:00:00"), endAt: aest("2026-09-19T12:00:00") }));
    expect(r.segments).toHaveLength(1);
    expect(r.segments[0]!.happyHourBp).toBe(0);
    expect(r.totalCents).toBe(30_00);
  });

  it("happy hour window start is inclusive and end is exclusive", () => {
    const before = priceSession(base({ startAt: aest("2026-09-16T09:45:00"), endAt: aest("2026-09-16T10:15:00") }));
    expect(before.segments.map((s) => [s.minutes, s.happyHourBp])).toEqual([
      [15, 0],
      [15, 1000],
    ]);
    const after = priceSession(base({ startAt: aest("2026-09-16T14:45:00"), endAt: aest("2026-09-16T15:15:00") }));
    expect(after.segments.map((s) => [s.minutes, s.happyHourBp])).toEqual([
      [15, 1000],
      [15, 0],
    ]);
  });

  it("T17: a session starting mid-minute classifies each minute by its start instant", () => {
    const r = priceSession(base({ startAt: aest("2026-09-16T14:59:30"), endAt: aest("2026-09-16T15:15:30") }));
    expect(r.billedMinutes).toBe(16);
    expect(r.segments.map((s) => [s.minutes, s.happyHourBp, s.amountCents])).toEqual([
      [1, 1000, 45],
      [15, 0, 7_50],
    ]);
    expect(r.subtotalCents).toBe(7_95);
  });

  it("Diamond 15% applies multiplicatively after happy hour", () => {
    const r = priceSession(
      base({ startAt: aest("2026-09-14T10:00:00"), endAt: aest("2026-09-14T11:00:00"), member: diamond }),
    );
    // $30 × 0.9 = $27.00, × 0.85 = $22.95
    expect(r.totalCents).toBe(22_95);
  });

  it("happy hour limited to specific resource types does not apply to others", () => {
    const simOnly = { ...weekdayHappyHour, resourceTypeIds: ["sim"] };
    const table = priceSession(
      base({ startAt: aest("2026-09-16T11:00:00"), endAt: aest("2026-09-16T12:00:00"), happyHours: [simOnly] }),
    );
    expect(table.totalCents).toBe(30_00);
    const s = priceSession(
      base({
        resourceType: sim,
        startAt: aest("2026-09-16T11:00:00"),
        endAt: aest("2026-09-16T12:00:00"),
        happyHours: [simOnly],
      }),
    );
    expect(s.totalCents).toBe(54_00);
  });

  it("overlapping happy hours use the largest discount (defensive; validators prevent this)", () => {
    const bigger = { ...weekdayHappyHour, id: "hh-big", name: "Big", discountBp: 2500 };
    const r = priceSession(
      base({
        startAt: aest("2026-09-16T11:00:00"),
        endAt: aest("2026-09-16T12:00:00"),
        happyHours: [weekdayHappyHour, bigger],
      }),
    );
    expect(r.totalCents).toBe(22_50);
  });
});

describe("referral codes (spec D25)", () => {
  it("T5: fixed $5 code after happy hour", () => {
    const r = priceSession(
      base({
        startAt: aest("2026-09-16T11:00:00"),
        endAt: aest("2026-09-16T12:00:00"),
        referral: { code: "K7M2QX", type: "fixed", value: 5_00 },
      }),
    );
    expect(r.subtotalCents).toBe(27_00);
    expect(r.totalCents).toBe(22_00);
    expect(r.discount).toMatchObject({ kind: "referral_fixed", code: "K7M2QX", valueCents: 5_00, amountCents: 5_00 });
    expect(r.explanation).toContain("Referral K7M2QX $5.00 off  −$5.00");
  });

  it("T6: fixed code larger than the subtotal floors the total at $0", () => {
    const r = priceSession(
      base({
        startAt: aest("2026-09-16T11:00:00"),
        endAt: aest("2026-09-16T12:00:00"),
        referral: { code: "K7M2QX", type: "fixed", value: 30_00 },
      }),
    );
    expect(r.totalCents).toBe(0);
    expect(r.gstCents).toBe(0);
    expect(r.discount?.amountCents).toBe(27_00);
  });

  it("T19: percentage code stacks multiplicatively with happy hour", () => {
    const r = priceSession(
      base({
        startAt: aest("2026-09-16T11:00:00"),
        endAt: aest("2026-09-16T12:00:00"),
        referral: { code: "ABC234", type: "percent", value: 2000 },
      }),
    );
    expect(r.totalCents).toBe(21_60);
    expect(r.discount).toMatchObject({ kind: "referral_percent", valueBp: 2000, amountCents: 5_40 });
  });

  it("T10: membership and referral together are rejected", () => {
    expect(() =>
      priceSession(
        base({
          startAt: aest("2026-09-16T11:00:00"),
          endAt: aest("2026-09-16T12:00:00"),
          member: gold,
          referral: { code: "ABC234", type: "percent", value: 1000 },
        }),
      ),
    ).toThrow(PricingError);
  });
});

describe("free-play balance (spec D15, D22)", () => {
  it("T8: free minutes cover the start; the rest is priced and discounted", () => {
    const r = priceSession(
      base({
        resourceType: sim,
        startAt: aest("2026-09-14T10:00:00"),
        endAt: aest("2026-09-14T11:00:00"),
        member: silver,
        freeMinutes: 45,
      }),
    );
    expect(r.freeMinutes).toBe(45);
    expect(r.paidMinutes).toBe(15);
    expect(r.segments.map((s) => [s.localStart.slice(11), s.localEnd.slice(11), s.free, s.amountCents])).toEqual([
      ["10:00", "10:45", true, 0],
      ["10:45", "11:00", false, 13_50],
    ]);
    // $13.50 × 0.95 = $12.825 → half up → $12.83
    expect(r.totalCents).toBe(12_83);
    expect(r.discount?.amountCents).toBe(67);
    expect(r.explanation[0]).toBe("10:00–10:45  45 min free play (member balance)  $0.00");
  });

  it("T9: more free minutes than billed minutes are clamped and the total is $0", () => {
    const r = priceSession(
      base({ startAt: aest("2026-09-16T16:00:00"), endAt: aest("2026-09-16T17:00:00"), member: gold, freeMinutes: 90 }),
    );
    expect(r.freeMinutes).toBe(60);
    expect(r.paidMinutes).toBe(0);
    expect(r.totalCents).toBe(0);
    expect(r.gstCents).toBe(0);
  });

  it("free minutes apply to the notional minimum period", () => {
    const r = priceSession(
      base({ startAt: aest("2026-09-16T16:00:00"), endAt: aest("2026-09-16T16:05:00"), member: gold, freeMinutes: 10 }),
    );
    expect(r.billedMinutes).toBe(15);
    expect(r.paidMinutes).toBe(5);
    expect(r.totalCents).toBe(2_25); // 5 min @ $30/hr = $2.50, −10%
  });

  it("free minutes without a member are rejected", () => {
    expect(() =>
      priceSession(base({ startAt: aest("2026-09-16T16:00:00"), endAt: aest("2026-09-16T17:00:00"), freeMinutes: 10 })),
    ).toThrow(PricingError);
  });
});

describe("rate bands", () => {
  const saturdayTables: RateBand = {
    id: "band-sat",
    resourceTypeId: "billiard",
    daysOfWeek: [6],
    startTime: "00:00",
    endTime: "24:00",
    rateCents: 40_00,
  };

  it("T16: a Saturday band overrides the base rate; weekdays use base + happy hour", () => {
    const sat = priceSession(
      base({ startAt: aest("2026-09-19T11:00:00"), endAt: aest("2026-09-19T12:00:00"), rateBands: [saturdayTables] }),
    );
    expect(sat.totalCents).toBe(40_00);
    expect(sat.segments[0]!.rateBandId).toBe("band-sat");
    const wed = priceSession(
      base({ startAt: aest("2026-09-16T11:00:00"), endAt: aest("2026-09-16T12:00:00"), rateBands: [saturdayTables] }),
    );
    expect(wed.totalCents).toBe(27_00);
  });

  it("bands for another resource type are ignored", () => {
    const r = priceSession(
      base({
        resourceType: sim,
        startAt: aest("2026-09-19T11:00:00"),
        endAt: aest("2026-09-19T12:00:00"),
        rateBands: [saturdayTables],
      }),
    );
    expect(r.totalCents).toBe(60_00);
  });

  it("T13: session crossing midnight Sunday → Monday picks up the Monday band", () => {
    const monday: RateBand = { ...saturdayTables, id: "band-mon", daysOfWeek: [1] };
    const r = priceSession(
      base({ startAt: aest("2026-09-20T23:30:00"), endAt: aest("2026-09-21T00:30:00"), rateBands: [monday] }),
    );
    expect(r.segments.map((s) => [s.localStart, s.minutes, s.rateCents])).toEqual([
      ["2026-09-20 23:30", 30, 30_00],
      ["2026-09-21 00:00", 30, 40_00],
    ]);
    expect(r.totalCents).toBe(35_00);
    expect(r.explanation[0]).toBe("2026-09-20 23:30–00:00  30 min @ $30.00/hr  $15.00");
  });
});

describe("daylight saving (spec D5)", () => {
  const sundayEarlyBand: RateBand = {
    id: "band-2am",
    resourceTypeId: "billiard",
    daysOfWeek: [7],
    startTime: "02:00",
    endTime: "03:00",
    rateCents: 90_00,
  };

  it("T14: DST starts 2026-10-04 — 01:30→03:30 local is 60 real minutes, the skipped hour never bills", () => {
    const startAt = Date.parse("2026-10-03T15:30:00Z"); // 01:30 AEST
    const endAt = Date.parse("2026-10-03T16:30:00Z"); // 03:30 AEDT
    const r = priceSession(base({ startAt, endAt, rateBands: [sundayEarlyBand] }));
    expect(r.billedMinutes).toBe(60);
    expect(r.segments.every((s) => s.minutes > 0)).toBe(true);
    expect(r.segments.some((s) => s.rateBandId === "band-2am")).toBe(false);
    expect(r.segments.map((s) => [s.localStart, s.localEnd, s.minutes])).toEqual([
      ["2026-10-04 01:30", "2026-10-04 03:30", 60],
    ]);
    expect(r.totalCents).toBe(30_00);
  });

  it("T15: DST ends 2026-04-05 — 01:30→03:30 local is 180 real minutes, the repeated hour bills twice", () => {
    const startAt = Date.parse("2026-04-04T14:30:00Z"); // 01:30 AEDT
    const endAt = Date.parse("2026-04-04T17:30:00Z"); // 03:30 AEST
    const r = priceSession(base({ startAt, endAt, rateBands: [sundayEarlyBand] }));
    expect(r.billedMinutes).toBe(180);
    expect(r.segments.map((s) => [s.localStart, s.localEnd, s.minutes, s.rateCents])).toEqual([
      ["2026-04-05 01:30", "2026-04-05 02:00", 30, 30_00],
      ["2026-04-05 02:00", "2026-04-05 03:00", 120, 90_00],
      ["2026-04-05 03:00", "2026-04-05 03:30", 30, 30_00],
    ]);
    expect(r.totalCents).toBe(15_00 + 180_00 + 15_00);
  });
});

describe("rounding and allocation (spec pricing §5)", () => {
  it("T11: one VR minute at $50/hr rounds $0.8333 to $0.83", () => {
    const r = priceSession(
      base({
        resourceType: vr,
        startAt: aest("2026-09-19T11:00:00"),
        endAt: aest("2026-09-19T11:01:00"),
        applyMinimum: false,
      }),
    );
    expect(r.totalCents).toBe(83);
    expect(r.gstCents).toBe(8);
  });

  it("T12: segments of thirds of a cent are allocated so they sum exactly to the subtotal", () => {
    const bands: RateBand[] = [
      { id: "a", resourceTypeId: "vr", daysOfWeek: [6], startTime: "11:01", endTime: "11:02", rateCents: 50_00 },
      { id: "b", resourceTypeId: "vr", daysOfWeek: [6], startTime: "11:02", endTime: "11:03", rateCents: 50_00 },
    ];
    const r = priceSession(
      base({
        resourceType: vr,
        startAt: aest("2026-09-19T11:00:00"),
        endAt: aest("2026-09-19T11:03:00"),
        rateBands: bands,
        applyMinimum: false,
      }),
    );
    expect(r.segments.map((s) => s.amountCents)).toEqual([84, 83, 83]);
    expect(r.subtotalCents).toBe(2_50);
  });

  it("a partial minute bills a whole minute and GST rounds to the cent", () => {
    // Half-up rounding of a total is covered by T8 ($12.825 → $12.83).
    const r = priceSession(
      base({
        startAt: aest("2026-09-19T11:00:00"),
        endAt: aest("2026-09-19T11:01:06"),
        applyMinimum: false,
      }),
    );
    // 2 min @ $30/hr = $1.00 → GST 9.09c → 9c
    expect(r.totalCents).toBe(1_00);
    expect(r.gstCents).toBe(9);
  });
});

describe("input validation", () => {
  const ok = { startAt: aest("2026-09-16T16:00:00"), endAt: aest("2026-09-16T17:00:00") };

  it.each([
    ["end before start", base({ startAt: ok.endAt, endAt: ok.startAt })],
    ["unknown time zone", base({ ...ok, timeZone: "Mars/Olympus" })],
    ["100% member discount", base({ ...ok, member: { tierName: "X", discountBp: 10_000 } })],
    ["negative member discount", base({ ...ok, member: { tierName: "X", discountBp: -1 } })],
    ["0% referral", base({ ...ok, referral: { code: "A", type: "percent", value: 0 } })],
    ["$0 fixed referral", base({ ...ok, referral: { code: "A", type: "fixed", value: 0 } })],
    ["fractional cents referral", base({ ...ok, referral: { code: "A", type: "fixed", value: 1.5 } })],
    ["bad happy hour time", base({ ...ok, happyHours: [{ ...weekdayHappyHour, startTime: "9am" }] })],
    ["negative base rate", base({ ...ok, resourceType: { ...billiard, baseRateCents: -1 } })],
    ["zero minimum", base({ ...ok, resourceType: { ...billiard, minMinutes: 0 } })],
    ["negative free minutes", base({ ...ok, member: gold, freeMinutes: -5 })],
  ])("rejects %s", (_name, input) => {
    expect(() => priceSession(input)).toThrow(PricingError);
  });

  it("accepts a 0% member tier", () => {
    const r = priceSession(base({ ...ok, member: { tierName: "Free", discountBp: 0 } }));
    expect(r.totalCents).toBe(30_00);
    expect(r.discount?.amountCents).toBe(0);
  });
});

describe("invariants over randomised sessions", () => {
  // Deterministic PRNG so failures are reproducible.
  function mulberry32(seed: number) {
    return () => {
      seed |= 0;
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // ~660k minute evaluations: ~2.5 s alone, 12–15 s when the whole monorepo is testing in parallel.
  it("holds for 2,000 random sessions", { timeout: 60_000 }, () => {
    const rand = mulberry32(20260914);
    const types = [billiard, sim, vr];
    const yearStart = Date.parse("2026-01-01T00:00:00Z");
    for (let n = 0; n < 2000; n++) {
      const resourceType = types[Math.floor(rand() * 3)]!;
      const startAt = yearStart + Math.floor(rand() * 365 * 24 * 60) * 60_000 + Math.floor(rand() * 60_000);
      const endAt = startAt + Math.floor(rand() * 11 * 60 * 60_000);
      const pick = rand();
      const member = pick < 0.33 ? [silver, gold, diamond][Math.floor(rand() * 3)]! : undefined;
      const referral =
        pick >= 0.33 && pick < 0.5
          ? ({ code: "R", type: "percent", value: 1 + Math.floor(rand() * 9998) } as const)
          : pick >= 0.5 && pick < 0.66
            ? ({ code: "R", type: "fixed", value: 1 + Math.floor(rand() * 10_000) } as const)
            : undefined;
      const input = base({
        resourceType,
        startAt,
        endAt,
        ...(member ? { member, freeMinutes: Math.floor(rand() * 120) } : {}),
        ...(referral ? { referral } : {}),
      });
      const r = priceSession(input);

      expect(r.segments.reduce((a, s) => a + s.minutes, 0)).toBe(r.billedMinutes);
      expect(r.segments.reduce((a, s) => a + s.amountCents, 0)).toBe(r.subtotalCents);
      expect(r.billedMinutes).toBeGreaterThanOrEqual(resourceType.minMinutes);
      expect(r.freeMinutes + r.paidMinutes).toBe(r.billedMinutes);
      expect(r.totalCents).toBeGreaterThanOrEqual(0);
      expect(r.totalCents).toBeLessThanOrEqual(r.subtotalCents);
      expect(r.discount ? r.discount.amountCents : 0).toBe(r.subtotalCents - r.totalCents);
      expect(r.gstCents).toBe(Math.floor(r.totalCents / 11 + 0.5));
      // Subtotal matches a straightforward float recomputation within a cent.
      const floatSubtotal = r.segments
        .filter((s) => !s.free)
        .reduce((a, s) => a + (s.minutes * s.rateCents * (1 - s.happyHourBp / 10_000)) / 60, 0);
      expect(Math.abs(floatSubtotal - r.subtotalCents)).toBeLessThanOrEqual(0.5 + 1e-6);
    }
  });
});
