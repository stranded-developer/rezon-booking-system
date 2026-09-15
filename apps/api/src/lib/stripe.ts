import Stripe from "stripe";
import type { AppDeps } from "../context.js";
import { ApiError } from "../errors.js";

export function requireStripe(deps: AppDeps): Stripe {
  if (!deps.stripe) throw new ApiError(503, "stripe_not_configured", "Online billing isn't set up (STRIPE_SECRET_KEY)");
  return deps.stripe;
}

/** Stripe API errors become 502s with Stripe's message; our own errors pass through. */
export async function stripeCall<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof Stripe.errors.StripeError) {
      throw new ApiError(502, "stripe_error", err.message, { type: err.type, code: err.code ?? null });
    }
    throw err;
  }
}
