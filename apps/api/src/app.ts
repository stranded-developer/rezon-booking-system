import { Hono } from "hono";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";
import { secureHeaders } from "hono/secure-headers";
import type { AppDeps, AppEnv } from "./context.js";
import { ApiError } from "./errors.js";
import { OPERATOR_HEADER } from "./middleware/auth.js";
import { adminRoutes } from "./routes/admin.js";
import { posRoutes } from "./routes/pos.js";

export function createApp(deps: AppDeps) {
  const app = new Hono<AppEnv>();

  app.use("*", secureHeaders());
  app.use(
    "*",
    cors({
      origin: deps.env.CORS_ORIGINS,
      allowHeaders: ["Authorization", "Content-Type", OPERATOR_HEADER],
      exposeHeaders: [OPERATOR_HEADER],
      allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
      maxAge: 600,
    }),
  );
  app.use("*", async (c, next) => {
    c.set("deps", deps);
    await next();
  });

  app.get("/health", (c) => c.json({ ok: true }));
  app.route("/pos", posRoutes);
  app.route("/admin", adminRoutes);

  app.notFound((c) => c.json({ error: { code: "not_found", message: "Not found" } }, 404));

  app.onError((err, c) => {
    if (err instanceof ApiError) {
      return c.json(
        { error: { code: err.code, message: err.message, ...(err.details !== undefined ? { details: err.details } : {}) } },
        err.status,
      );
    }
    if (err instanceof HTTPException) {
      return c.json({ error: { code: "validation_failed", message: err.message } }, err.status);
    }
    console.error("Unhandled API error", err);
    return c.json({ error: { code: "internal", message: "Something went wrong" } }, 500);
  });

  return app;
}

export type App = ReturnType<typeof createApp>;
