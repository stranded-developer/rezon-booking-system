import { serve } from "@hono/node-server";
import { createAppFromEnv } from "./bootstrap.js";

const app = createAppFromEnv();
const port = Number(process.env.PORT ?? 8787);

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`Raceground API listening on http://localhost:${info.port}`);
});
