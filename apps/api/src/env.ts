import { z } from "zod";

const EnvSchema = z.object({
  SUPABASE_URL: z.url(),
  /** Secret / service-role key. Server only. */
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20),
  /** HMAC secret for POS operator tokens. */
  OPERATOR_TOKEN_SECRET: z.string().min(32, "OPERATOR_TOKEN_SECRET must be at least 32 characters"),
  /** Operator token lifetime; each authenticated request slides it forward (idle lock). */
  OPERATOR_IDLE_SECONDS: z.coerce.number().int().positive().default(300),
  PIN_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),
  PIN_LOCK_MINUTES: z.coerce.number().int().positive().default(5),
  /** HMAC secret member QR tokens are derived from. Changing it invalidates every member QR. */
  QR_TOKEN_SECRET: z.string().min(32, "QR_TOKEN_SECRET must be at least 32 characters"),
  /** Stripe secret key (sk_test_… / sk_live_…). Billing routes return 503 without it. */
  STRIPE_SECRET_KEY: z.string().startsWith("sk_").optional(),
  /** Signing secret of the webhook endpoint (whsec_…); `stripe listen` prints one for local development. */
  STRIPE_WEBHOOK_SECRET: z.string().startsWith("whsec_").optional(),
  /** Where Stripe Checkout sends the customer afterwards. */
  CHECKOUT_SUCCESS_URL: z.url().default("http://localhost:8787/checkout/complete"),
  CHECKOUT_CANCEL_URL: z.url().default("http://localhost:8787/checkout/cancelled"),
  /** Public booking website, for links in emails and where Stripe Checkout returns customers. */
  BOOKING_SITE_URL: z.url().default("http://localhost:3000").transform((v) => v.replace(/\/+$/, "")),
  /** Bearer secret for scheduled job endpoints (/cron/*). */
  CRON_SECRET: z.string().min(32).optional(),
  /** "console" logs emails (development); a real provider is added with Resend. */
  EMAIL_TRANSPORT: z.enum(["console"]).default("console"),
  EMAIL_FROM: z.string().default("Raceground <hello@raceground.local>"),
  /** Comma-separated browser origins allowed to call the API. */
  CORS_ORIGINS: z
    .string()
    .default("http://localhost:3000,http://localhost:3001")
    .transform((v) => v.split(",").map((s) => s.trim()).filter(Boolean)),
});

export type Env = z.infer<typeof EnvSchema>;

/** Every setting the API reads. `.env.example` must list them all (checked by a test). */
export const ENV_KEYS = Object.keys(EnvSchema.shape) as (keyof Env)[];

export function loadEnv(source: Record<string, string | undefined> = process.env): Env {
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid API environment:\n${problems}`);
  }
  return parsed.data;
}
