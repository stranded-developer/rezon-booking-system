import { describe, expect, it } from "vitest";
import { PricingError, priceExperience } from "../src/index.js";
import {
  aest,
  allPromos,
  doubleRace,
  experience,
  gold,
  happyHourPrices,
  quickRace,
  silver,
  studentPrices,
} from "./fixtures.js";

/**
 * Experiences: a fixed length at a flat price (D65), with flat promotional prices (D66).
 * Dollar values are the launch configuration from spec/README.md.
 */
describe("priceExperience — the list price", () => {
  it("X1 charges the flat price, whatever the length works out to per hour", () => {
    // 30 minutes for $35 is $70/hr; the sim's hourly rate ($60) is not involved at all.
    const r = priceExperience(experience({ startAt: aest("2026-09-16T16:00") }));
    expect(r.subtotalCents).toBe(35_00);
    expect(r.totalCents).toBe(35_00);
    expect(r.billedMinutes).toBe(30);
    expect(r.experience).toEqual({
      id: "exp-quick",
      name: "Quick Race",
      minutes: 30,
      listPriceCents: 35_00,
      priceCents: 35_00,
      promo: null,
    });
  });

  it("X2 prices the longer package below two short ones", () => {
    const r = priceExperience(experience({ startAt: aest("2026-09-16T16:00"), experience: doubleRace }));
    expect(r.totalCents).toBe(58_00);
    expect(r.billedMinutes).toBe(60);
    expect(r.gstCents).toBe(527); // 5800 / 11 = 527.27 → 527
  });

  it("X3 never applies the resource type's minimum: the length is fixed", () => {
    const r = priceExperience(experience({ startAt: aest("2026-09-16T16:00") }));
    expect(r.minimumApplied).toBe(false);
    expect(r.actualMinutes).toBe(30);
  });
});

describe("priceExperience — promotional prices", () => {
  it("X4 uses the Happy Hour price inside its window", () => {
    const r = priceExperience(experience({ startAt: aest("2026-09-16T13:00") }));
    expect(r.totalCents).toBe(29_00);
    expect(r.experience?.promo).toEqual({ id: "hp-quick", name: "Happy Hour", priceCents: 29_00 });
  });

  it("X5 decides on the start time, so a Double Race started at 14:30 is still Happy Hour", () => {
    const r = priceExperience(
      experience({ startAt: aest("2026-09-16T14:30"), experience: doubleRace }),
    );
    expect(r.totalCents).toBe(49_00);
  });

  it("X6 charges the list price one minute after the window closes", () => {
    const r = priceExperience(experience({ startAt: aest("2026-09-16T15:00") }));
    expect(r.totalCents).toBe(35_00);
    expect(r.experience?.promo).toBeNull();
  });

  it("X7 ignores a claimed promotion unless the customer asks for it", () => {
    const at = aest("2026-09-16T16:00");
    expect(priceExperience(experience({ startAt: at })).totalCents).toBe(35_00);
    expect(
      priceExperience(experience({ startAt: at, claimedPromoIds: ["st-quick"] })).totalCents,
    ).toBe(32_00);
  });

  it("X8 gives the cheapest promotion, so the student price is not included in Happy Hour", () => {
    const r = priceExperience(
      experience({ startAt: aest("2026-09-16T13:00"), claimedPromoIds: ["st-quick"] }),
    );
    expect(r.totalCents).toBe(29_00);
    expect(r.experience?.promo?.name).toBe("Happy Hour");
  });

  it("X8b picks the cheapest whichever order the promotions arrive in", () => {
    const at = aest("2026-09-16T13:00");
    const forwards = priceExperience(experience({ startAt: at, promos: allPromos, claimedPromoIds: ["st-quick"] }));
    const backwards = priceExperience(experience({ startAt: at, promos: [...allPromos].reverse(), claimedPromoIds: ["st-quick"] }));
    expect(forwards.totalCents).toBe(29_00);
    expect(backwards.totalCents).toBe(29_00);
    expect(backwards.experience?.promo?.name).toBe("Happy Hour");
  });

  it("X9 ignores a promotion belonging to another experience", () => {
    const r = priceExperience(
      experience({
        startAt: aest("2026-09-16T13:00"),
        experience: doubleRace,
        promos: happyHourPrices.filter((p) => p.experienceId === "exp-quick"),
      }),
    );
    expect(r.totalCents).toBe(58_00);
  });
});

describe("priceExperience — member, referral and free play", () => {
  it("X10 applies the member percentage to the list price", () => {
    // Gold 20% off a $35 Quick Race = $28.00, exactly the owner's member price.
    const r = priceExperience(
      experience({ startAt: aest("2026-09-16T16:00"), member: { tierName: "Gold", discountBp: 2000 } }),
    );
    expect(r.subtotalCents).toBe(35_00);
    expect(r.totalCents).toBe(28_00);
    expect(r.discount).toEqual({ kind: "member", label: "Gold member 20%", valueBp: 2000, amountCents: 700 });
  });

  it("X11 rounds a member price half up", () => {
    // Silver 10% off $35.00 is $31.50, not the $32 on the marketing list (D67).
    const r = priceExperience(experience({ startAt: aest("2026-09-16T16:00"), member: silver }));
    expect(r.totalCents).toBe(31_50);
    // Gold 20% off the $58 Double Race is $46.40, not the listed $46.
    const d = priceExperience(
      experience({ startAt: aest("2026-09-16T16:00"), experience: doubleRace, member: gold }),
    );
    expect(d.totalCents).toBe(46_40);
  });

  it("X12 stacks a membership on top of a Happy Hour price", () => {
    const r = priceExperience(
      experience({ startAt: aest("2026-09-16T13:00"), member: { tierName: "Gold", discountBp: 2000 } }),
    );
    expect(r.subtotalCents).toBe(29_00);
    expect(r.totalCents).toBe(23_20);
  });

  it("X13 spends free play pro rata on a flat price", () => {
    const r = priceExperience(
      experience({
        startAt: aest("2026-09-16T16:00"),
        experience: doubleRace,
        member: { tierName: "Gold", discountBp: 0 },
        freeMinutes: 30,
      }),
    );
    expect(r.freeMinutes).toBe(30);
    expect(r.paidMinutes).toBe(30);
    expect(r.subtotalCents).toBe(29_00);
    expect(r.totalCents).toBe(29_00);
    expect(r.segments.map((s) => [s.minutes, s.free, s.amountCents])).toEqual([
      [30, true, 0],
      [30, false, 29_00],
    ]);
  });

  it("X14 covers the whole price when free play covers the whole length", () => {
    const r = priceExperience(
      experience({ startAt: aest("2026-09-16T16:00"), member: gold, freeMinutes: 30 }),
    );
    expect(r.totalCents).toBe(0);
    expect(r.gstCents).toBe(0);
    expect(r.segments).toHaveLength(1);
  });

  it("X15 caps free play at the experience's length", () => {
    const r = priceExperience(
      experience({ startAt: aest("2026-09-16T16:00"), member: gold, freeMinutes: 120 }),
    );
    expect(r.freeMinutes).toBe(30);
    expect(r.totalCents).toBe(0);
  });

  it("X16 takes a fixed referral off the flat price and floors at zero", () => {
    const at = aest("2026-09-16T16:00");
    const five = priceExperience(
      experience({ startAt: at, referral: { code: "ABC234", type: "fixed", value: 5_00 } }),
    );
    expect(five.totalCents).toBe(30_00);
    const huge = priceExperience(
      experience({ startAt: at, referral: { code: "ABC234", type: "fixed", value: 99_00 } }),
    );
    expect(huge.totalCents).toBe(0);
  });

  it("X17 segment amounts always add up to the subtotal", () => {
    // $35 over 30 minutes, 10 free: the paid part is the whole subtotal, the free part zero.
    const r = priceExperience(
      experience({ startAt: aest("2026-09-16T16:00"), member: gold, freeMinutes: 10 }),
    );
    expect(r.segments.reduce((a, s) => a + s.amountCents, 0)).toBe(r.subtotalCents);
  });

  it("X18 refuses a membership and a referral together, like every other price", () => {
    expect(() =>
      priceExperience(
        experience({
          startAt: aest("2026-09-16T16:00"),
          member: gold,
          referral: { code: "ABC234", type: "percent", value: 1000 },
        }),
      ),
    ).toThrow(PricingError);
  });

  it("X19 refuses free play without a membership", () => {
    expect(() => priceExperience(experience({ startAt: aest("2026-09-16T16:00"), freeMinutes: 30 }))).toThrow(
      PricingError,
    );
  });
});

describe("priceExperience — what the customer reads", () => {
  it("X20 names the experience, the promotion and the free play", () => {
    const r = priceExperience(
      experience({
        startAt: aest("2026-09-16T13:00"),
        experience: doubleRace,
        promos: allPromos,
        member: { tierName: "Gold", discountBp: 2000 },
        freeMinutes: 30,
      }),
    );
    expect(r.explanation).toEqual([
      "Double Race · 60 min · Happy Hour $49.00 (normally $58.00)",
      "13:00–13:30  30 min free play (member balance)  $0.00",
      "13:30–14:00  30 of 60 min  $24.50",
      "Subtotal  $24.50",
      "Gold member 20%  −$4.90",
      "Total (incl. GST $1.78)  $19.60",
    ]);
  });

  it("X21 says only what matters when nothing is free and nothing is discounted", () => {
    const r = priceExperience(experience({ startAt: aest("2026-09-16T16:00"), promos: studentPrices }));
    expect(r.explanation).toEqual([
      "Quick Race · 30 min · $35.00",
      "Subtotal  $35.00",
      "Total (incl. GST $3.18)  $35.00",
    ]);
  });

  it("X22 marks its segments as experience segments, not time segments", () => {
    const r = priceExperience(experience({ startAt: aest("2026-09-16T16:00"), experience: quickRace }));
    expect(r.segments.every((s) => s.kind === "experience")).toBe(true);
  });
});
