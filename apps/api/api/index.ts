/**
 * Vercel entry point: every request to the API project is rewritten here (see vercel.json)
 * and Hono routes it exactly as it does locally in src/server.ts.
 *
 * Vercel's Node runtime calls this with Node's (request, response) pair, not a web Request, so the
 * app is wrapped in the same listener the local server uses. Returning a Response here instead would
 * hang until the function times out.
 *
 * The app is built on the first request, not at import time, so a missing or wrong setting answers
 * with what is wrong instead of a blank "function crashed" page.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { getRequestListener } from "@hono/node-server";
import type { App } from "../src/app.js";
import { createAppFromEnv } from "../src/bootstrap.js";

type NodeHandler = (request: IncomingMessage, response: ServerResponse) => void;

export function createHandler(build: () => App = createAppFromEnv): NodeHandler {
  let listener: NodeHandler | undefined;
  return function handler(request, response) {
    if (!listener) {
      try {
        listener = getRequestListener(build().fetch);
      } catch (err) {
        const message = err instanceof Error ? err.message : "The API could not start";
        console.error("API failed to start", err);
        // Setting names, never values. This is what turns a blank 500 into a fixable message.
        response.statusCode = 503;
        response.setHeader("content-type", "application/json; charset=utf-8");
        response.end(JSON.stringify({ error: { code: "config_error", message } }));
        return;
      }
    }
    listener(request, response);
  };
}

export default createHandler();
