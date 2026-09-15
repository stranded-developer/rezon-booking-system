/**
 * Vercel entry point: every request to the API project is rewritten here (see vercel.json)
 * and Hono routes it exactly as it does locally in src/server.ts.
 *
 * The app is built on the first request, not at import time, so a missing setting shows up as a
 * clear error in the logs rather than a crash while the function is still starting.
 */
import type { App } from "../src/app.js";
import { createAppFromEnv } from "../src/bootstrap.js";

let app: App | undefined;

export default function handler(request: Request): Response | Promise<Response> {
  app ??= createAppFromEnv();
  return app.fetch(request);
}
