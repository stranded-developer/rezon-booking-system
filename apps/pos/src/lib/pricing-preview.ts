import { priceSession, type IsoDayOfWeek } from "@raceground/pricing";
import type { FloorTile, PosConfig } from "./types";

/**
 * Running price shown on a tile: base rates and happy hour only (no member or referral).
 * An estimate for staff; the API computes the real charge at close.
 */
export function runningPrice(tile: FloorTile, config: PosConfig, nowMs: number): number | null {
  if (!tile.session) return null;
  const type = config.resourceTypes.find((t) => t.key === tile.typeKey);
  if (!type) return null;
  const bookingEnd = tile.session.bookingEndsAt ? Date.parse(tile.session.bookingEndsAt) : null;
  const start = bookingEnd ?? Date.parse(tile.session.openedAt);
  if (bookingEnd !== null && nowMs <= bookingEnd) return 0;
  try {
    return priceSession({
      startAt: start,
      endAt: Math.max(start, nowMs),
      timeZone: config.timeZone,
      resourceType: { id: type.id, baseRateCents: type.base_rate_cents, minMinutes: type.min_minutes },
      rateBands: config.rateBands.map((b) => ({
        id: b.id,
        resourceTypeId: b.resource_type_id,
        daysOfWeek: b.days_of_week as IsoDayOfWeek[],
        startTime: b.start_time,
        endTime: b.end_time,
        rateCents: b.rate_cents,
      })),
      happyHours: config.happyHours.map((h) => ({
        id: h.id,
        name: h.name,
        resourceTypeIds: h.resource_type_ids,
        daysOfWeek: h.days_of_week as IsoDayOfWeek[],
        startTime: h.start_time,
        endTime: h.end_time,
        discountBp: h.discount_bp,
      })),
      applyMinimum: bookingEnd === null,
    }).totalCents;
  } catch {
    return null;
  }
}
