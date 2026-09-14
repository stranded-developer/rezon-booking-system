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
  /** Comma-separated browser origins allowed to call the API. */
  CORS_ORIGINS: z
    .string()
    .default("http://localhost:3000,http://localhost:3001")
    .transform((v) => v.split(",").map((s) => s.trim()).filter(Boolean)),
});

export type Env = z.infer<typeof EnvSchema>;

export function loadEnv(source: Record<string, string | undefined> = process.env): Env {
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid API environment:\n${problems}`);
  }
  return parsed.data;
}
