import { serve } from "@hono/node-server";
import Stripe from "stripe";
import { createServiceClient } from "@raceground/db";
import { createApp } from "./app.js";
import { systemClock } from "./context.js";
import { loadEnv } from "./env.js";
import { createConsoleEmail } from "./services/email.js";

const env = loadEnv();
const db = createServiceClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
const app = createApp({
  env,
  db,
  clock: systemClock,
  stripe: env.STRIPE_SECRET_KEY ? new Stripe(env.STRIPE_SECRET_KEY) : null,
  email: createConsoleEmail(db, env.EMAIL_FROM),
});
const port = Number(process.env.PORT ?? 8787);

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`Raceground API listening on http://localhost:${info.port}`);
});
