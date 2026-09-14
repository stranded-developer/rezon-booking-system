import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { loadFixture, localSupabase } from "./fixture";

test("a booking that runs over pops up a time-up alert and closes with nothing to pay", async ({ page }) => {
  const f = loadFixture();
  const db = localSupabase();

  // A table whose booking ended 5 minutes ago, with the customer still checked in.
  const label = `E2E Late ${randomUUID().slice(0, 4)}`;
  const { data: type } = await db.from("resource_types").select("id").eq("key", "billiard").single();
  const { data: resource, error: rErr } = await db.from("resources").insert({ resource_type_id: type!.id, label, sort: 1 }).select("id").single();
  expect(rErr).toBeNull();
  const { data: guest } = await db.from("customers").insert({ name: `Late Guest ${label}`, phone: "0400000001" }).select("id").single();
  const start = new Date(Date.now() - 65 * 60_000);
  const end = new Date(Date.now() - 5 * 60_000);
  const { data: booking, error: bErr } = await db
    .from("bookings")
    .insert({ resource_id: resource!.id, customer_id: guest!.id, period: `[${start.toISOString()},${end.toISOString()})`, status: "confirmed", total_cents: 3000, gst_cents: 273, pricing_snapshot: {} })
    .select("id")
    .single();
  expect(bErr).toBeNull();
  const { error: aErr } = await db.rpc("pos_arrive_booking", { p_booking: booking!.id, p_staff: f.cashier.id, p_now: start.toISOString() });
  expect(aErr).toBeNull();

  try {
    await page.goto("/");
    await page.getByLabel("Staff email").fill(f.cashier.email);
    await page.getByLabel("Password").fill(f.password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.getByRole("button", { name: new RegExp(f.cashier.name) }).click();
    for (const d of f.cashier.pin) await page.keyboard.press(d);

    const alert = page.getByRole("alertdialog");
    await expect(alert).toContainText(`${label} — time is up`);
    await expect(alert).toContainText(/Booking ended at \d\d:\d\d \(5 min ago\)/);
    await page.screenshot({ path: "test-results/screens/time-up-01-alert.png" });

    // Snooze hides it for now.
    await alert.getByRole("button", { name: "Remind me in 2 min" }).click();
    await expect(page.getByRole("alertdialog")).toHaveCount(0);

    // After a reload (operator locked again) it comes back; close the table straight from the alert.
    await page.reload();
    await page.getByRole("button", { name: new RegExp(f.cashier.name) }).click();
    for (const d of f.cashier.pin) await page.keyboard.press(d);
    await page.getByRole("alertdialog").getByRole("button", { name: `Close ${label}` }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText("Prepaid booking — nothing to pay");
    await expect(dialog.locator(".text-5xl").first()).toHaveText("$0.00");
    await page.screenshot({ path: "test-results/screens/time-up-02-close.png" });
    await dialog.getByRole("button", { name: "Close session" }).click();
    await page.getByRole("button", { name: "Done" }).click();
    await expect(page.getByRole("alertdialog")).toHaveCount(0);
    await expect(page.getByRole("button", { name: new RegExp(label) })).toContainText("Free");

    const { count } = await db.from("payments").select("id", { count: "exact", head: true }).eq("session_id", (await db.from("sessions").select("id").eq("booking_id", booking!.id).single()).data!.id);
    expect(count).toBe(0);
  } finally {
    await db.from("resources").update({ active: false }).eq("id", resource!.id);
  }
});
