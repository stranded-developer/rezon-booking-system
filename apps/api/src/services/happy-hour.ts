import { MINUTE_MS, priceExperience, priceSession } from "@raceground/pricing";
import type { ExperienceContext, PricingContext } from "./venue.js";

/**
 * Happy hour as a guest sees it (D99): the price at this start time and what it would be
 * otherwise. Both come from the pricing engine itself, so the label on a start time and the line in
 * the summary can never disagree with what is charged. Member prices, free play and referral codes
 * are left out on purpose: this is the venue's price, not the customer's discount.
 */
export interface HappyHourPrice {
  name: string;
  priceCents: number;
  normalCents: number;
}

/** An experience's promotional price that applies by itself at `startAt` (a student price has to be asked for). */
export function experienceHappyHour(exp: ExperienceContext, startAt: number, timeZone: string): HappyHourPrice | null {
  const { experience } = priceExperience({ startAt, timeZone, experience: exp.experience, promos: exp.promos });
  const promo = experience?.promo;
  if (!promo || promo.priceCents >= exp.experience.priceCents) return null;
  return { name: promo.name, priceCents: promo.priceCents, normalCents: exp.experience.priceCents };
}

/** A booking by the hour: cheaper than the base rate for the same length because of a rate band or a happy hour. */
export function sessionHappyHour(ctx: PricingContext, startAt: number, minutes: number): HappyHourPrice | null {
  const base = { startAt, endAt: startAt + minutes * MINUTE_MS, timeZone: ctx.timeZone, resourceType: ctx.resourceType, applyMinimum: true };
  const now = priceSession({ ...base, rateBands: ctx.rateBands, happyHours: ctx.happyHours });
  const normal = priceSession({ ...base, rateBands: [], happyHours: [] });
  if (now.totalCents >= normal.totalCents) return null;
  // A cheaper rate band has no name of its own; at this venue it is the billiards happy hour (D74).
  const name = now.segments.find((s) => s.happyHourName)?.happyHourName ?? "Happy hour";
  return { name, priceCents: now.totalCents, normalCents: normal.totalCents };
}
