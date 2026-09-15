import { loadFixture, localSupabase } from "./fixture";

/** Hide the seeded data again. Staff and resources are referenced by audit/money records, so deactivate. */
export default async function globalTeardown() {
  const db = localSupabase();
  const f = loadFixture();
  await db.from("bookings").update({ status: "cancelled", cancelled_at: new Date().toISOString(), cancel_reason: "e2e teardown" }).in("resource_id", [f.resourceId, f.adminBooking.resourceId, f.adminBookingSoon.resourceId]).in("status", ["confirmed", "held"]);
  await db.from("resources").update({ active: false }).in("id", [f.resourceId, f.adminBooking.resourceId, f.adminBookingSoon.resourceId]);
  await db.from("referral_codes").update({ active: false }).eq("created_by", f.owner.id);
  await db.from("venue_settings").update({ business_name: f.originalBusinessName, ...f.originalWebsite }).eq("id", 1);
  // Photos the back office test uploaded (it removes its own, this catches a failed run).
  const { data: photos } = await db.from("venue_photos").select("id, storage_path").like("caption", `%E2E ${f.run}%`);
  if (photos?.length) {
    await db.from("venue_photos").delete().in("id", photos.map((p) => p.id));
    await db.storage.from("venue-photos").remove(photos.map((p) => p.storage_path));
  }
  await db.from("staff").update({ active: false }).in("id", [f.cashier.id]);
  // The e2e owner may be the only superadmin in a fresh database; the guard keeps it active in that case.
  await db.from("staff").update({ active: false }).eq("id", f.owner.id);
}
