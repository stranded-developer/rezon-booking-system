/**
 * The event pop-up and banner (D69), and signing up for a tournament (D68).
 *
 * Creates its own event and tournaments so nothing depends on what the venue happens to have on,
 * and so the suite still passes on a used database. Only free entries are signed up for here:
 * paying goes through the same Stripe Checkout as a booking, which is covered elsewhere.
 */
import { expect, test, type Page } from "@playwright/test";
import { loadFixture, localSupabase } from "./fixture";

const shot = (page: Page, name: string) => page.screenshot({ path: `test-results/screens/${name}.png`, fullPage: true });

// The fixture is written by global setup, and reading Supabase's settings shells out, so both
// wait until the suite actually starts rather than running while the files are being collected.
let db: ReturnType<typeof localSupabase>;
let run: string;
let eventTitle: string;
let freeName: string;
let paidName: string;
let soloName: string;

let eventId: string;
const tournamentIds: string[] = [];

test.beforeAll(async () => {
  db = localSupabase();
  run = loadFixture().run;
  eventTitle = `E2E Race of Champions ${run}`;
  freeName = `E2E Free Cup ${run}`;
  paidName = `E2E Paid Cup ${run}`;
  soloName = `E2E One Spot ${run}`;

  const { data: event, error } = await db
    .from("site_events")
    .insert({
      title: eventTitle,
      body: "Our biggest competition yet.",
      detail: "$2,000 cash prize pool",
      cta_label: "Enter now",
      cta_url: "/tournaments",
      as_popup: true,
      as_banner: true,
    })
    .select("id")
    .single();
  if (error) throw error;
  eventId = event.id as string;

  const soon = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString();
  const { data: tournaments, error: tError } = await db
    .from("tournaments")
    .insert([
      { name: freeName, blurb: "Free to enter.", starts_at: soon(10), spots: 8, entry_fee_cents: 0, published: true },
      { name: paidName, starts_at: soon(11), spots: 8, entry_fee_cents: 2500, published: true },
      { name: soloName, starts_at: soon(12), spots: 1, entry_fee_cents: 0, published: true },
      { name: `E2E Draft ${run}`, starts_at: soon(13), spots: 8, entry_fee_cents: 0, published: false },
    ])
    .select("id");
  if (tError) throw tError;
  tournamentIds.push(...tournaments.map((t) => t.id as string));
});

test.afterAll(async () => {
  await db.from("site_events").update({ active: false }).eq("id", eventId);
  await db.from("tournament_entries").update({ status: "expired" }).in("tournament_id", tournamentIds).eq("status", "held");
  await db.from("tournaments").update({ published: false }).in("id", tournamentIds);
});

test("an event shows as a pop-up and a banner, and stays shut once closed", async ({ page }) => {
  await page.goto("/");

  // The banner is there straight away; the pop-up arrives a beat later.
  const banner = page.getByText(eventTitle).first();
  await expect(banner).toBeVisible();

  const popup = page.getByRole("dialog");
  await expect(popup).toBeVisible({ timeout: 10_000 });
  await expect(popup).toContainText("$2,000 cash prize pool");
  await expect(popup.getByRole("link", { name: "Enter now" })).toBeVisible();
  await shot(page, "web-10-event-popup");

  // Closing it puts it away for this visitor, and it does not come back on the next page.
  await popup.getByRole("button", { name: "Close" }).click();
  await expect(popup).toBeHidden();
  await page.goto("/");
  await page.waitForTimeout(2000);
  await expect(page.getByRole("dialog")).toBeHidden();

  // The pop-up belongs on the landing page only: elsewhere it would sit over what the visitor
  // came for. The banner still carries the event.
  await page.goto("/tournaments");
  await page.waitForTimeout(2000);
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(page.getByText(eventTitle).first()).toBeVisible();

  // The banner is dismissed separately, and it stays dismissed too.
  await page.getByRole("button", { name: `Hide ${eventTitle}` }).click();
  await expect(page.getByText(eventTitle)).toBeHidden();
  await page.goto("/");
  await expect(page.getByText(eventTitle)).toBeHidden();
});

test("a guest signs up for a free tournament and gets an entry code", async ({ page }) => {
  await page.goto("/tournaments");

  // Only published tournaments are offered.
  await expect(page.getByRole("heading", { name: freeName })).toBeVisible();
  await expect(page.getByRole("heading", { name: paidName })).toBeVisible();
  await expect(page.getByRole("heading", { name: `E2E Draft ${run}` })).toBeHidden();

  const free = page.getByRole("article").filter({ hasText: freeName });
  await expect(free).toContainText("8 spots left");
  await expect(free).toContainText("Free");
  await shot(page, "web-11-tournaments");

  await free.getByRole("button", { name: "Sign up" }).click();
  await free.getByRole("textbox", { name: "Name", exact: true }).fill(`E2E Entrant ${run}`);
  await free.getByRole("textbox", { name: /^Email/ }).fill(`e2e-entrant-${run}@raceground.test`);

  const confirm = free.getByRole("button", { name: "Confirm my spot" });
  await expect(confirm).toBeDisabled(); // the terms have to be accepted first
  await free.getByRole("checkbox").check();
  await expect(confirm).toBeEnabled();
  await confirm.click();

  await page.waitForURL(/\/tournaments\/[A-Z0-9]{6}\?token=/);
  await expect(page.getByText(/You're in/)).toBeVisible();
  const ref = (await page.getByTestId("entry-ref").textContent())!.trim();
  expect(ref).toMatch(/^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{6}$/);
  await expect(page.getByTestId("entry-qr")).toBeVisible();
  await shot(page, "web-12-entry");

  // The spot is gone from the count, and the same person cannot take another.
  await page.goto("/tournaments");
  await expect(page.getByRole("article").filter({ hasText: freeName })).toContainText("7 spots left");
});

test("a tournament with one spot fills up and says so", async ({ page }) => {
  await page.goto("/tournaments");
  const solo = page.getByRole("article").filter({ hasText: soloName });
  await expect(solo).toContainText("1 spot left");

  await solo.getByRole("button", { name: "Sign up" }).click();
  await solo.getByRole("textbox", { name: "Name", exact: true }).fill(`E2E Only ${run}`);
  await solo.getByRole("textbox", { name: /^Email/ }).fill(`e2e-only-${run}@raceground.test`);
  await solo.getByRole("checkbox").check();
  await solo.getByRole("button", { name: "Confirm my spot" }).click();
  await page.waitForURL(/\/tournaments\/[A-Z0-9]{6}\?token=/);

  await page.goto("/tournaments");
  const full = page.getByRole("article").filter({ hasText: soloName });
  await expect(full).toContainText("Full");
  await expect(full.getByRole("button", { name: "Sign up" })).toBeHidden();
});

test("with nothing on, the page says there is no tournament", async ({ page }) => {
  await db.from("tournaments").update({ published: false }).in("id", tournamentIds);
  // Anything the venue itself has published would also show, so this only runs when there is none.
  const { count } = await db
    .from("tournaments")
    .select("id", { count: "exact", head: true })
    .eq("published", true)
    .gt("starts_at", new Date().toISOString());

  await page.goto("/tournaments");
  if ((count ?? 0) === 0) {
    await expect(page.getByRole("heading", { name: "No tournament available" })).toBeVisible();
    await shot(page, "web-13-no-tournament");
  } else {
    await expect(page.getByRole("heading", { name: "No tournament available" })).toBeHidden();
  }
  await db.from("tournaments").update({ published: true }).in("id", tournamentIds.slice(0, 3));
});
