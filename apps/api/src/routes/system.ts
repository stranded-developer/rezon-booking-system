import { timingSafeEqual } from "node:crypto";
import { Hono } from "hono";
import Stripe from "stripe";
import type { AppEnv } from "../context.js";
import { ApiError, mapDbError } from "../errors.js";
import { handleStripeEvent } from "../services/billing.js";

/** Stripe webhooks, scheduled jobs and the pages Stripe Checkout returns to. No staff session involved. */
export const systemRoutes = new Hono<AppEnv>();

systemRoutes.post("/webhooks/stripe", async (c) => {
  const deps = c.get("deps");
  if (!deps.stripe || !deps.env.STRIPE_WEBHOOK_SECRET) throw new ApiError(503, "stripe_not_configured", "Stripe webhooks aren't configured");
  const signature = c.req.header("stripe-signature");
  if (!signature) throw new ApiError(400, "invalid_signature", "Missing Stripe-Signature header");
  const payload = await c.req.text(); // raw body: the signature is over the exact bytes
  let event: Stripe.Event;
  try {
    event = deps.stripe.webhooks.constructEvent(payload, signature, deps.env.STRIPE_WEBHOOK_SECRET);
  } catch {
    throw new ApiError(400, "invalid_signature", "Webhook signature verification failed");
  }
  // A thrown error returns 500 and Stripe retries; processing is idempotent.
  const result = await handleStripeEvent(deps, event);
  return c.json({ received: true, ...result });
});

function requireCron(secret: string | undefined, header: string | undefined) {
  if (!secret) throw new ApiError(503, "cron_not_configured", "CRON_SECRET isn't set");
  const given = Buffer.from(header?.replace(/^Bearer /, "") ?? "");
  const expected = Buffer.from(secret);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) throw new ApiError(401, "unauthenticated", "Invalid cron secret");
}

systemRoutes.post("/cron/forfeit", async (c) => {
  const deps = c.get("deps");
  requireCron(deps.env.CRON_SECRET, c.req.header("Authorization"));
  const { data, error } = await deps.db.rpc("membership_forfeit_balances", { p_now: deps.clock.now().toISOString() });
  if (error) throw mapDbError(error);
  return c.json({ forfeited: data });
});

const page = (title: string, body: string) => `<!doctype html>
<html lang="en-AU"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0b0d10;color:#f3f5f8;font:16px system-ui,sans-serif;text-align:center;padding:24px}
h1{font-size:28px;margin:0 0 8px}.brand{font-weight:900;font-style:italic;text-transform:uppercase;letter-spacing:-.5px}.brand span{color:#e8ff47}p{color:#c9d0da;max-width:28rem}</style></head>
<body><main><div class="brand">Race<span>ground</span></div><h1>${title}</h1><p>${body}</p></main></body></html>`;

systemRoutes.get("/checkout/complete", (c) =>
  c.html(page("You're in!", "Your membership payment went through. Show this screen to the cashier to collect your member card.")),
);
systemRoutes.get("/checkout/cancelled", (c) => c.html(page("No payment taken", "The membership wasn't started. You can try again at the counter.")));
