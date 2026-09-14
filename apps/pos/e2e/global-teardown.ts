import { loadFixture, localSupabase } from "./fixture";

/** Hide the seeded data again. Staff and resources are referenced by audit/money records, so deactivate. */
export default async function globalTeardown() {
  const db = localSupabase();
  const f = loadFixture();
  await db.from("bookings").update({ status: "cancelled", cancelled_at: new Date().toISOString(), cancel_reason: "e2e teardown" }).eq("resource_id", f.resourceId).eq("status", "confirmed");
  await db.from("resources").update({ active: false }).eq("id", f.resourceId);
  await db.from("referral_codes").update({ active: false }).eq("created_by", f.owner.id);
  await db.from("venue_settings").update({ business_name: f.originalBusinessName }).eq("id", 1);
  await db.from("staff").update({ active: false }).in("id", [f.cashier.id]);
  // The e2e owner may be the only superadmin in a fresh database; the guard keeps it active in that case.
  await db.from("staff").update({ active: false }).eq("id", f.owner.id);
}
