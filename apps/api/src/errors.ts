import type { ContentfulStatusCode } from "hono/utils/http-status";

export type ErrorCode =
  | "unauthenticated"
  | "forbidden"
  | "not_found"
  | "validation_failed"
  | "conflict"
  | "pin_invalid"
  | "pin_locked"
  | "operator_required"
  | "internal";

export class ApiError extends Error {
  constructor(
    readonly status: ContentfulStatusCode,
    readonly code: ErrorCode,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export interface PostgrestLikeError {
  code?: string;
  message: string;
}

/** Translate known database errors into API errors; anything else is an internal error. */
export function mapDbError(error: PostgrestLikeError): ApiError {
  switch (error.code) {
    case "23505":
      return new ApiError(409, "conflict", "That record already exists");
    case "23P01":
      return new ApiError(409, "conflict", "That time overlaps an existing booking");
    case "23514":
      if (error.message.includes("last active superadmin")) {
        return new ApiError(409, "conflict", "Cannot remove the last active superadmin");
      }
      return new ApiError(422, "validation_failed", error.message);
    case "23001":
      return new ApiError(409, "conflict", error.message);
    default:
      return new ApiError(500, "internal", "Database error");
  }
}
