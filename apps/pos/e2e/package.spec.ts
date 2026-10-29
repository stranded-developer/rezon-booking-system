import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { toLocal } from "@raceground/pricing";
import { loadFixture, localSupabase, money } from "./fixture";

test("a walk-in package is paid up front, shows its end time, and closes with nothing to pay (D115)", async ({ page }) => {
  const f = loadFixture();
  const local = toLocal(Date.now(), "Australia/Sydney");
  test.skip(local.minuteOfDay < 10 * 60 || local.minuteOfDay >= 20 * 60 + 45, `Walk-ins are only possible 10:00–20:45 Sydney time (now ${local.label})`);
  const db = localSupabase();

  // This run's own table type gets a 30-minute counter package of its own, so no real price can move it.
  const key = `e2e_pkg_${randomUUID().slice(0, 6)}`;
  const { data: pkg, error } = await db
    .from("experiences")
    .insert({ key, resource_type_id: f.resourceTypeId, name: "Half hour", minutes: 30, price_cents: 1450, online: false, at_counter: true })
    .select("id")
    .single();
  expect(error).toBeNull();

  try {
    await page.goto("/");
    await page.getByLabel("Staff email").fill(f.cashier.email);
    await page.getByLabel("Password").fill(f.password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.getByRole("button", { name: new RegExp(f.cashier.name) }).click();
    for (const d of f.cashier.pin) await page.keyboard.press(d);

    const header = page.locator("header");
    await header.getByRole("button", { name: "No shift open" }).click();
    await page.getByRole("button", { name: "Open till with $200.00" }).click();
    await page.keyboard.press("Escape");

    const tile = page.getByRole("button", { name: new RegExp(f.resourceLabel) });
    await tile.click();
    await expect(page.getByRole("button", { name: "Open time (pay at the end)" })).toBeVisible();
    await page.getByTestId("package-option").filter({ hasText: "Half hour" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByTestId("package-total")).toHaveText(money(1450));
    await expect(dialog).toContainText("nothing to pay at the end");
    await page.screenshot({ path: "test-results/screens/package-01-pay.png" });

    await dialog.getByRole("button", { name: "Cash", exact: true }).click();
    await dialog.getByLabel("Cash received").fill("20.00");
    await dialog.getByRole("button", { name: "Take $14.50 cash and start" }).click();
    await expect(page.getByTestId("package-started")).toContainText("Time is up at");
    await expect(page.getByText("Change due").locator("..")).toContainText("$5.50");
    await page.screenshot({ path: "test-results/screens/package-02-started.png" });
    await page.getByRole("button", { name: "Done" }).click();
    await expect(tile).toContainText("Half hour until");

    // Closing early or late takes nothing more.
    await tile.click();
    await page.getByRole("button", { name: "Close & pay" }).click();
    await expect(dialog).toContainText("Paid in advance — nothing to pay");
    await expect(dialog.locator(".text-5xl").first()).toHaveText("$0.00");
    await dialog.getByRole("button", { name: "Close session" }).click();
    await page.getByRole("button", { name: "Done" }).click();
    await expect(tile).toContainText("Free");

    const { data: payments } = await db.from("payments").select("method, amount_cents, sessions!inner(experience_id)").eq("sessions.experience_id", pkg!.id);
    expect(payments).toEqual([{ method: "cash", amount_cents: 1450, sessions: { experience_id: pkg!.id } }]);

    // Close the till with the exact count.
    await header.getByRole("button", { name: /Till open/ }).click();
    await page.getByLabel("Cash counted in drawer").fill("214.50");
    await page.getByLabel("CommBank terminal end-of-day total").fill("0.00");
    await page.getByRole("button", { name: "Close till" }).click();
    await expect(page.getByText("Cash variance").locator("..")).toContainText("$0.00");
    await page.getByRole("button", { name: "Done" }).click();
  } finally {
    await db.from("experiences").update({ active: false }).eq("id", pkg!.id);
  }
});
