import Stripe from "stripe";
import { createServiceClient } from "@raceground/db";
import { createApp, type App } from "./app.js";
import { systemClock } from "./context.js";
import { loadEnv } from "./env.js";
import { createEmailSender } from "./services/email.js";

/**
 * The app as it runs for real: environment, database, Stripe and email.
 * Used by the local server and by the Vercel entry point, so the two can't drift apart.
 */
export function createAppFromEnv(source: Record<string, string | undefined> = process.env): App {
  const env = loadEnv(source);
  const db = createServiceClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
  return createApp({
    env,
    db,
    clock: systemClock,
    stripe: env.STRIPE_SECRET_KEY ? new Stripe(env.STRIPE_SECRET_KEY) : null,
    email: createEmailSender(db, env),
  });
}
