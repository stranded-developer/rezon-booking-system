import { loadFixture, localSupabase } from "./fixture";

/** Hide this run's test data again. Rows referenced by bookings are deactivated, not deleted. */
export default async function globalTeardown() {
  const db = localSupabase();
  const f = loadFixture();
  await db
    .from("bookings")
    .update({ status: "cancelled", cancelled_at: new Date().toISOString(), cancel_reason: "e2e teardown" })
    .in("resource_id", f.resourceIds)
    .in("status", ["held", "confirmed"]);
  await db.from("resources").update({ active: false }).in("id", f.resourceIds);
  await db.from("resource_types").update({ active: false }).eq("id", f.resourceTypeId);
  await db.from("referral_codes").update({ active: false }).in("code", [f.freeCode, f.usedUpCode]);
}
