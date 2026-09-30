import {
  validateExperience,
  validateExperiencePromos,
  validateHappyHours,
  validateRateBands,
  validateTier,
  type HappyHour,
  type IsoDayOfWeek,
  type RateBand,
  type ValidationIssue,
} from "@raceground/pricing";
import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";
import type { AppEnv } from "../context.js";
import { ApiError, mapDbError } from "../errors.js";
import { auditHeaders } from "../lib/audit-headers.js";
import { migrateTierSubscriptions } from "../services/billing.js";
import { wallTime } from "../services/venue.js";
import { addPhoto, listPhotos, MAX_PHOTO_BYTES, MAX_PHOTOS, removePhoto, reorderPhotos, updatePhotoCaption } from "../services/venue-photos.js";
import { validate } from "../validate.js";

/** Venue configuration. Mounted inside adminRoutes (superadmin operator already required). */
export const adminConfigRoutes = new Hono<AppEnv>();

const Id = z.object({ id: z.uuid() });
const Reason = z.string().trim().max(300).optional();
const WallTime = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$|^24:00$/, "Use HH:MM");
const Days = z.array(z.number().int().min(1).max(7)).min(1).max(7);
const Cents = z.number().int().min(0).max(10_000_000);

function rejectIssues(issues: ValidationIssue[]) {
  if (issues.length > 0) throw new ApiError(422, "validation_failed", issues[0]!.message, issues);
}

const OptionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => v || null)
    .nullable()
    .optional();

// ── Settings ─────────────────────────────────────────────────────────────────
adminConfigRoutes.get("/settings", async (c) => {
  const { data, error } = await c.get("deps").db.from("venue_settings").select("*").eq("id", 1).single();
  if (error) throw mapDbError(error);
  return c.json({ settings: data });
});

const SettingsBody = z
  .object({
    businessName: z.string().trim().min(1).max(120).nullable().optional(),
    abn: z
      .string()
      .transform((v) => v.replace(/\s/g, ""))
      .pipe(z.string().regex(/^\d{11}$/, "ABN must be 11 digits"))
      .nullable()
      .optional(),
    // A session is the smallest block sold online; it has to sit on the quarter hour.
    sessionMinutes: z
      .number()
      .int()
      .min(15)
      .max(240)
      .refine((m) => m % 15 === 0, "A session must be a whole number of quarter hours")
      .optional(),
    bookingWindowDays: z.number().int().min(0).max(60).optional(),
    onlineCutoffMinutes: z.number().int().min(0).max(1440).optional(),
    noShowHoldMinutes: z.number().int().min(0).max(120).optional(),
    walkinLastOpenMinutes: z.number().int().min(0).max(240).optional(),
    cashVarianceThresholdCents: Cents.optional(),
    balanceForfeitDays: z.number().int().min(0).max(365).optional(),
    // Booking site home page (D58). Empty text clears a field.
    address: OptionalText(300),
    phone: z
      .string()
      .trim()
      .transform((v) => v || null)
      .pipe(z.string().regex(/^\+?[0-9 ()-]{8,20}$/, "Enter a valid phone number").nullable())
      .nullable()
      .optional(),
    contactEmail: z
      .string()
      .trim()
      .transform((v) => v || null)
      .pipe(z.email("Enter a valid email address").max(254).nullable())
      .nullable()
      .optional(),
    intro: OptionalText(1000),
    instagramUrl: z
      .string()
      .trim()
      .transform((v) => v || null)
      .pipe(z.string().regex(/^https:\/\/(www\.)?instagram\.com\/[A-Za-z0-9_.]{1,30}\/?$/, "Use a link like https://www.instagram.com/yourname").nullable())
      .nullable()
      .optional(),
    reason: Reason,
  })
  .refine((b) => Object.keys(b).some((k) => k !== "reason"), "Nothing to update");

adminConfigRoutes.patch("/settings", validate("json", SettingsBody), async (c) => {
  const { reason, ...b } = c.req.valid("json");
  const patch = {
    ...(b.businessName !== undefined ? { business_name: b.businessName } : {}),
    ...(b.abn !== undefined ? { abn: b.abn } : {}),
    ...(b.sessionMinutes !== undefined ? { session_minutes: b.sessionMinutes } : {}),
    ...(b.bookingWindowDays !== undefined ? { booking_window_days: b.bookingWindowDays } : {}),
    ...(b.onlineCutoffMinutes !== undefined ? { online_cutoff_minutes: b.onlineCutoffMinutes } : {}),
    ...(b.noShowHoldMinutes !== undefined ? { no_show_hold_minutes: b.noShowHoldMinutes } : {}),
    ...(b.walkinLastOpenMinutes !== undefined ? { walkin_last_open_minutes: b.walkinLastOpenMinutes } : {}),
    ...(b.cashVarianceThresholdCents !== undefined ? { cash_variance_threshold_cents: b.cashVarianceThresholdCents } : {}),
    ...(b.balanceForfeitDays !== undefined ? { balance_forfeit_days: b.balanceForfeitDays } : {}),
    ...(b.address !== undefined ? { address: b.address } : {}),
    ...(b.phone !== undefined ? { phone: b.phone } : {}),
    ...(b.contactEmail !== undefined ? { contact_email: b.contactEmail } : {}),
    ...(b.intro !== undefined ? { intro: b.intro } : {}),
    ...(b.instagramUrl !== undefined ? { instagram_url: b.instagramUrl } : {}),
  };
  const { data, error } = await auditHeaders(c.get("deps").db.from("venue_settings").update(patch).eq("id", 1), c.get("operator").id, reason)
    .select("*")
    .single();
  if (error) throw mapDbError(error);
  return c.json({ settings: data });
});

// ── Website photos (D58) ─────────────────────────────────────────────────────
const Caption = z
  .string()
  .trim()
  .max(200)
  .transform((v) => v || null)
  .nullable();

adminConfigRoutes.get("/venue-photos", async (c) => c.json({ photos: await listPhotos(c.get("deps").db) }));

adminConfigRoutes.post(
  "/venue-photos",
  bodyLimit({
    maxSize: MAX_PHOTO_BYTES + 64 * 1024,
    onError: () => {
      throw new ApiError(413, "validation_failed", "Photos can be at most 5 MB");
    },
  }),
  async (c) => {
    const form = await c.req.parseBody().catch(() => {
      throw new ApiError(422, "validation_failed", "Send the photo as a form upload");
    });
    const file = form.file;
    if (!(file instanceof File)) throw new ApiError(422, "validation_failed", "Choose a photo to upload");
    const caption = Caption.safeParse(typeof form.caption === "string" ? form.caption : "");
    if (!caption.success) throw new ApiError(422, "validation_failed", "Captions can be at most 200 characters");
    return c.json({ photo: await addPhoto(c.get("deps").db, c.get("operator").id, file, caption.data) }, 201);
  },
);

adminConfigRoutes.patch("/venue-photos/:id", validate("param", Id), validate("json", z.object({ caption: Caption })), async (c) => {
  const photo = await updatePhotoCaption(c.get("deps").db, c.get("operator").id, c.req.valid("param").id, c.req.valid("json").caption);
  return c.json({ photo });
});

adminConfigRoutes.put("/venue-photos/order", validate("json", z.object({ ids: z.array(z.uuid()).max(MAX_PHOTOS) })), async (c) => {
  return c.json({ photos: await reorderPhotos(c.get("deps").db, c.get("operator").id, c.req.valid("json").ids) });
});

adminConfigRoutes.delete("/venue-photos/:id", validate("param", Id), async (c) => {
  return c.json(await removePhoto(c.get("deps").db, c.get("operator").id, c.req.valid("param").id));
});

// ── Opening hours ────────────────────────────────────────────────────────────
adminConfigRoutes.get("/opening-hours", async (c) => {
  const { data, error } = await c.get("deps").db.from("opening_hours").select("*").order("day_of_week");
  if (error) throw mapDbError(error);
  return c.json({ days: data.map((d) => ({ ...d, open_time: wallTime(d.open_time), close_time: wallTime(d.close_time) })) });
});

const HoursBody = z.object({
  days: z
    .array(z.object({ dayOfWeek: z.number().int().min(1).max(7), openTime: WallTime, closeTime: WallTime, closed: z.boolean() }))
    .length(7)
    .refine((days) => new Set(days.map((d) => d.dayOfWeek)).size === 7, "Give each day once")
    .refine((days) => days.every((d) => d.closeTime > d.openTime), "Closing time must be after opening time"),
  reason: Reason,
});

adminConfigRoutes.put("/opening-hours", validate("json", HoursBody), async (c) => {
  const { days, reason } = c.req.valid("json");
  const rows = days.map((d) => ({ day_of_week: d.dayOfWeek, open_time: d.openTime, close_time: d.closeTime, closed: d.closed }));
  const { data, error } = await auditHeaders(c.get("deps").db.from("opening_hours").upsert(rows, { onConflict: "day_of_week" }), c.get("operator").id, reason)
    .select("*")
    .order("day_of_week");
  if (error) throw mapDbError(error);
  return c.json({ days: data.map((d) => ({ ...d, open_time: wallTime(d.open_time), close_time: wallTime(d.close_time) })) });
});

// ── Resource types and resources ─────────────────────────────────────────────
adminConfigRoutes.get("/resource-types", async (c) => {
  const { data, error } = await c.get("deps").db.from("resource_types").select("*, resources(id, label, sort, active)").order("sort");
  if (error) throw mapDbError(error);
  return c.json({ resourceTypes: data });
});

adminConfigRoutes.post(
  "/resource-types",
  validate(
    "json",
    z.object({
      key: z.string().regex(/^[a-z0-9_]{2,30}$/, "Lowercase letters, digits and underscores"),
      name: z.string().trim().min(1).max(60),
      baseRateCents: Cents,
      minMinutes: z.number().int().min(1).max(240),
      sort: z.number().int().optional(),
      reason: Reason,
    }),
  ),
  async (c) => {
    const b = c.req.valid("json");
    const { data, error } = await auditHeaders(
      c.get("deps").db.from("resource_types").insert({ key: b.key, name: b.name, base_rate_cents: b.baseRateCents, min_minutes: b.minMinutes, sort: b.sort ?? 100 }),
      c.get("operator").id,
      b.reason,
    )
      .select("*")
      .single();
    if (error) throw mapDbError(error);
    return c.json({ resourceType: data }, 201);
  },
);

adminConfigRoutes.patch(
  "/resource-types/:id",
  validate("param", Id),
  validate(
    "json",
    z
      .object({
        name: z.string().trim().min(1).max(60).optional(),
        baseRateCents: Cents.optional(),
        minMinutes: z.number().int().min(1).max(240).optional(),
        sort: z.number().int().optional(),
        active: z.boolean().optional(),
        reason: Reason,
      })
      .refine((b) => Object.keys(b).some((k) => k !== "reason"), "Nothing to update"),
  ),
  async (c) => {
    const { reason, ...b } = c.req.valid("json");
    const { id } = c.req.valid("param");
    if (b.active === false) await assertNoOpenWork(c.get("deps").db, { resourceTypeId: id });
    const patch = {
      ...(b.name !== undefined ? { name: b.name } : {}),
      ...(b.baseRateCents !== undefined ? { base_rate_cents: b.baseRateCents } : {}),
      ...(b.minMinutes !== undefined ? { min_minutes: b.minMinutes } : {}),
      ...(b.sort !== undefined ? { sort: b.sort } : {}),
      ...(b.active !== undefined ? { active: b.active } : {}),
    };
    const { data, error } = await auditHeaders(c.get("deps").db.from("resource_types").update(patch).eq("id", id), c.get("operator").id, reason)
      .select("*")
      .maybeSingle();
    if (error) throw mapDbError(error);
    if (!data) throw new ApiError(404, "not_found", "Resource type not found");
    return c.json({ resourceType: data });
  },
);

adminConfigRoutes.post(
  "/resources",
  validate("json", z.object({ resourceTypeId: z.uuid(), label: z.string().trim().min(1).max(40), sort: z.number().int().optional(), reason: Reason })),
  async (c) => {
    const b = c.req.valid("json");
    const { data, error } = await auditHeaders(
      c.get("deps").db.from("resources").insert({ resource_type_id: b.resourceTypeId, label: b.label, sort: b.sort ?? 100 }),
      c.get("operator").id,
      b.reason,
    )
      .select("*")
      .single();
    if (error) throw mapDbError(error);
    return c.json({ resource: data }, 201);
  },
);

adminConfigRoutes.patch(
  "/resources/:id",
  validate("param", Id),
  validate(
    "json",
    z
      .object({ label: z.string().trim().min(1).max(40).optional(), sort: z.number().int().optional(), active: z.boolean().optional(), reason: Reason })
      .refine((b) => Object.keys(b).some((k) => k !== "reason"), "Nothing to update"),
  ),
  async (c) => {
    const { reason, ...b } = c.req.valid("json");
    const { id } = c.req.valid("param");
    if (b.active === false) await assertNoOpenWork(c.get("deps").db, { resourceId: id });
    const patch = {
      ...(b.label !== undefined ? { label: b.label } : {}),
      ...(b.sort !== undefined ? { sort: b.sort } : {}),
      ...(b.active !== undefined ? { active: b.active } : {}),
    };
    const { data, error } = await auditHeaders(c.get("deps").db.from("resources").update(patch).eq("id", id), c.get("operator").id, reason)
      .select("*")
      .maybeSingle();
    if (error) throw mapDbError(error);
    if (!data) throw new ApiError(404, "not_found", "Resource not found");
    return c.json({ resource: data });
  },
);

/** A resource (or every resource of a type) can't be retired while it is in use or has bookings ahead. */
async function assertNoOpenWork(db: AppEnv["Variables"]["deps"]["db"], scope: { resourceId?: string; resourceTypeId?: string }) {
  let ids = scope.resourceId ? [scope.resourceId] : [];
  if (scope.resourceTypeId) {
    const { data, error } = await db.from("resources").select("id").eq("resource_type_id", scope.resourceTypeId);
    if (error) throw mapDbError(error);
    ids = data.map((r) => r.id);
  }
  if (ids.length === 0) return;
  const [open, future] = await Promise.all([
    db.from("sessions").select("id", { count: "exact", head: true }).in("resource_id", ids).eq("status", "open"),
    db
      .from("bookings")
      .select("id", { count: "exact", head: true })
      .in("resource_id", ids)
      .in("status", ["held", "confirmed", "arrived"])
      .overlaps("period", `[${new Date().toISOString()},infinity)`),
  ]);
  if (open.error) throw mapDbError(open.error);
  if (future.error) throw mapDbError(future.error);
  if ((open.count ?? 0) > 0) throw new ApiError(409, "resource_in_use", "Close the open session before deactivating");
  if ((future.count ?? 0) > 0) throw new ApiError(409, "has_bookings", "There are upcoming bookings; cancel or move them first");
}

// ── Rate bands ───────────────────────────────────────────────────────────────
type BandRow = { id: string; resource_type_id: string; days_of_week: number[]; start_time: string; end_time: string; rate_cents: number; active: boolean };
const toBand = (b: BandRow): RateBand => ({
  id: b.id,
  resourceTypeId: b.resource_type_id,
  daysOfWeek: b.days_of_week as IsoDayOfWeek[],
  startTime: wallTime(b.start_time),
  endTime: wallTime(b.end_time),
  rateCents: b.rate_cents,
});

async function assertBandsValid(db: AppEnv["Variables"]["deps"]["db"], candidate: RateBand | null, excludeId?: string) {
  const { data, error } = await db.from("rate_bands").select("*").eq("active", true);
  if (error) throw mapDbError(error);
  const others = data.filter((b) => b.id !== excludeId && b.id !== candidate?.id).map(toBand);
  rejectIssues(validateRateBands(candidate ? [...others, candidate] : others));
}

adminConfigRoutes.get("/rate-bands", async (c) => {
  const { data, error } = await c.get("deps").db.from("rate_bands").select("*").order("created_at");
  if (error) throw mapDbError(error);
  return c.json({ rateBands: data.map((b) => ({ ...b, start_time: wallTime(b.start_time), end_time: wallTime(b.end_time) })) });
});

const BandBody = z.object({ resourceTypeId: z.uuid(), daysOfWeek: Days, startTime: WallTime, endTime: WallTime, rateCents: Cents, reason: Reason });

adminConfigRoutes.post("/rate-bands", validate("json", BandBody), async (c) => {
  const b = c.req.valid("json");
  const { db } = c.get("deps");
  await assertBandsValid(db, { id: "new", resourceTypeId: b.resourceTypeId, daysOfWeek: b.daysOfWeek as IsoDayOfWeek[], startTime: b.startTime, endTime: b.endTime, rateCents: b.rateCents });
  const { data, error } = await auditHeaders(
    db.from("rate_bands").insert({
      resource_type_id: b.resourceTypeId,
      days_of_week: b.daysOfWeek,
      start_time: b.startTime,
      end_time: b.endTime,
      rate_cents: b.rateCents,
    }),
    c.get("operator").id,
    b.reason,
  )
    .select("*")
    .single();
  if (error) throw mapDbError(error);
  return c.json({ rateBand: data }, 201);
});

adminConfigRoutes.patch(
  "/rate-bands/:id",
  validate("param", Id),
  validate("json", BandBody.partial().extend({ active: z.boolean().optional(), reason: Reason })),
  async (c) => {
    const { id } = c.req.valid("param");
    const { reason, ...b } = c.req.valid("json");
    const { db } = c.get("deps");
    const { data: current, error: readError } = await db.from("rate_bands").select("*").eq("id", id).maybeSingle();
    if (readError) throw mapDbError(readError);
    if (!current) throw new ApiError(404, "not_found", "Rate band not found");
    const next: BandRow = {
      ...current,
      ...(b.resourceTypeId !== undefined ? { resource_type_id: b.resourceTypeId } : {}),
      ...(b.daysOfWeek !== undefined ? { days_of_week: b.daysOfWeek } : {}),
      ...(b.startTime !== undefined ? { start_time: b.startTime } : {}),
      ...(b.endTime !== undefined ? { end_time: b.endTime } : {}),
      ...(b.rateCents !== undefined ? { rate_cents: b.rateCents } : {}),
      ...(b.active !== undefined ? { active: b.active } : {}),
    };
    await assertBandsValid(db, next.active ? toBand(next) : null, id);
    const { data, error } = await auditHeaders(
      db
        .from("rate_bands")
        .update({
          resource_type_id: next.resource_type_id,
          days_of_week: next.days_of_week,
          start_time: next.start_time,
          end_time: next.end_time,
          rate_cents: next.rate_cents,
          active: next.active,
        })
        .eq("id", id),
      c.get("operator").id,
      reason,
    )
      .select("*")
      .single();
    if (error) throw mapDbError(error);
    return c.json({ rateBand: data });
  },
);

adminConfigRoutes.delete("/rate-bands/:id", validate("param", Id), validate("query", z.object({ reason: Reason })), async (c) => {
  const { data, error } = await auditHeaders(c.get("deps").db.from("rate_bands").delete().eq("id", c.req.valid("param").id), c.get("operator").id, c.req.valid("query").reason)
    .select("id");
  if (error) throw mapDbError(error);
  if (data.length === 0) throw new ApiError(404, "not_found", "Rate band not found");
  return c.json({ deleted: true });
});

// ── Happy hours ──────────────────────────────────────────────────────────────
type HhRow = {
  id: string;
  name: string;
  resource_type_ids: string[] | null;
  days_of_week: number[];
  start_time: string;
  end_time: string;
  discount_bp: number;
  active: boolean;
};
const toHh = (h: HhRow): HappyHour => ({
  id: h.id,
  name: h.name,
  resourceTypeIds: h.resource_type_ids,
  daysOfWeek: h.days_of_week as IsoDayOfWeek[],
  startTime: wallTime(h.start_time),
  endTime: wallTime(h.end_time),
  discountBp: h.discount_bp,
});

async function assertHappyHoursValid(db: AppEnv["Variables"]["deps"]["db"], candidate: HappyHour | null, excludeId?: string) {
  const { data, error } = await db.from("happy_hours").select("*").eq("active", true);
  if (error) throw mapDbError(error);
  const others = data.filter((h) => h.id !== excludeId && h.id !== candidate?.id).map(toHh);
  rejectIssues(validateHappyHours(candidate ? [...others, candidate] : others));
}

adminConfigRoutes.get("/happy-hours", async (c) => {
  const { data, error } = await c.get("deps").db.from("happy_hours").select("*").order("created_at");
  if (error) throw mapDbError(error);
  return c.json({ happyHours: data.map((h) => ({ ...h, start_time: wallTime(h.start_time), end_time: wallTime(h.end_time) })) });
});

const HhBody = z.object({
  name: z.string().trim().min(1).max(60),
  resourceTypeIds: z.array(z.uuid()).min(1).nullable(),
  daysOfWeek: Days,
  startTime: WallTime,
  endTime: WallTime,
  discountBp: z.number().int().min(1).max(9999),
  reason: Reason,
});

adminConfigRoutes.post("/happy-hours", validate("json", HhBody), async (c) => {
  const b = c.req.valid("json");
  const { db } = c.get("deps");
  await assertHappyHoursValid(db, {
    id: "new",
    name: b.name,
    resourceTypeIds: b.resourceTypeIds,
    daysOfWeek: b.daysOfWeek as IsoDayOfWeek[],
    startTime: b.startTime,
    endTime: b.endTime,
    discountBp: b.discountBp,
  });
  const { data, error } = await auditHeaders(
    db.from("happy_hours").insert({
      name: b.name,
      resource_type_ids: b.resourceTypeIds,
      days_of_week: b.daysOfWeek,
      start_time: b.startTime,
      end_time: b.endTime,
      discount_bp: b.discountBp,
    }),
    c.get("operator").id,
    b.reason,
  )
    .select("*")
    .single();
  if (error) throw mapDbError(error);
  return c.json({ happyHour: data }, 201);
});

adminConfigRoutes.patch(
  "/happy-hours/:id",
  validate("param", Id),
  validate("json", HhBody.partial().extend({ active: z.boolean().optional(), reason: Reason })),
  async (c) => {
    const { id } = c.req.valid("param");
    const { reason, ...b } = c.req.valid("json");
    const { db } = c.get("deps");
    const { data: current, error: readError } = await db.from("happy_hours").select("*").eq("id", id).maybeSingle();
    if (readError) throw mapDbError(readError);
    if (!current) throw new ApiError(404, "not_found", "Happy hour not found");
    const next: HhRow = {
      ...current,
      ...(b.name !== undefined ? { name: b.name } : {}),
      ...(b.resourceTypeIds !== undefined ? { resource_type_ids: b.resourceTypeIds } : {}),
      ...(b.daysOfWeek !== undefined ? { days_of_week: b.daysOfWeek } : {}),
      ...(b.startTime !== undefined ? { start_time: b.startTime } : {}),
      ...(b.endTime !== undefined ? { end_time: b.endTime } : {}),
      ...(b.discountBp !== undefined ? { discount_bp: b.discountBp } : {}),
      ...(b.active !== undefined ? { active: b.active } : {}),
    };
    await assertHappyHoursValid(db, next.active ? toHh(next) : null, id);
    const { data, error } = await auditHeaders(
      db
        .from("happy_hours")
        .update({
          name: next.name,
          resource_type_ids: next.resource_type_ids,
          days_of_week: next.days_of_week,
          start_time: next.start_time,
          end_time: next.end_time,
          discount_bp: next.discount_bp,
          active: next.active,
        })
        .eq("id", id),
      c.get("operator").id,
      reason,
    )
      .select("*")
      .single();
    if (error) throw mapDbError(error);
    return c.json({ happyHour: data });
  },
);

adminConfigRoutes.delete("/happy-hours/:id", validate("param", Id), validate("query", z.object({ reason: Reason })), async (c) => {
  const { data, error } = await auditHeaders(c.get("deps").db.from("happy_hours").delete().eq("id", c.req.valid("param").id), c.get("operator").id, c.req.valid("query").reason)
    .select("id");
  if (error) throw mapDbError(error);
  if (data.length === 0) throw new ApiError(404, "not_found", "Happy hour not found");
  return c.json({ deleted: true });
});

// ── Membership tiers ─────────────────────────────────────────────────────────
adminConfigRoutes.get("/tiers", async (c) => {
  const { db } = c.get("deps");
  const [tiers, members] = await Promise.all([
    db.from("membership_tiers").select("*").order("sort"),
    db.from("members").select("tier_id, status").in("status", ["active", "cancelling", "past_due"]),
  ]);
  if (tiers.error) throw mapDbError(tiers.error);
  if (members.error) throw mapDbError(members.error);
  return c.json({
    tiers: tiers.data.map((t) => ({ ...t, activeMembers: members.data.filter((m) => m.tier_id === t.id).length })),
  });
});

adminConfigRoutes.patch(
  "/tiers/:id",
  validate("param", Id),
  validate(
    "json",
    z
      .object({
        name: z.string().trim().min(1).max(40).optional(),
        discountBp: z.number().int().min(0).max(9999).optional(),
        monthlyFreeMinutes: z.number().int().min(0).max(24 * 60).optional(),
        maxBalanceMinutes: z.number().int().min(0).max(100 * 60).optional(),
        active: z.boolean().optional(),
        reason: Reason,
      })
      .refine((b) => Object.keys(b).some((k) => k !== "reason"), "Nothing to update"),
  ),
  async (c) => {
    const { id } = c.req.valid("param");
    const { reason, ...b } = c.req.valid("json");
    const { db } = c.get("deps");
    const { data: current, error: readError } = await db.from("membership_tiers").select("*").eq("id", id).maybeSingle();
    if (readError) throw mapDbError(readError);
    if (!current) throw new ApiError(404, "not_found", "Tier not found");
    const next = {
      name: b.name ?? current.name,
      discount_bp: b.discountBp ?? current.discount_bp,
      monthly_free_minutes: b.monthlyFreeMinutes ?? current.monthly_free_minutes,
      max_balance_minutes: b.maxBalanceMinutes ?? current.max_balance_minutes,
      active: b.active ?? current.active,
    };
    rejectIssues(
      validateTier({
        name: next.name,
        discountBp: next.discount_bp,
        monthlyPriceCents: current.monthly_price_cents,
        monthlyFreeMinutes: next.monthly_free_minutes,
        maxBalanceMinutes: next.max_balance_minutes,
      }),
    );
    const { data, error } = await auditHeaders(db.from("membership_tiers").update(next).eq("id", id), c.get("operator").id, reason)
      .select("*")
      .single();
    if (error) throw mapDbError(error);
    return c.json({ tier: data });
  },
);

adminConfigRoutes.post(
  "/tiers/:id/price",
  validate("param", Id),
  validate("json", z.object({ amountCents: Cents, reason: Reason })),
  async (c) => {
    const { db } = c.get("deps");
    const { amountCents, reason } = c.req.valid("json");
    const { data, error } = await auditHeaders(
      db.rpc("admin_set_tier_price", { p_tier: c.req.valid("param").id, p_staff: c.get("operator").id, p_amount_cents: amountCents, p_reason: reason ?? "" }),
      c.get("operator").id,
      reason,
    );
    if (error) throw mapDbError(error);
    const deps = c.get("deps");
    if (!deps.stripe) return c.json({ tier: data, stripeSyncPending: true });
    const billing = await migrateTierSubscriptions(deps, c.req.valid("param").id, c.get("operator").id);
    return c.json({ tier: data, stripeSyncPending: false, billing });
  },
);

// ── Experiences and their promotional prices (D65, D66) ─────────────────────

const Bullets = z.array(z.string().trim().min(1).max(120)).max(8);

adminConfigRoutes.get("/experiences", async (c) => {
  const { db } = c.get("deps");
  const [experiences, promos] = await Promise.all([
    db.from("experiences").select("*").order("sort"),
    db.from("experience_promos").select("*").order("sort"),
  ]);
  if (experiences.error) throw mapDbError(experiences.error);
  if (promos.error) throw mapDbError(promos.error);
  return c.json({
    experiences: experiences.data.map((e) => ({
      ...e,
      promos: promos.data
        .filter((p) => p.experience_id === e.id)
        .map((p) => ({ ...p, start_time: wallTime(p.start_time), end_time: wallTime(p.end_time) })),
    })),
  });
});

const ExperienceBody = z.object({
  key: z
    .string()
    .trim()
    .regex(/^[a-z0-9_]+$/, "Use lower-case letters, numbers and underscores"),
  resourceTypeId: z.uuid(),
  name: z.string().trim().min(1).max(60),
  tagline: OptionalText(80),
  bullets: Bullets.optional(),
  badges: z.array(z.string().trim().min(1).max(30)).max(3).optional(),
  minutes: z.number().int().min(1).max(24 * 60),
  priceCents: Cents,
  sort: z.number().int().min(0).max(1000).optional(),
  reason: Reason,
});

/** The venue's session length is what a length has to be a whole number of (D63, D65). */
async function sessionMinutesOf(db: AppEnv["Variables"]["deps"]["db"]) {
  const { data, error } = await db.from("venue_settings").select("session_minutes").eq("id", 1).single();
  if (error) throw mapDbError(error);
  return data.session_minutes;
}

adminConfigRoutes.post("/experiences", validate("json", ExperienceBody), async (c) => {
  const b = c.req.valid("json");
  const { db } = c.get("deps");
  rejectIssues(validateExperience({ name: b.name, minutes: b.minutes, priceCents: b.priceCents }, await sessionMinutesOf(db)));
  const { data, error } = await auditHeaders(
    db.from("experiences").insert({
      key: b.key,
      resource_type_id: b.resourceTypeId,
      name: b.name,
      tagline: b.tagline ?? null,
      bullets: b.bullets ?? [],
      badges: b.badges ?? [],
      minutes: b.minutes,
      price_cents: b.priceCents,
      sort: b.sort ?? 100,
    }),
    c.get("operator").id,
    b.reason,
  )
    .select("*")
    .single();
  if (error) throw mapDbError(error);
  return c.json({ experience: data }, 201);
});

adminConfigRoutes.patch(
  "/experiences/:id",
  validate("param", Id),
  validate("json", ExperienceBody.partial().extend({ active: z.boolean().optional(), reason: Reason })),
  async (c) => {
    const { id } = c.req.valid("param");
    const { reason, ...b } = c.req.valid("json");
    const { db } = c.get("deps");
    const { data: current, error: readError } = await db.from("experiences").select("*").eq("id", id).maybeSingle();
    if (readError) throw mapDbError(readError);
    if (!current) throw new ApiError(404, "not_found", "Experience not found");

    rejectIssues(
      validateExperience(
        { name: b.name ?? current.name, minutes: b.minutes ?? current.minutes, priceCents: b.priceCents ?? current.price_cents },
        await sessionMinutesOf(db),
      ),
    );

    const patch = {
      ...(b.key !== undefined ? { key: b.key } : {}),
      ...(b.resourceTypeId !== undefined ? { resource_type_id: b.resourceTypeId } : {}),
      ...(b.name !== undefined ? { name: b.name } : {}),
      ...(b.tagline !== undefined ? { tagline: b.tagline } : {}),
      ...(b.bullets !== undefined ? { bullets: b.bullets } : {}),
      ...(b.badges !== undefined ? { badges: b.badges } : {}),
      ...(b.minutes !== undefined ? { minutes: b.minutes } : {}),
      ...(b.priceCents !== undefined ? { price_cents: b.priceCents } : {}),
      ...(b.sort !== undefined ? { sort: b.sort } : {}),
      ...(b.active !== undefined ? { active: b.active } : {}),
    };
    if (Object.keys(patch).length === 0) throw new ApiError(422, "validation_failed", "Nothing to change");
    const { data, error } = await auditHeaders(db.from("experiences").update(patch).eq("id", id), c.get("operator").id, reason).select("*").single();
    if (error) throw mapDbError(error);
    return c.json({ experience: data });
  },
);

const PromoBody = z.object({
  experienceId: z.uuid(),
  name: z.string().trim().min(1).max(60),
  daysOfWeek: Days,
  startTime: WallTime,
  endTime: WallTime,
  priceCents: Cents,
  claimed: z.boolean().optional(),
  sort: z.number().int().min(0).max(1000).optional(),
  reason: Reason,
});

adminConfigRoutes.post("/experience-promos", validate("json", PromoBody), async (c) => {
  const b = c.req.valid("json");
  const { db } = c.get("deps");
  // Overlaps are allowed on purpose: the cheapest matching price wins (D66).
  rejectIssues(
    validateExperiencePromos([
      {
        id: "new",
        name: b.name,
        experienceId: b.experienceId,
        daysOfWeek: b.daysOfWeek as IsoDayOfWeek[],
        startTime: b.startTime,
        endTime: b.endTime,
        priceCents: b.priceCents,
        claimed: b.claimed ?? false,
      },
    ]),
  );
  const { data, error } = await auditHeaders(
    db.from("experience_promos").insert({
      experience_id: b.experienceId,
      name: b.name,
      days_of_week: b.daysOfWeek,
      start_time: b.startTime,
      end_time: b.endTime,
      price_cents: b.priceCents,
      claimed: b.claimed ?? false,
      sort: b.sort ?? 100,
    }),
    c.get("operator").id,
    b.reason,
  )
    .select("*")
    .single();
  if (error) throw mapDbError(error);
  return c.json({ promo: data }, 201);
});

adminConfigRoutes.patch(
  "/experience-promos/:id",
  validate("param", Id),
  validate("json", PromoBody.partial().extend({ active: z.boolean().optional(), reason: Reason })),
  async (c) => {
    const { id } = c.req.valid("param");
    const { reason, ...b } = c.req.valid("json");
    const { db } = c.get("deps");
    const { data: current, error: readError } = await db.from("experience_promos").select("*").eq("id", id).maybeSingle();
    if (readError) throw mapDbError(readError);
    if (!current) throw new ApiError(404, "not_found", "Promotional price not found");

    rejectIssues(
      validateExperiencePromos([
        {
          id,
          name: b.name ?? current.name,
          experienceId: current.experience_id,
          daysOfWeek: (b.daysOfWeek ?? current.days_of_week) as IsoDayOfWeek[],
          startTime: b.startTime ?? wallTime(current.start_time),
          endTime: b.endTime ?? wallTime(current.end_time),
          priceCents: b.priceCents ?? current.price_cents,
          claimed: b.claimed ?? current.claimed,
        },
      ]),
    );

    const patch = {
      ...(b.name !== undefined ? { name: b.name } : {}),
      ...(b.daysOfWeek !== undefined ? { days_of_week: b.daysOfWeek } : {}),
      ...(b.startTime !== undefined ? { start_time: b.startTime } : {}),
      ...(b.endTime !== undefined ? { end_time: b.endTime } : {}),
      ...(b.priceCents !== undefined ? { price_cents: b.priceCents } : {}),
      ...(b.claimed !== undefined ? { claimed: b.claimed } : {}),
      ...(b.sort !== undefined ? { sort: b.sort } : {}),
      ...(b.active !== undefined ? { active: b.active } : {}),
    };
    if (Object.keys(patch).length === 0) throw new ApiError(422, "validation_failed", "Nothing to change");
    const { data, error } = await auditHeaders(db.from("experience_promos").update(patch).eq("id", id), c.get("operator").id, reason).select("*").single();
    if (error) throw mapDbError(error);
    return c.json({ promo: data });
  },
);

adminConfigRoutes.delete("/experience-promos/:id", validate("param", Id), validate("query", z.object({ reason: Reason })), async (c) => {
  const { id } = c.req.valid("param");
  const { data, error } = await auditHeaders(c.get("deps").db.from("experience_promos").delete().eq("id", id), c.get("operator").id, c.req.valid("query").reason)
    .select("id");
  if (error) throw mapDbError(error);
  if (data.length === 0) throw new ApiError(404, "not_found", "Promotional price not found");
  return c.json({ deleted: true });
});

// ── Tournaments (D68) ───────────────────────────────────────────────────────

adminConfigRoutes.get("/tournaments", async (c) => {
  const { db, clock } = c.get("deps");
  const { data, error } = await db.from("tournaments").select("*").order("starts_at", { ascending: false });
  if (error) throw mapDbError(error);
  const ids = data.map((t) => t.id);
  const taken = new Map<string, number>();
  if (ids.length > 0) {
    const { data: entries, error: entryError } = await db
      .from("tournament_entries")
      .select("tournament_id, status, hold_expires_at")
      .in("tournament_id", ids)
      .in("status", ["held", "confirmed"]);
    if (entryError) throw mapDbError(entryError);
    const now = clock.now();
    for (const e of entries) {
      if (e.status === "held" && !(e.hold_expires_at && new Date(e.hold_expires_at) > now)) continue;
      taken.set(e.tournament_id, (taken.get(e.tournament_id) ?? 0) + 1);
    }
  }
  return c.json({ tournaments: data.map((t) => ({ ...t, entries: taken.get(t.id) ?? 0, spots_left: Math.max(0, t.spots - (taken.get(t.id) ?? 0)) })) });
});

adminConfigRoutes.get("/tournaments/:id/entries", validate("param", Id), async (c) => {
  const { data, error } = await c
    .get("deps")
    .db.from("tournament_entries")
    .select("id, ref, status, free_entry, total_cents, created_at, customers!inner(name, email, phone)")
    .eq("tournament_id", c.req.valid("param").id)
    .order("created_at");
  if (error) throw mapDbError(error);
  return c.json({ entries: data });
});

const TournamentBody = z.object({
  name: z.string().trim().min(1).max(80),
  blurb: OptionalText(300),
  startsAt: z.string().datetime({ offset: true }),
  spots: z.number().int().min(1).max(500),
  entryFeeCents: Cents,
  published: z.boolean().optional(),
  sort: z.number().int().min(0).max(1000).optional(),
  reason: Reason,
});

adminConfigRoutes.post("/tournaments", validate("json", TournamentBody), async (c) => {
  const b = c.req.valid("json");
  const { data, error } = await auditHeaders(
    c.get("deps").db.from("tournaments").insert({
      name: b.name,
      blurb: b.blurb ?? null,
      starts_at: b.startsAt,
      spots: b.spots,
      entry_fee_cents: b.entryFeeCents,
      published: b.published ?? false,
      sort: b.sort ?? 100,
    }),
    c.get("operator").id,
    b.reason,
  )
    .select("*")
    .single();
  if (error) throw mapDbError(error);
  return c.json({ tournament: data }, 201);
});

adminConfigRoutes.patch(
  "/tournaments/:id",
  validate("param", Id),
  validate("json", TournamentBody.partial().extend({ reason: Reason })),
  async (c) => {
    const { id } = c.req.valid("param");
    const { reason, ...b } = c.req.valid("json");
    const { db } = c.get("deps");

    // Never leave people holding a spot that no longer exists.
    if (b.spots !== undefined) {
      const { count, error: countError } = await db
        .from("tournament_entries")
        .select("id", { count: "exact", head: true })
        .eq("tournament_id", id)
        .in("status", ["held", "confirmed"]);
      if (countError) throw mapDbError(countError);
      if ((count ?? 0) > b.spots) {
        throw new ApiError(409, "spots_below_entries", `${count} people are already signed up, so there must be at least ${count} spots`);
      }
    }

    const patch = {
      ...(b.name !== undefined ? { name: b.name } : {}),
      ...(b.blurb !== undefined ? { blurb: b.blurb } : {}),
      ...(b.startsAt !== undefined ? { starts_at: b.startsAt } : {}),
      ...(b.spots !== undefined ? { spots: b.spots } : {}),
      ...(b.entryFeeCents !== undefined ? { entry_fee_cents: b.entryFeeCents } : {}),
      ...(b.published !== undefined ? { published: b.published } : {}),
      ...(b.sort !== undefined ? { sort: b.sort } : {}),
    };
    if (Object.keys(patch).length === 0) throw new ApiError(422, "validation_failed", "Nothing to change");
    const { data, error } = await auditHeaders(db.from("tournaments").update(patch).eq("id", id), c.get("operator").id, reason).select("*").single();
    if (error) throw mapDbError(error);
    return c.json({ tournament: data });
  },
);

// ── Site events: the pop-up and the banner (D69) ─────────────────────────────

adminConfigRoutes.get("/site-events", async (c) => {
  const { data, error } = await c.get("deps").db.from("site_events").select("*").order("sort").order("created_at");
  if (error) throw mapDbError(error);
  return c.json({ events: data });
});

const EventBody = z
  .object({
    title: z.string().trim().min(1).max(80),
    body: OptionalText(300),
    detail: OptionalText(80),
    ctaLabel: OptionalText(30),
    ctaUrl: OptionalText(300),
    showFrom: z.string().datetime({ offset: true }).nullable().optional(),
    showUntil: z.string().datetime({ offset: true }).nullable().optional(),
    asPopup: z.boolean().optional(),
    asBanner: z.boolean().optional(),
    sort: z.number().int().min(0).max(1000).optional(),
    reason: Reason,
  })
  // The database enforces this too; saying it here gives a message the owner can act on.
  .refine((v) => (v.ctaLabel ?? null) === null === ((v.ctaUrl ?? null) === null), "A button needs both a label and a link, or neither");

adminConfigRoutes.post("/site-events", validate("json", EventBody), async (c) => {
  const b = c.req.valid("json");
  const { data, error } = await auditHeaders(
    c.get("deps").db.from("site_events").insert({
      title: b.title,
      body: b.body ?? null,
      detail: b.detail ?? null,
      cta_label: b.ctaLabel ?? null,
      cta_url: b.ctaUrl ?? null,
      show_from: b.showFrom ?? null,
      show_until: b.showUntil ?? null,
      as_popup: b.asPopup ?? true,
      as_banner: b.asBanner ?? true,
      sort: b.sort ?? 100,
    }),
    c.get("operator").id,
    b.reason,
  )
    .select("*")
    .single();
  if (error) throw mapDbError(error);
  return c.json({ event: data }, 201);
});

adminConfigRoutes.patch(
  "/site-events/:id",
  validate("param", Id),
  validate(
    "json",
    z.object({
      title: z.string().trim().min(1).max(80).optional(),
      body: OptionalText(300),
      detail: OptionalText(80),
      ctaLabel: OptionalText(30),
      ctaUrl: OptionalText(300),
      showFrom: z.string().datetime({ offset: true }).nullable().optional(),
      showUntil: z.string().datetime({ offset: true }).nullable().optional(),
      asPopup: z.boolean().optional(),
      asBanner: z.boolean().optional(),
      active: z.boolean().optional(),
      sort: z.number().int().min(0).max(1000).optional(),
      reason: Reason,
    }),
  ),
  async (c) => {
    const { id } = c.req.valid("param");
    const { reason, ...b } = c.req.valid("json");
    const patch = {
      ...(b.title !== undefined ? { title: b.title } : {}),
      ...(b.body !== undefined ? { body: b.body } : {}),
      ...(b.detail !== undefined ? { detail: b.detail } : {}),
      ...(b.ctaLabel !== undefined ? { cta_label: b.ctaLabel } : {}),
      ...(b.ctaUrl !== undefined ? { cta_url: b.ctaUrl } : {}),
      ...(b.showFrom !== undefined ? { show_from: b.showFrom } : {}),
      ...(b.showUntil !== undefined ? { show_until: b.showUntil } : {}),
      ...(b.asPopup !== undefined ? { as_popup: b.asPopup } : {}),
      ...(b.asBanner !== undefined ? { as_banner: b.asBanner } : {}),
      ...(b.active !== undefined ? { active: b.active } : {}),
      ...(b.sort !== undefined ? { sort: b.sort } : {}),
    };
    if (Object.keys(patch).length === 0) throw new ApiError(422, "validation_failed", "Nothing to change");
    const { data, error } = await auditHeaders(c.get("deps").db.from("site_events").update(patch).eq("id", id), c.get("operator").id, reason)
      .select("*")
      .single();
    if (error) throw mapDbError(error);
    return c.json({ event: data });
  },
);

// ── Games, tracks and cars a customer can ask for (D80) ─────────────────────
// A preference for staff, never a price. Tracks and cars are edited as a list per game: what is
// sent is the whole list, in order. Bookings keep the names they were made with, so removing a
// car here never changes what someone already booked.

const Names = z.array(z.string().trim().min(1).max(80)).max(200);

/** Same name twice (ignoring case) is kept once, first position wins. */
const dedupe = (names: string[]) => names.filter((n, i) => names.findIndex((m) => m.toLowerCase() === n.toLowerCase()) === i);

adminConfigRoutes.get("/games", async (c) => {
  const { db } = c.get("deps");
  const [games, tracks, cars] = await Promise.all([
    db.from("games").select("*").order("sort").order("name"),
    db.from("game_tracks").select("id, game_id, name, sort").order("sort").order("name"),
    db.from("game_cars").select("id, game_id, name, sort").order("sort").order("name"),
  ]);
  for (const r of [games, tracks, cars]) if (r.error) throw mapDbError(r.error);
  return c.json({
    games: games.data!.map((g) => ({
      ...g,
      tracks: tracks.data!.filter((t) => t.game_id === g.id).map((t) => t.name),
      cars: cars.data!.filter((x) => x.game_id === g.id).map((x) => x.name),
    })),
  });
});

/** Make a game's tracks or cars exactly `names`, in that order. */
async function saveGameList(c: Context<AppEnv>, table: "game_tracks" | "game_cars", gameId: string, names: string[], reason: string | undefined) {
  const { db } = c.get("deps");
  const actor = c.get("operator").id;
  const wanted = dedupe(names);
  const { data: current, error } = await db.from(table).select("id, name, sort, active").eq("game_id", gameId);
  if (error) throw mapDbError(error);

  const gone = current.filter((row) => !wanted.includes(row.name)).map((row) => row.id);
  if (gone.length > 0) {
    const { error: e } = await auditHeaders(db.from(table).delete().in("id", gone), actor, reason);
    if (e) throw mapDbError(e);
  }
  const fresh: { game_id: string; name: string; sort: number }[] = [];
  for (const [i, name] of wanted.entries()) {
    const row = current.find((r) => r.name === name);
    if (!row) fresh.push({ game_id: gameId, name, sort: i + 1 });
    else if (row.sort !== i + 1 || !row.active) {
      const { error: e } = await auditHeaders(db.from(table).update({ sort: i + 1, active: true }).eq("id", row.id), actor, reason);
      if (e) throw mapDbError(e);
    }
  }
  if (fresh.length > 0) {
    const { error: e } = await auditHeaders(db.from(table).insert(fresh), actor, reason);
    if (e) throw mapDbError(e);
  }
}

const GameBody = z.object({
  resourceTypeId: z.uuid(),
  name: z.string().trim().min(1).max(80),
  sort: z.number().int().min(0).max(1000).optional(),
  tracks: Names.optional(),
  cars: Names.optional(),
  reason: Reason,
});

adminConfigRoutes.post("/games", validate("json", GameBody), async (c) => {
  const b = c.req.valid("json");
  const { db } = c.get("deps");
  const { data, error } = await auditHeaders(
    db.from("games").insert({ resource_type_id: b.resourceTypeId, name: b.name, sort: b.sort ?? 100 }),
    c.get("operator").id,
    b.reason,
  )
    .select("*")
    .single();
  if (error) throw mapDbError(error);
  if (b.tracks) await saveGameList(c, "game_tracks", data.id, b.tracks, b.reason);
  if (b.cars) await saveGameList(c, "game_cars", data.id, b.cars, b.reason);
  return c.json({ game: data }, 201);
});

adminConfigRoutes.patch(
  "/games/:id",
  validate("param", Id),
  validate("json", GameBody.omit({ resourceTypeId: true }).partial().extend({ active: z.boolean().optional(), reason: Reason })),
  async (c) => {
    const { id } = c.req.valid("param");
    const { reason, tracks, cars, ...b } = c.req.valid("json");
    const { db } = c.get("deps");
    const { data: current, error: readError } = await db.from("games").select("id").eq("id", id).maybeSingle();
    if (readError) throw mapDbError(readError);
    if (!current) throw new ApiError(404, "not_found", "Game not found");

    const patch = {
      ...(b.name !== undefined ? { name: b.name } : {}),
      ...(b.sort !== undefined ? { sort: b.sort } : {}),
      ...(b.active !== undefined ? { active: b.active } : {}),
    };
    if (Object.keys(patch).length === 0 && !tracks && !cars) throw new ApiError(422, "validation_failed", "Nothing to change");
    if (Object.keys(patch).length > 0) {
      const { error } = await auditHeaders(db.from("games").update(patch).eq("id", id), c.get("operator").id, reason);
      if (error) throw mapDbError(error);
    }
    if (tracks) await saveGameList(c, "game_tracks", id, tracks, reason);
    if (cars) await saveGameList(c, "game_cars", id, cars, reason);
    return c.json({ ok: true });
  },
);
