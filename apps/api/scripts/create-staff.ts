/**
 * Create a staff account (sign-in + staff row + PIN) directly with the service key.
 * Used to bootstrap the first superadmin; later staff are added in the back office.
 *
 *   pnpm --filter @raceground/api staff:create -- --email owner@example.com --name "Owner" \
 *     --role superadmin --pin 1234 --password 'a-strong-password'
 */
import { parseArgs } from "node:util";
import { createServiceClient } from "@raceground/db";
import { loadEnv } from "../src/env.js";
import { createStaff } from "../src/services/staff.js";

const { values } = parseArgs({
  options: {
    email: { type: "string" },
    name: { type: "string" },
    role: { type: "string", default: "cashier" },
    pin: { type: "string" },
    password: { type: "string" },
  },
});

const { email, name, role, pin, password } = values;
if (!email || !name || !pin || !password || (role !== "superadmin" && role !== "cashier")) {
  console.error("Usage: staff:create --email <email> --name <name> --role superadmin|cashier --pin <4 digits> --password <min 8 chars>");
  process.exit(1);
}
if (!/^\d{4}$/.test(pin) || password.length < 8) {
  console.error("PIN must be 4 digits and password at least 8 characters.");
  process.exit(1);
}

const env = loadEnv();
const db = createServiceClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

try {
  const staff = await createStaff(
    db,
    { email, displayName: name, role, pin, password },
    { actorStaffId: null, reason: "created with staff:create script" },
  );
  console.log(`Created ${staff.role} "${staff.display_name}" <${staff.email}> (${staff.id})`);
} catch (err) {
  console.error("Failed:", err instanceof Error ? err.message : err);
  process.exit(1);
}
