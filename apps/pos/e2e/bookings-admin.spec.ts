import { expect, test, type Page } from "@playwright/test";
import { loadFixture, localSupabase } from "./fixture";

const shot = (page: Page, name: string) => page.screenshot({ path: `test-results/screens/${name}.png`, fullPage: true });

/** Sign in as the owner and open the back office. */
async function openBackOffice(page: Page) {
  const f = loadFixture();
  await page.goto("/");
  await page.getByLabel("Staff email").fill(f.owner.email);
  await page.getByLabel("Password").fill(f.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("button", { name: new RegExp(f.owner.name) }).click();
  for (const d of f.owner.pin) await page.keyboard.press(d);
  await page.getByRole("link", { name: "Back office", exact: true }).click();
}

test("a superadmin finds a booking and cancels it as the venue's fault", async ({ page }) => {
  const f = loadFixture();
  const db = localSupabase();
  await openBackOffice(page);

  await page.getByRole("link", { name: "Bookings", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Bookings" })).toBeVisible();

  // The page opens on today; the booking may be tomorrow, so set the day either way.
  await page.getByRole("textbox", { name: "Day" }).fill(f.adminBooking.date);
  const row = page.getByRole("row", { name: new RegExp(f.adminBooking.ref) });
  await expect(row).toBeVisible();
  await expect(row).toContainText(f.adminBooking.customer);
  await expect(row).toContainText("confirmed");
  await expect(row).toContainText(f.adminBooking.startTime);
  await expect(row).toContainText(f.adminBooking.resourceLabel);

  // Search narrows the day to one booking, and a code that isn't there shows nothing.
  await page.getByLabel("Search bookings").fill(f.adminBooking.ref);
  await page.getByRole("button", { name: "Search" }).click();
  await expect(page.getByRole("row", { name: new RegExp(f.adminBooking.ref) })).toBeVisible();
  await page.getByLabel("Search bookings").fill("ZZZZZZ");
  await page.getByRole("button", { name: "Search" }).click();
  await expect(page.getByText("Nothing here yet.")).toBeVisible();
  await page.getByRole("button", { name: "Clear" }).click();

  // Open it: the policy refund is shown before anything is cancelled.
  await page.getByRole("row", { name: new RegExp(f.adminBooking.ref) }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText(f.adminBooking.customer);
  await expect(dialog).toContainText(f.adminBooking.resourceLabel);
  // 2–24 hours before the start, so the policy is the half refund…
  await expect(dialog.getByTestId("policy-refund")).toContainText("half");
  await shot(page, "admin-07-booking");

  // A reason is required.
  const cancelButton = dialog.getByRole("button", { name: /Cancel booking and refund/ });
  await expect(cancelButton).toBeDisabled();
  // …and marking it as the venue's fault re-quotes it under the venue rule (full refund, any time).
  await dialog.getByLabel("Our fault (full refund and free minutes back, whenever it is)").check();
  await expect(dialog.getByTestId("policy-refund")).toContainText("venue");
  await dialog.getByLabel("Reason").fill("Table out of order");
  await expect(cancelButton).toBeEnabled();
  await cancelButton.click();

  await expect(page.getByRole("row", { name: new RegExp(f.adminBooking.ref) })).toContainText("cancelled");
  await shot(page, "admin-08-booking-cancelled");

  // The database has the cancellation with its reason, and the audit log names the operator.
  const { data: booking } = await db.from("bookings").select("status, cancel_reason, cancelled_by_staff_id").eq("ref", f.adminBooking.ref).single();
  expect(booking!.status).toBe("cancelled");
  expect(booking!.cancel_reason).toBe("Table out of order");
  expect(booking!.cancelled_by_staff_id).toBe(f.owner.id);

  const { data: audit } = await db
    .from("audit_log")
    .select("actor_staff_id, action, reason")
    .eq("entity", "bookings")
    .order("id", { ascending: false })
    .limit(5);
  expect(audit!.some((a) => a.actor_staff_id === f.owner.id && a.reason === "Table out of order")).toBe(true);

  // It can't be cancelled twice.
  await page.getByRole("row", { name: new RegExp(f.adminBooking.ref) }).click();
  await expect(page.getByRole("dialog")).toContainText("already cancelled");
  await page.keyboard.press("Escape");

  // ── Inside 2 hours: the policy refuses, but the venue can still cancel ─────
  await page.getByRole("textbox", { name: "Day" }).fill(f.adminBookingSoon.date);
  await page.getByRole("row", { name: new RegExp(f.adminBookingSoon.ref) }).click();
  const soon = page.getByRole("dialog");
  await expect(soon.getByTestId("policy-refund")).toContainText("Less than 2 hours before the start");
  await soon.getByLabel("Reason").fill("Power outage");
  // Without marking it as the venue's fault, the API refuses this close to the start.
  await soon.getByRole("button", { name: /Cancel booking and refund/ }).click();
  await expect(soon.getByRole("alert")).toContainText(/2 hours/i);
  await soon.getByLabel("Our fault (full refund and free minutes back, whenever it is)").check();
  await soon.getByRole("button", { name: /Cancel booking and refund/ }).click();
  await expect(page.getByRole("row", { name: new RegExp(f.adminBookingSoon.ref) })).toContainText("cancelled");

  const { data: soonBooking } = await db.from("bookings").select("status, cancel_reason").eq("ref", f.adminBookingSoon.ref).single();
  expect(soonBooking).toMatchObject({ status: "cancelled", cancel_reason: "Power outage" });
});
