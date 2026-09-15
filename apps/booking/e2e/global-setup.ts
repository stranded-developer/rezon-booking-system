import { randomBytes, randomUUID, scryptSync } from "node:crypto";
import { localSupabase, saveFixture, type Fixture } from "./fixture";

/** Its own resource type and referral codes, so a run never competes with the POS tests or a used database. */
export default async function globalSetup() {
  const db = localSupabase();
  const run = randomUUID().slice(0, 6);

  const key = `e2e_web_${run}`;
  const { data: type, error: typeError } = await db
    .from("resource_types")
    .insert({ key, name: `E2E Booth ${run}`, base_rate_cents: 3000, min_minutes: 15, sort: 900 })
    .select("id")
    .single();
  if (typeError) throw typeError;

  const labels = [`E2E Booth A ${run}`, `E2E Booth B ${run}`];
  const { data: resources, error: resourceError } = await db
    .from("resources")
    .insert(labels.map((label, i) => ({ resource_type_id: type.id, label, sort: i })))
    .select("id, label");
  if (resourceError) throw resourceError;
  const ordered = labels.map((l) => resources.find((r: { id: string; label: string }) => r.label === l)!);

  // $1,000 off makes a short booking free, so the flow can be tested without Stripe.
  const { data: codes, error: codeError } = await db
    .from("referral_codes")
    .insert([
      { discount_type: "fixed", discount_value: 100_000, max_uses: 20, uses_count: 0 },
      { discount_type: "fixed", discount_value: 100_000, max_uses: 1, uses_count: 1 },
    ])
    .select("code, max_uses, uses_count");
  if (codeError) throw codeError;
  const freeCode = codes.find((c) => c.uses_count === 0)!.code as string;
  const usedUpCode = codes.find((c) => c.uses_count === 1)!.code as string;

  // A counter-sold Gold member with free play saved up: the website test signs up with this email.
  const memberEmail = `e2e-member-${run}@raceground.test`;
  const memberName = `E2E Counter Member ${run}`;
  const { data: customer, error: customerError } = await db.from("customers").insert({ name: memberName, email: memberEmail }).select("id").single();
  if (customerError) throw customerError;
  const { data: tier } = await db.from("membership_tiers").select("id, name, discount_bp").eq("name", "Gold").single();
  const { data: member, error: memberError } = await db
    .from("members")
    .insert({ customer_id: customer.id, tier_id: tier!.id, status: "active", current_period_end: new Date(Date.now() + 20 * 86_400_000).toISOString() })
    .select("id, member_no")
    .single();
  if (memberError) throw memberError;
  const { error: grantError } = await db
    .from("member_balance_ledger")
    .insert({ member_id: member.id, delta_minutes: 60, kind: "grant", reason: "e2e fixture", stripe_invoice_id: `in_e2e_${run}` });
  if (grantError) throw grantError;

  // A superadmin the membership test uses to sync tiers with Stripe (same scrypt format as the API).
  const staffEmail = `e2e-web-staff-${run}@raceground.test`;
  const staffPin = "2468";
  const { data: staffUser, error: staffUserError } = await db.auth.admin.createUser({ email: staffEmail, password: "e2e-password-123", email_confirm: true });
  if (staffUserError) throw staffUserError;
  const salt = randomBytes(16);
  const pinHash = `scrypt$16384$8$1$${salt.toString("base64")}$${scryptSync(staffPin, salt, 32, { N: 16384, r: 8, p: 1 }).toString("base64")}`;
  const { data: staff, error: staffError } = await db
    .from("staff")
    .insert({ auth_user_id: staffUser.user.id, display_name: `E2E Web Staff ${run}`, role: "superadmin", pin_hash: pinHash })
    .select("id")
    .single();
  if (staffError) throw staffError;

  const fixture: Fixture = {
    run,
    resourceTypeId: type.id,
    resourceTypeKey: key,
    resourceTypeName: `E2E Booth ${run}`,
    resourceIds: ordered.map((r) => r.id),
    resourceLabels: labels,
    freeCode,
    usedUpCode,
    customerEmail: `e2e-web-${run}@raceground.test`,
    counterMember: { name: memberName, email: memberEmail, memberNo: member.member_no as string, tierName: tier!.name as string, balanceMinutes: 60 },
    joiner: { name: `E2E Joiner ${run}`, email: `e2e-joiner-${run}@raceground.test` },
    password: "e2e-password-123",
    staff: { id: staff.id as string, email: staffEmail, pin: staffPin },
  };
  saveFixture(fixture);
}
