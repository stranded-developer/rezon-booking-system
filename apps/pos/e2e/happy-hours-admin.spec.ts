/**
 * Every happy hour on one screen, each with Edit (D117). The test makes its own two packages and its
 * own hourly happy hour, so it never moves a real price and passes on a used database.
 */
import { expect, test, type Page } from "@playwright/test";
import { loadFixture, localSupabase, money } from "./fixture";

async function signInAsOwner(page: Page) {
  const f = loadFixture();
  await page.goto("/");
  await page.getByLabel("Staff email").fill(f.owner.email);
  await page.getByLabel("Password").fill(f.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("button", { name: new RegExp(f.owner.name) }).click();
  for (const digit of f.owner.pin) await page.keyboard.press(digit);
  await page.getByRole("link", { name: "Back office", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Sales" })).toBeVisible();
}

test("the owner changes happy hour to Mon–Fri for every package, and an hourly one, on one screen", async ({ page }) => {
  const f = loadFixture();
  const db = localSupabase();
  const promoName = `E2E Hour ${f.run}`;
  const hhName = `E2E Hourly ${f.run}`;

  const { data: packages, error } = await db
    .from("experiences")
    .insert([
      { key: `e2e_hh_a_${f.run}`, resource_type_id: f.resourceTypeId, name: `E2E Short ${f.run}`, minutes: 30, price_cents: 3500, online: false, at_counter: true },
      { key: `e2e_hh_b_${f.run}`, resource_type_id: f.resourceTypeId, name: `E2E Long ${f.run}`, minutes: 60, price_cents: 5800, online: false, at_counter: true },
    ])
    .select("id");
  expect(error).toBeNull();
  const ids = packages!.map((p) => p.id as string);
  const every = [1, 2, 3, 4, 5, 6, 7];
  await db.from("experience_promos").insert([
    { experience_id: ids[0], name: promoName, days_of_week: every, start_time: "12:00", end_time: "15:00", price_cents: 2900 },
    { experience_id: ids[1], name: promoName, days_of_week: every, start_time: "12:00", end_time: "15:00", price_cents: 4900 },
  ]);
  await db.from("happy_hours").insert({ name: hhName, resource_type_ids: [f.resourceTypeId], days_of_week: every, start_time: "12:00", end_time: "15:00", discount_bp: 1000 });

  try {
    await signInAsOwner(page);
    await page.getByRole("link", { name: "Rates & happy hours", exact: true }).first().click();
    await expect(page.getByRole("heading", { name: "Packages — a price of their own" })).toBeVisible();

    // ── A package's happy hour: Mon–Fri, for every package with that name ──
    const shortRow = page.getByRole("row").filter({ hasText: `E2E Short ${f.run}` });
    await expect(shortRow).toContainText(money(2900));
    await shortRow.getByRole("button", { name: "Edit" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("button", { name: "Sat", exact: true }).click();
    await dialog.getByRole("button", { name: "Sun", exact: true }).click();
    await expect(dialog.getByRole("checkbox", { name: new RegExp(`every package's ${promoName}`) })).toBeChecked();
    await page.screenshot({ path: "test-results/screens/happy-hours-01-edit-package.png" });
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(dialog).toBeHidden();
    await expect(shortRow).toContainText("Mon–Fri");
    await expect(page.getByRole("row").filter({ hasText: `E2E Long ${f.run}` })).toContainText("Mon–Fri");

    const { data: promos } = await db.from("experience_promos").select("days_of_week, price_cents").eq("name", promoName).order("price_cents");
    // The days moved together; each package kept its own price.
    expect(promos).toEqual([
      { days_of_week: [1, 2, 3, 4, 5], price_cents: 2900 },
      { days_of_week: [1, 2, 3, 4, 5], price_cents: 4900 },
    ]);

    // ── An hourly happy hour, edited in place ──
    const hhRow = page.getByRole("row").filter({ hasText: hhName });
    await hhRow.getByRole("button", { name: "Edit" }).click();
    await dialog.getByRole("button", { name: "Sat", exact: true }).click();
    await dialog.getByRole("button", { name: "Sun", exact: true }).click();
    await dialog.getByRole("button", { name: "Save happy hour" }).click();
    await expect(dialog).toBeHidden();
    await expect(hhRow).toContainText("Mon–Fri");
    await page.screenshot({ path: "test-results/screens/happy-hours-02-saved.png", fullPage: true });
    const { data: hh } = await db.from("happy_hours").select("days_of_week, discount_bp").eq("name", hhName).single();
    expect(hh).toEqual({ days_of_week: [1, 2, 3, 4, 5], discount_bp: 1000 });
  } finally {
    await db.from("happy_hours").update({ active: false }).eq("name", hhName);
    await db.from("experiences").update({ active: false }).in("id", ids);
  }
});
