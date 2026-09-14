import { createHash, randomBytes, randomUUID } from "node:crypto";
import { addDaysToDate, localToInstant, toLocal } from "@raceground/pricing";
import { localSupabase, saveFixture, type Fixture } from "./fixture";

/** Seeds staff, a test table, a member with a QR card and a booking later today. */
export default async function globalSetup() {
  const db = localSupabase();
  const run = randomUUID().slice(0, 6);
  const password = "e2e-password-123";

  // Finish anything left open so the single till can be opened by the test.
  const { data: open } = await db.from("sessions").select("id, kind, opened_at, opened_by").eq("status", "open");
  for (const s of open ?? []) {
    if (s.kind === "walk_in") {
      await db.rpc("pos_void_session", { p_session: s.id, p_staff: s.opened_by, p_reason: "e2e isolation", p_now: s.opened_at });
    }
  }
  const { data: shift } = await db.from("shifts").select("id, staff_id").is("closed_at", null).maybeSingle();
  if (shift) {
    const { data: t } = await db.rpc("pos_shift_totals", { p_shift: shift.id }).single<{ expected_cash_cents: number; pos_card_total_cents: number }>();
    const { error } = await db.rpc("pos_close_shift", {
      p_staff: shift.staff_id,
      p_counted_cash_cents: Math.max(0, t!.expected_cash_cents),
      p_terminal_card_total_cents: Math.max(0, t!.pos_card_total_cents),
    });
    if (error) throw new Error(`Could not close the open shift before the e2e run: ${error.message}`);
  }

  const makeStaff = async (role: "cashier" | "superadmin", name: string, pin: string) => {
    const email = `e2e-${role}-${run}@raceground.test`;
    const { data: user, error } = await db.auth.admin.createUser({ email, password, email_confirm: true });
    if (error) throw error;
    // Same scrypt format as the API (lib/pin.ts).
    const { scryptSync } = await import("node:crypto");
    const salt = randomBytes(16);
    const hash = `scrypt$16384$8$1$${salt.toString("base64")}$${scryptSync(pin, salt, 32, { N: 16384, r: 8, p: 1 }).toString("base64")}`;
    const { data: staff, error: staffError } = await db
      .from("staff")
      .insert({ auth_user_id: user.user.id, display_name: name, role, pin_hash: hash })
      .select("id")
      .single();
    if (staffError) throw staffError;
    return { id: staff.id as string, email, name, pin };
  };

  const cashier = await makeStaff("cashier", `E2E Cashier ${run}`, "1357");
  const owner = await makeStaff("superadmin", `E2E Owner ${run}`, "2468");

  const { data: type } = await db.from("resource_types").select("id").eq("key", "billiard").single();
  const resourceLabel = `E2E Table ${run}`;
  const { data: resource, error: resourceError } = await db
    .from("resources")
    .insert({ resource_type_id: type!.id, label: resourceLabel, sort: 0 })
    .select("id")
    .single();
  if (resourceError) throw resourceError;

  const memberToken = randomBytes(32).toString("base64url");
  const memberName = `E2E Member ${run}`;
  const { data: customer } = await db.from("customers").insert({ name: memberName, email: `e2e-member-${run}@raceground.test` }).select("id").single();
  const { data: tier } = await db.from("membership_tiers").select("id").eq("name", "Gold").single();
  const { error: memberError } = await db.from("members").insert({
    customer_id: customer!.id,
    tier_id: tier!.id,
    status: "active",
    qr_token_hash: createHash("sha256").update(memberToken).digest("hex"),
  });
  if (memberError) throw memberError;

  // A booking at the last hour of today (venue time) on the test table.
  const today = toLocal(Date.now(), "Australia/Sydney").date;
  const start = localToInstant(today, "23:00", "Australia/Sydney");
  const end = localToInstant(addDaysToDate(today, 1), "00:00", "Australia/Sydney");
  const bookingCustomer = `E2E Guest ${run}`;
  const { data: guest } = await db.from("customers").insert({ name: bookingCustomer, phone: "0400000000" }).select("id").single();
  const { error: bookingError } = await db.from("bookings").insert({
    resource_id: resource!.id,
    customer_id: guest!.id,
    period: `[${new Date(start).toISOString()},${new Date(end).toISOString()})`,
    status: "confirmed",
    total_cents: 3000,
    gst_cents: 273,
    pricing_snapshot: {},
  });
  if (bookingError) throw bookingError;

  const { data: settings } = await db.from("venue_settings").select("business_name").eq("id", 1).single();
  const fixture: Fixture = {
    run,
    password,
    cashier,
    owner,
    resourceId: resource!.id,
    resourceLabel,
    memberToken,
    memberName,
    bookingCustomer,
    originalBusinessName: settings?.business_name ?? null,
  };
  saveFixture(fixture);
}
