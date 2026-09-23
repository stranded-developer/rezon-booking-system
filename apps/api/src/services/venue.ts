import type { Db, Tables } from "@raceground/db";
import type { ExperiencePricing, ExperiencePromo, HappyHour, IsoDayOfWeek, RateBand, ResourceTypePricing } from "@raceground/pricing";
import { ApiError, mapDbError } from "../errors.js";

export type VenueSettings = Tables<"venue_settings">;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function loadSettings(db: Db): Promise<VenueSettings> {
  const { data, error } = await db.from("venue_settings").select("*").eq("id", 1).single();
  if (error) throw mapDbError(error);
  return data;
}

/** Postgres `time` ("10:00:00") → engine wall time ("10:00"). */
export const wallTime = (t: string) => t.slice(0, 5);

export interface PricingContext {
  timeZone: string;
  resourceType: ResourceTypePricing & { key: string; name: string };
  rateBands: RateBand[];
  happyHours: HappyHour[];
}

export async function loadPricingContext(db: Db, resourceTypeId: string, timeZone: string): Promise<PricingContext> {
  const [type, bands, hhs] = await Promise.all([
    db.from("resource_types").select("id, key, name, base_rate_cents, min_minutes").eq("id", resourceTypeId).single(),
    db.from("rate_bands").select("*").eq("resource_type_id", resourceTypeId).eq("active", true),
    db.from("happy_hours").select("*").eq("active", true),
  ]);
  if (type.error) throw mapDbError(type.error);
  if (bands.error) throw mapDbError(bands.error);
  if (hhs.error) throw mapDbError(hhs.error);
  return {
    timeZone,
    resourceType: {
      id: type.data.id,
      key: type.data.key,
      name: type.data.name,
      baseRateCents: type.data.base_rate_cents,
      minMinutes: type.data.min_minutes,
    },
    rateBands: bands.data.map((b) => ({
      id: b.id,
      resourceTypeId: b.resource_type_id,
      daysOfWeek: b.days_of_week as IsoDayOfWeek[],
      startTime: wallTime(b.start_time),
      endTime: wallTime(b.end_time),
      rateCents: b.rate_cents,
    })),
    happyHours: hhs.data.map((h) => ({
      id: h.id,
      name: h.name,
      resourceTypeIds: h.resource_type_ids,
      daysOfWeek: h.days_of_week as IsoDayOfWeek[],
      startTime: wallTime(h.start_time),
      endTime: wallTime(h.end_time),
      discountBp: h.discount_bp,
    })),
  };
}

/** PostgREST renders tstzrange as '["2030-01-16 05:00:00+00","2030-01-16 06:00:00+00")'. */
export function parseRange(range: unknown): { start: Date; end: Date } {
  const m = typeof range === "string" ? /^[[(]"?([^",]+)"?,"?([^")\]]+)"?[)\]]$/.exec(range) : null;
  if (!m) throw new ApiError(500, "internal", "Unreadable time range");
  const start = new Date(m[1]!.replace(" ", "T").replace(/\+00$/, "Z"));
  const end = new Date(m[2]!.replace(" ", "T").replace(/\+00$/, "Z"));
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) throw new ApiError(500, "internal", "Unreadable time range");
  return { start, end };
}

export const gstOf = (totalCents: number) => Math.floor((totalCents * 2 + 11) / 22);

// ── Experiences (D65, D66) ──────────────────────────────────────────────────

export interface ExperienceContext {
  experience: ExperiencePricing & { key: string; tagline: string | null; bullets: string[]; badges: string[] };
  promos: ExperiencePromo[];
}

/** One experience and every promotional price that could apply to it. */
export async function loadExperience(db: Db, idOrKey: string): Promise<ExperienceContext> {
  const query = db
    .from("experiences")
    .select("id, key, name, resource_type_id, tagline, bullets, badges, minutes, price_cents, active");
  const { data, error } = await (UUID.test(idOrKey) ? query.eq("id", idOrKey) : query.eq("key", idOrKey)).maybeSingle();
  if (error) throw mapDbError(error);
  if (!data || !data.active) throw new ApiError(404, "not_found", "That experience isn't available");
  return { experience: toExperience(data), promos: await loadPromos(db, [data.id]) };
}

export async function loadPromos(db: Db, experienceIds: string[]): Promise<ExperiencePromo[]> {
  if (experienceIds.length === 0) return [];
  const { data, error } = await db
    .from("experience_promos")
    .select("*")
    .in("experience_id", experienceIds)
    .eq("active", true)
    .order("sort");
  if (error) throw mapDbError(error);
  return data.map((p) => ({
    id: p.id,
    name: p.name,
    experienceId: p.experience_id,
    daysOfWeek: p.days_of_week as IsoDayOfWeek[],
    startTime: wallTime(p.start_time),
    endTime: wallTime(p.end_time),
    priceCents: p.price_cents,
    claimed: p.claimed,
  }));
}

type ExperienceRow = Pick<
  Tables<"experiences">,
  "id" | "key" | "name" | "resource_type_id" | "tagline" | "bullets" | "badges" | "minutes" | "price_cents"
>;

export function toExperience(row: ExperienceRow): ExperienceContext["experience"] {
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    resourceTypeId: row.resource_type_id,
    tagline: row.tagline,
    bullets: row.bullets,
    badges: row.badges,
    minutes: row.minutes,
    priceCents: row.price_cents,
  };
}
