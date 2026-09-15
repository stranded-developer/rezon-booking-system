/**
 * Vercel entry point: every request to the API project is rewritten here (see vercel.json)
 * and Hono routes it exactly as it does locally in src/server.ts.
 *
 * The app is built on the first request, not at import time, so a missing or wrong setting answers
 * with what is wrong instead of a blank "function crashed" page.
 */
import type { App } from "../src/app.js";
import { createAppFromEnv } from "../src/bootstrap.js";

export function createHandler(build: () => App = createAppFromEnv) {
  let app: App | undefined;
  return function handler(request: Request): Response | Promise<Response> {
    if (!app) {
      try {
        app = build();
      } catch (err) {
        const message = err instanceof Error ? err.message : "The API could not start";
        console.error("API failed to start", err);
        // Setting names, never values. This is what turns a blank 500 into a fixable message.
        return Response.json({ error: { code: "config_error", message } }, { status: 503 });
      }
    }
    return app.fetch(request);
  };
}

export default createHandler();
