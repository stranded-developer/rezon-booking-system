import { createMiddleware } from "hono/factory";
import type { AppEnv } from "../context.js";
import { ApiError, mapDbError } from "../errors.js";
import { requestIp } from "./audit.js";

/**
 * Fixed-window rate limit per client IP, counted in Postgres so every API instance shares it.
 * `name` groups routes that share a budget.
 */
export function rateLimit(name: string, limit: number, windowSeconds: number) {
  return createMiddleware<AppEnv>(async (c, next) => {
    const { db } = c.get("deps");
    const key = `${name}:${requestIp(c) ?? "unknown"}`;
    const { data, error } = await db.rpc("rate_limit_hit", { p_key: key, p_limit: limit, p_window_seconds: windowSeconds }).single();
    if (error) throw mapDbError(error);
    if (!data.allowed) {
      const retryAfterSeconds = Math.max(1, Math.ceil((new Date(data.reset_at).getTime() - Date.now()) / 1000));
      c.header("Retry-After", String(retryAfterSeconds));
      throw new ApiError(429, "rate_limited", "Too many requests. Please wait a moment and try again.", { retryAfterSeconds });
    }
    await next();
  });
}
