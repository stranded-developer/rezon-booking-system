import { describe, expect, it } from "vitest";
import { PricingError, priceExperience, splitIntoPackages } from "../src/index.js";
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
      partySize: 1,
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
  it("X10 charges a member their tier's own flat price (D82)", () => {
    const r = priceExperience(
      experience({ startAt: aest("2026-09-16T16:00"), member: gold, memberPriceCents: 28_00 }),
    );
    expect(r.subtotalCents).toBe(28_00);
    expect(r.totalCents).toBe(28_00);
    // The membership is in the price itself, so nothing is taken off again.
    expect(r.discount).toBeNull();
    expect(r.experience?.promo).toEqual({ id: "member:Gold", name: "Gold member price", priceCents: 28_00, member: true });
  });

  it("X11 uses the poster's prices exactly, not a percentage of the list price", () => {
    // Silver 10% of $35 would be $31.50; the poster says $32 (D82).
    const r = priceExperience(experience({ startAt: aest("2026-09-16T16:00"), member: silver, memberPriceCents: 32_00 }));
    expect(r.totalCents).toBe(32_00);
    // Gold 20% of $58 would be $46.40; the poster says $46.
    const d = priceExperience(
      experience({ startAt: aest("2026-09-16T16:00"), experience: doubleRace, member: gold, memberPriceCents: 46_00 }),
    );
    expect(d.totalCents).toBe(46_00);
  });

  it("X11b falls back to the tier's percentage off the list price when the tier has no flat price", () => {
    const r = priceExperience(experience({ startAt: aest("2026-09-16T16:00"), member: silver }));
    expect(r.totalCents).toBe(31_50);
    expect(r.discount).toBeNull();
    expect(r.experience?.promo?.member).toBe(true);
  });

  it("X12 never stacks a member price on a promotion: the cheapest wins (D82)", () => {
    const happyHour = aest("2026-09-16T13:00");
    // Gold's $28 beats Happy Hour's $29 — and is not $29 less 20%.
    const gold13 = priceExperience(experience({ startAt: happyHour, member: gold, memberPriceCents: 28_00 }));
    expect(gold13.totalCents).toBe(28_00);
    expect(gold13.experience?.promo?.name).toBe("Gold member price");
    // Silver's $32 loses to Happy Hour's $29, which Silver then pays in full.
    const silver13 = priceExperience(experience({ startAt: happyHour, member: silver, memberPriceCents: 32_00 }));
    expect(silver13.totalCents).toBe(29_00);
    expect(silver13.experience?.promo?.name).toBe("Happy Hour");
    expect(silver13.discount).toBeNull();
  });

  it("X12b calls a tie for the member price, and the percentage never comes off a promotion", () => {
    // Silver's $32 and the Student $32: the same money, shown as the member price.
    const tie = priceExperience(
      experience({ startAt: aest("2026-09-16T16:00"), member: silver, memberPriceCents: 32_00, claimedPromoIds: ["st-quick"] }),
    );
    expect(tie.totalCents).toBe(32_00);
    expect(tie.experience?.promo?.member).toBe(true);
    // Before D82 this was $29 less 20% = $23.20.
    const noStack = priceExperience(experience({ startAt: aest("2026-09-16T13:00"), member: gold }));
    expect(noStack.totalCents).toBe(28_00);
  });

  it("X12c refuses a member price that is not whole cents", () => {
    expect(() =>
      priceExperience(experience({ startAt: aest("2026-09-16T16:00"), member: gold, memberPriceCents: 28.5 })),
    ).toThrow(PricingError);
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
        memberPriceCents: 46_00,
        freeMinutes: 30,
      }),
    );
    // The member's $46 beats Happy Hour's $49, and says so; no discount line follows (D82).
    expect(r.explanation).toEqual([
      "Double Race · 60 min · Gold member price $46.00 (normally $58.00)",
      "13:00–13:30  30 min free play (member balance)  $0.00",
      "13:30–14:00  30 of 60 min  $23.00",
      "Subtotal  $23.00",
      "Total (incl. GST $2.09)  $23.00",
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

/** D106: several people, each on their own simulator at the same time. */
describe("priceExperience — a group", () => {
  const at = aest("2026-09-16T16:00");

  it("X23 multiplies the per-person price by the people, and says so in one line", () => {
    const r = priceExperience(experience({ startAt: at, partySize: 3 }));
    expect(r.subtotalCents).toBe(105_00);
    expect(r.totalCents).toBe(105_00);
    expect(r.gstCents).toBe(955); // 10500 / 11 = 954.5 → 955
    expect(r.experience).toMatchObject({ priceCents: 35_00, partySize: 3 });
    expect(r.explanation).toContain("3 people × $35.00  $105.00");
    expect(r.segments.reduce((sum, seg) => sum + seg.amountCents, 0)).toBe(r.subtotalCents);
  });

  it("X24 gives everyone the Happy Hour price inside its window", () => {
    const r = priceExperience(experience({ startAt: aest("2026-09-16T13:00"), partySize: 3 }));
    expect(r.totalCents).toBe(87_00);
    expect(r.experience?.promo?.name).toBe("Happy Hour");
  });

  it("X25 gives the whole group the member's price (owner's choice)", () => {
    const r = priceExperience(experience({ startAt: at, member: gold, memberPriceCents: 28_00, partySize: 3 }));
    expect(r.totalCents).toBe(84_00);
    expect(r.explanation).toContain("3 people × $28.00  $84.00");
  });

  it("X26 spends free play on the member's own place only", () => {
    const r = priceExperience(
      experience({ startAt: at, experience: doubleRace, member: { tierName: "Gold", discountBp: 0 }, freeMinutes: 30, partySize: 3 }),
    );
    // Their own hour is half free ($29); the other two pay $58 each.
    expect(r.subtotalCents).toBe(29_00 + 2 * 58_00);
    expect(r.segments.map((seg) => [seg.minutes, seg.free, seg.amountCents])).toEqual([
      [30, true, 0],
      [30, false, 29_00],
      [60, false, 116_00],
    ]);
    expect(r.explanation).toEqual(expect.arrayContaining([expect.stringContaining("free play (member balance), your place"), "2 more people × $58.00  $116.00"]));
  });

  it("X27 a whole place of free play still leaves the others to pay", () => {
    const r = priceExperience(experience({ startAt: at, member: gold, memberPriceCents: 28_00, freeMinutes: 30, partySize: 2 }));
    expect(r.totalCents).toBe(28_00);
    expect(r.explanation).toContain("1 more person × $28.00  $28.00");
  });

  it("X28 takes a referral off the group's total once, not once per person", () => {
    const r = priceExperience(experience({ startAt: at, partySize: 3, referral: { code: "ABC234", type: "fixed", value: 10_00 } }));
    expect(r.subtotalCents).toBe(105_00);
    expect(r.totalCents).toBe(95_00);
    const pct = priceExperience(experience({ startAt: at, partySize: 2, referral: { code: "ABC234", type: "percent", value: 1000 } }));
    expect(pct.totalCents).toBe(63_00);
  });

  it("X29 refuses no people, part of a person, or a negative group", () => {
    for (const partySize of [0, 1.5, -2]) {
      expect(() => priceExperience(experience({ startAt: at, partySize }))).toThrow(PricingError);
    }
  });
});

describe("priceExperience — a longer booking made of packages (D118)", () => {
  const sessions = [quickRace, doubleRace];
  const twoHours = { id: "exp-2h", name: "2 Hours", resourceTypeId: "sim", minutes: 120, priceCents: 99_00 };

  it("X30 splits a length into packages: exact length first, then the longest first", () => {
    expect(splitIntoPackages(60, sessions, "exp-quick")?.map((p) => p.id)).toEqual(["exp-double"]);
    expect(splitIntoPackages(90, sessions)?.map((p) => p.id)).toEqual(["exp-double", "exp-quick"]);
    expect(splitIntoPackages(120, sessions)?.map((p) => p.id)).toEqual(["exp-double", "exp-double"]);
    expect(splitIntoPackages(120, [...sessions, twoHours])?.map((p) => p.id)).toEqual(["exp-2h"]);
    expect(splitIntoPackages(180, [...sessions, twoHours])?.map((p) => p.id)).toEqual(["exp-2h", "exp-double"]);
    expect(splitIntoPackages(90, [doubleRace])).toBeNull();
  });

  it("X31 prices 2 hours of Double Sessions outside happy hour at twice the price", () => {
    const r = priceExperience(experience({ startAt: aest("2026-09-16T16:00"), experience: doubleRace, packages: sessions, minutes: 120 }));
    expect(r.totalCents).toBe(116_00);
    expect(r.billedMinutes).toBe(120);
    expect(r.experience?.minutes).toBe(120);
    expect(r.experience?.listPriceCents).toBe(116_00);
    expect(r.experience?.pieces?.map((p) => [p.localStart.slice(11), p.name, p.priceCents])).toEqual([
      ["16:00", "Double Race", 58_00],
      ["17:00", "Double Race", 58_00],
    ]);
    expect(r.explanation).toEqual([
      "Double Race · 120 min",
      "16:00–17:00  Double Race  $58.00",
      "17:00–18:00  Double Race  $58.00",
      "Subtotal  $116.00",
      "Total (incl. GST $10.55)  $116.00",
    ]);
  });

  it("X32 gives happy hour to each package that starts in it, and only to those", () => {
    const r = priceExperience(experience({ startAt: aest("2026-09-16T14:00"), experience: doubleRace, packages: sessions, minutes: 120 }));
    expect(r.experience?.pieces?.map((p) => [p.localStart.slice(11), p.priceCents, p.promo?.name ?? null])).toEqual([
      ["14:00", 49_00, "Happy Hour"],
      ["15:00", 58_00, null],
    ]);
    expect(r.totalCents).toBe(107_00);
    expect(r.experience?.promo).toBeNull();
  });

  it("X33 makes an odd half hour a Single Session, and uses the owner's own longer package", () => {
    const ninety = priceExperience(experience({ startAt: aest("2026-09-16T16:00"), experience: quickRace, packages: sessions, minutes: 90 }));
    expect(ninety.totalCents).toBe(93_00);
    const three = priceExperience(experience({ startAt: aest("2026-09-16T16:00"), experience: doubleRace, packages: [...sessions, twoHours], minutes: 180 }));
    expect(three.totalCents).toBe(99_00 + 58_00);
  });

  it("X34 a Single Session booked for an hour is priced as the 1-hour package", () => {
    const r = priceExperience(experience({ startAt: aest("2026-09-16T16:00"), experience: quickRace, packages: sessions, minutes: 60 }));
    expect(r.totalCents).toBe(58_00);
    expect(r.experience?.name).toBe("Quick Race");
    expect(r.experience?.pieces?.map((p) => p.name)).toEqual(["Double Race"]);
  });

  it("X35 a member gets their price on each package; free play and a group work over the whole length", () => {
    const member = priceExperience(
      experience({ startAt: aest("2026-09-16T16:00"), experience: doubleRace, packages: sessions, minutes: 90, member: silver, memberPrices: { "exp-quick": 30_00 } }),
    );
    // Double at 10% off ($52.20) + Single at Silver's own $30.
    expect(member.totalCents).toBe(52_20 + 30_00);
    const free = priceExperience(
      experience({ startAt: aest("2026-09-16T16:00"), experience: doubleRace, packages: sessions, minutes: 120, member: silver, freeMinutes: 60 }),
    );
    expect(free.totalCents).toBe(52_20); // half of 2 × $52.20
    const group = priceExperience(experience({ startAt: aest("2026-09-16T16:00"), experience: doubleRace, packages: sessions, minutes: 120, partySize: 3 }));
    expect(group.totalCents).toBe(3 * 116_00);
  });

  it("X36 a student price asked for on every package applies to each", () => {
    const r = priceExperience(
      experience({ startAt: aest("2026-09-16T16:00"), experience: doubleRace, packages: sessions, minutes: 90, claimedPromoIds: ["st-quick", "st-double"] }),
    );
    expect(r.totalCents).toBe(52_00 + 32_00);
  });

  it("X37 refuses a length the packages can't make", () => {
    expect(() => priceExperience(experience({ startAt: aest("2026-09-16T16:00"), experience: doubleRace, minutes: 90 }))).toThrow(PricingError);
  });
});
