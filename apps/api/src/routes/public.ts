import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../context.js";
import { ApiError } from "../errors.js";
import { rateLimit } from "../lib/rate-limit.js";
import {
  abandonBooking,
  availability,
  cancelBookingByCustomer,
  checkReferral,
  holdBooking,
  publicConfig,
  quoteBooking,
  viewBooking,
} from "../services/bookings.js";
import { optionalAccount } from "../middleware/account.js";
import { accountContact, accountMember } from "../services/account.js";
import type { MemberSummary } from "../services/lookup.js";
import { validate } from "../validate.js";

/** Booking website endpoints, no sign-in. Mounted at /public. */
export const publicRoutes = new Hono<AppEnv>();

const DateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");
const Booking = z.object({
  resourceTypeId: z.string().min(1).max(64),
  date: DateStr,
  startTime: z.string().regex(/^\d{2}:\d{2}$/, "Use HH:MM"),
  durationMinutes: z
    .number()
    .int()
    .min(15)
    .max(24 * 60)
    .refine((m) => m % 15 === 0, "Bookings are in 15-minute steps"),
  referralCode: z.string().trim().min(1).max(32).optional(),
  freeMinutes: z.number().int().min(0).max(24 * 60).optional(),
});

/** A signed-in member gets member pricing only while active or cancelling; otherwise they book as a guest. */
function pricingMember(member: MemberSummary | null) {
  return member?.eligible ? member : null;
}
const memberNotice = (member: MemberSummary | null) =>
  member && !member.eligible ? { status: member.status, message: `Your membership is ${member.status.replace("_", " ")}, so member pricing doesn't apply.` } : null;

publicRoutes.get("/config", rateLimit("public-read", 300, 60), async (c) => c.json(await publicConfig(c.get("deps"))));

publicRoutes.get(
  "/availability",
  rateLimit("public-read", 300, 60),
  validate("query", z.object({ type: z.string().min(1).max(64), date: DateStr })),
  async (c) => {
    const q = c.req.valid("query");
    return c.json(await availability(c.get("deps"), q.type, q.date));
  },
);

publicRoutes.post("/quote", rateLimit("public-quote", 120, 60), optionalAccount, validate("json", Booking), async (c) => {
  const deps = c.get("deps");
  const member = await accountMember(deps, c.get("account"));
  return c.json({ quote: await quoteBooking(deps, c.req.valid("json"), pricingMember(member)), memberNotice: memberNotice(member) });
});

publicRoutes.post("/referral/check", rateLimit("referral-check", 10, 60), validate("json", z.object({ code: z.string().trim().min(1).max(32) })), async (c) => {
  const deps = c.get("deps");
  try {
    const r = await checkReferral(deps, c.req.valid("json").code, deps.clock.now());
    return c.json({ valid: r.usable, code: r.code, type: r.type, value: r.value, reason: r.reason });
  } catch (err) {
    if (err instanceof ApiError && err.code === "not_found") return c.json({ valid: false, reason: "not_found" });
    throw err;
  }
});

/** Customer booking links (token from the email / checkout return). Mounted at /bookings. */
export const bookingRoutes = new Hono<AppEnv>();

const Customer = z
  .object({
    name: z.string().trim().min(1).max(100),
    email: z.email().max(254).optional(),
    phone: z
      .string()
      .trim()
      .regex(/^\+?[0-9 ()-]{8,20}$/, "Enter a valid phone number")
      .optional(),
  })
  .refine((v) => v.email || v.phone, "An email or phone number is required");

bookingRoutes.post(
  "/hold",
  rateLimit("booking-hold", 10, 600),
  optionalAccount,
  validate("json", Booking.extend({ resourceId: z.uuid().optional(), customer: Customer.optional(), expectedTotalCents: z.number().int().min(0), acceptTerms: z.literal(true) })),
  async (c) => {
    const deps = c.get("deps");
    const account = c.get("account");
    const member = pricingMember(await accountMember(deps, account));
    const contact = account && !member ? await accountContact(deps, account) : null;
    return c.json(await holdBooking(deps, c.req.valid("json"), member, contact), 201);
  },
);

const Ref = z.object({ ref: z.string().regex(/^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{6}$/i, "Invalid booking code") });
const Token = z.string().min(20).max(200);

bookingRoutes.get("/:ref", rateLimit("booking-link", 30, 60), validate("param", Ref), validate("query", z.object({ token: Token })), async (c) => {
  return c.json({ booking: await viewBooking(c.get("deps"), c.req.valid("param").ref, c.req.valid("query").token) });
});

bookingRoutes.post(
  "/:ref/cancel",
  rateLimit("booking-link", 30, 60),
  validate("param", Ref),
  validate("json", z.object({ token: Token, expectedRefundCents: z.number().int().min(0) })),
  async (c) => {
    const body = c.req.valid("json");
    return c.json(await cancelBookingByCustomer(c.get("deps"), c.req.valid("param").ref, body.token, body.expectedRefundCents));
  },
);

bookingRoutes.post("/:ref/abandon", rateLimit("booking-link", 30, 60), validate("param", Ref), validate("json", z.object({ token: Token })), async (c) => {
  return c.json(await abandonBooking(c.get("deps"), c.req.valid("param").ref, c.req.valid("json").token));
});
