/**
 * Selling a membership paid for at the counter (D61). No Stripe involved, so this runs always.
 */
import { expect, test } from "@playwright/test";
import { loadFixture, localSupabase, money, tierValues } from "./fixture";

/** This test opens the till; leave it closed for whatever runs next. */
test.afterAll(async () => {
  const db = localSupabase();
  const { data: shift } = await db.from("shifts").select("id, staff_id").is("closed_at", null).maybeSingle();
  if (!shift) return;
  const { data: totals } = await db.rpc("pos_shift_totals", { p_shift: shift.id }).single<{ expected_cash_cents: number; pos_card_total_cents: number }>();
  await db.rpc("pos_close_shift", {
    p_staff: shift.staff_id,
    p_counted_cash_cents: Math.max(0, totals!.expected_cash_cents),
    p_terminal_card_total_cents: Math.max(0, totals!.pos_card_total_cents),
  });
});

test("a cashier sells three months of Silver for cash and prints the card", async ({ page }) => {
  const f = loadFixture();
  const db = localSupabase();
  const name = `E2E Counter ${f.run}`;
  const email = `e2e-counter-${f.run}@raceground.test`;

  // Sign the till in and open the shift, so there is somewhere for the money to go.
  await page.goto("/");
  await page.getByLabel("Staff email").fill(f.cashier.email);
  await page.getByLabel("Password").fill(f.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("button", { name: new RegExp(f.cashier.name) }).click();
  for (const d of f.cashier.pin) await page.keyboard.press(d);

  const till = page.getByRole("button", { name: /No shift open|Shift/ });
  await expect(till).toBeVisible();
  if ((await till.textContent())?.includes("No shift open")) {
    await till.click();
    const shift = page.getByRole("dialog");
    await shift.getByLabel("Opening float").fill("200.00");
    await shift.getByRole("button", { name: "Open till with $200.00" }).click();
    // Opening the till turns the dialog into the till report; close it to get back to the floor.
    await expect(page.getByText("Expected in drawer")).toBeVisible();
    await page.keyboard.press("Escape");
  }

  // Sell it.
  await page.getByRole("button", { name: "Sell membership" }).click();
  const sale = page.getByRole("dialog");
  await sale.getByRole("button", { name: /At the counter/ }).click();
  await sale.getByRole("button", { name: /^Silver/ }).click();
  await sale.getByRole("button", { name: "3 months" }).click();
  await sale.getByRole("button", { name: "Cash", exact: true }).click();
  await sale.getByLabel("Name").fill(name);
  await sale.getByLabel(/^Email/).fill(email);

  // The tier's own monthly price for three months, shown before anything is taken.
  const silver = await tierValues("Silver");
  const threeMonths = money(silver.monthlyPriceCents * 3);
  await expect(sale.getByRole("button", { name: `Take ${threeMonths}` })).toBeEnabled();
  await sale.getByRole("button", { name: `Take ${threeMonths}` }).click();

  const done = sale.getByTestId("counter-sale-done");
  await expect(done).toBeVisible();
  await expect(done).toContainText(name);
  await expect(done).toContainText(`${threeMonths} taken (cash)`);
  await expect(done).toContainText("180 min free play");
  await expect(done).toContainText("not billed automatically");
  await expect(sale.getByTestId("member-qr").locator("svg")).toBeVisible();
  await page.screenshot({ path: "test-results/screens/membership-counter.png", fullPage: true });

  // The database agrees: active member, no subscription, cash on the till, minutes granted.
  const { data: customer } = await db.from("customers").select("id").eq("email", email).single();
  const { data: member } = await db.from("members").select("id, status, stripe_subscription_id, current_period_end").eq("customer_id", customer!.id).single();
  expect(member).toMatchObject({ status: "active", stripe_subscription_id: null });
  expect(new Date(member!.current_period_end!).getTime()).toBeGreaterThan(Date.now());

  const { data: payment } = await db.from("payments").select("id, method, amount_cents, gst_cents").eq("member_id", member!.id).single();
  expect(payment).toMatchObject({ method: "cash", amount_cents: silver.monthlyPriceCents * 3, gst_cents: Math.round((silver.monthlyPriceCents * 3) / 11) });

  const { count: movements } = await db.from("cash_movements").select("id", { count: "exact", head: true }).eq("payment_id", payment!.id);
  expect(movements).toBe(1);

  const { data: balance } = await db.from("member_balances").select("balance_minutes").eq("member_id", member!.id).single();
  expect(balance!.balance_minutes).toBe(180);

  // The member can now be found at the counter by name.
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
});
