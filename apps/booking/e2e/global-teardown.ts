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
  await db.from("staff").update({ active: false }).eq("id", f.staff.id);
  // Logins created by the tests: remove them so a used database stays clean.
  const { data: users } = await db.auth.admin.listUsers({ perPage: 200 });
  for (const user of users?.users ?? []) {
    const emails = [f.counterMember?.email, f.joiner?.email, f.staff?.email].filter(Boolean);
    if (user.email && emails.includes(user.email)) await db.auth.admin.deleteUser(user.id);
  }
}
