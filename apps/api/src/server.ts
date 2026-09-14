import { serve } from "@hono/node-server";
import { createServiceClient } from "@raceground/db";
import { createApp } from "./app.js";
import { systemClock } from "./context.js";
import { loadEnv } from "./env.js";

const env = loadEnv();
const app = createApp({ env, db: createServiceClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY), clock: systemClock });
const port = Number(process.env.PORT ?? 8787);

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`Raceground API listening on http://localhost:${info.port}`);
});
