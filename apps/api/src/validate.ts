import { zValidator } from "@hono/zod-validator";
import type { ValidationTargets } from "hono";
import type { ZodType } from "zod";
import { ApiError } from "./errors.js";

/** zod validation that fails with the API's standard 422 error shape. */
export function validate<Target extends keyof ValidationTargets, Schema extends ZodType>(target: Target, schema: Schema) {
  return zValidator(target, schema, (result) => {
    if (!result.success) {
      throw new ApiError(
        422,
        "validation_failed",
        "Some fields are invalid",
        result.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
      );
    }
  });
}
