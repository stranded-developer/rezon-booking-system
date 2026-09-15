import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../context.js";
import { ApiError, mapDbError } from "../errors.js";
import { bookingById, bookingsForDay, cancelBooking, describeBooking } from "../services/bookings.js";
import { validate } from "../validate.js";

/** Back office bookings (superadmin; mounted inside adminRoutes). */
export const adminBookingRoutes = new Hono<AppEnv>();

const Id = z.object({ id: z.uuid() });

adminBookingRoutes.get(
  "/bookings",
  validate("query", z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD"), q: z.string().max(100).optional() })),
  async (c) => {
    const { date, q } = c.req.valid("query");
    return c.json({ bookings: await bookingsForDay(c.get("deps"), date, q) });
  },
);

adminBookingRoutes.get("/bookings/:id", validate("param", Id), async (c) => {
  const deps = c.get("deps");
  return c.json({ booking: await describeBooking(deps, await bookingById(deps, c.req.valid("param").id)) });
});

/** What a venue cancellation would refund right now (policy or venue fault). */
adminBookingRoutes.get("/bookings/:id/cancel-quote", validate("param", Id), validate("query", z.object({ venueFault: z.enum(["true", "false"]).default("false") })), async (c) => {
  const deps = c.get("deps");
  const { data, error } = await deps.db.rpc("booking_cancel_quote", {
    p_booking: c.req.valid("param").id,
    p_now: deps.clock.now().toISOString(),
    p_venue_fault: c.req.valid("query").venueFault === "true",
  });
  if (error) throw mapDbError(error);
  return c.json({ quote: data });
});

adminBookingRoutes.post(
  "/bookings/:id/cancel",
  validate("param", Id),
  validate(
    "json",
    z.object({
      reason: z.string().trim().min(3).max(300),
      venueFault: z.boolean().default(false),
      overrideRefundCents: z.number().int().min(0).max(10_000_000).optional(),
      returnMinutes: z.boolean().optional(),
      expectedRefundCents: z.number().int().min(0).optional(),
    }),
  ),
  async (c) => {
    const deps = c.get("deps");
    const body = c.req.valid("json");
    if (body.returnMinutes !== undefined && body.overrideRefundCents === undefined) {
      throw new ApiError(422, "validation_failed", "Choose whether to return minutes only when setting the refund yourself");
    }
    const booking = await bookingById(deps, c.req.valid("param").id);
    return c.json(await cancelBooking(deps, booking, { staffId: c.get("operator").id, ...body }));
  },
);
