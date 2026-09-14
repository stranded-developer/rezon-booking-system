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
  | "insufficient_balance"
  | "internal"
  /** Domain codes raised by database functions as RG:<code>:<message>. */
  | (string & {});

const DOMAIN_STATUS: Record<string, ContentfulStatusCode> = {
  not_found: 404,
  invalid: 422,
  tendered_insufficient: 422,
  gst_mismatch: 422,
  total_mismatch: 422,
};

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
  const domain = /^RG:([a-z_]+):(.*)$/s.exec(error.message);
  if (domain) {
    const [, code, message] = domain as unknown as [string, string, string];
    return new ApiError(DOMAIN_STATUS[code] ?? 409, code, message);
  }
  switch (error.code) {
    case "23505":
      return new ApiError(409, "conflict", "That record already exists");
    case "23P01":
      return new ApiError(409, "conflict", "That time overlaps an existing booking");
    case "23514":
      if (error.message.includes("Insufficient free-play balance")) {
        return new ApiError(422, "insufficient_balance", "Not enough free-play minutes");
      }
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
