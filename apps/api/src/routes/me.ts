import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../context.js";
import { rateLimit } from "../lib/rate-limit.js";
import { requireAccount } from "../middleware/account.js";
import {
  accountLedger,
  billingPortal,
  changeAccountTier,
  getAccount,
  reissueAccountQr,
  setAccountCancel,
  startAccountMembership,
} from "../services/account.js";
import { bookingForCustomer, cancelBooking, customerBookings, describeBooking } from "../services/bookings.js";
import { validate } from "../validate.js";

/** Member area of the booking site. Mounted at /me. */
export const meRoutes = new Hono<AppEnv>();
meRoutes.use("*", rateLimit("account", 120, 60), requireAccount);

const Ref = z.object({ ref: z.string().regex(/^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{6}$/i, "Invalid booking code") });

meRoutes.get("/", async (c) => c.json(await getAccount(c.get("deps"), c.get("account")!)));

meRoutes.get("/ledger", async (c) => c.json({ entries: await accountLedger(c.get("deps"), c.get("account")!) }));

meRoutes.get("/bookings", async (c) => c.json({ bookings: await customerBookings(c.get("deps"), c.get("account")!.customerId) }));

meRoutes.get("/bookings/:ref", validate("param", Ref), async (c) => {
  const deps = c.get("deps");
  return c.json({ booking: await describeBooking(deps, await bookingForCustomer(deps, c.req.valid("param").ref, c.get("account")!.customerId)) });
});

meRoutes.post("/bookings/:ref/cancel", validate("param", Ref), validate("json", z.object({ expectedRefundCents: z.number().int().min(0) })), async (c) => {
  const deps = c.get("deps");
  const booking = await bookingForCustomer(deps, c.req.valid("param").ref, c.get("account")!.customerId);
  return c.json(await cancelBooking(deps, booking, { staffId: null, expectedRefundCents: c.req.valid("json").expectedRefundCents }));
});

meRoutes.post("/qr/reissue", async (c) => c.json(await reissueAccountQr(c.get("deps"), c.get("account")!)));

meRoutes.post("/membership/checkout", validate("json", z.object({ tierId: z.uuid() })), async (c) => {
  const result = await startAccountMembership(c.get("deps"), c.get("account")!, c.req.valid("json").tierId);
  return c.json({ checkoutUrl: result.checkoutUrl, memberNo: result.memberNo, expiresAt: result.expiresAt }, 201);
});

meRoutes.post("/membership/tier", validate("json", z.object({ tierId: z.uuid() })), async (c) => {
  return c.json(await changeAccountTier(c.get("deps"), c.get("account")!, c.req.valid("json").tierId));
});

meRoutes.post("/membership/cancel", async (c) => c.json(await setAccountCancel(c.get("deps"), c.get("account")!, true)));
meRoutes.post("/membership/resume", async (c) => c.json(await setAccountCancel(c.get("deps"), c.get("account")!, false)));

meRoutes.post("/portal", async (c) => c.json(await billingPortal(c.get("deps"), c.get("account")!)));
