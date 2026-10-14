import { expect, test, type Locator, type Page } from "@playwright/test";
import { loadFixture, localSupabase } from "./fixture";

const shot = (page: Page, name: string) => page.screenshot({ path: `test-results/screens/${name}.png`, fullPage: true });

/** "10:00" → "10:00 am", the way the site prints a venue wall-clock time. */
function venueTime(time: string): string {
  const [h = "0", m = "00"] = time.split(":");
  const hour = Number(h) % 24;
  const twelve = hour % 12 === 0 ? 12 : hour % 12;
  return `${twelve}:${m} ${hour < 12 ? "am" : "pm"}`;
}

/** Two days out in venue time: a full day of slots, and always more than 24 hours away (full refund). */
function bookingVenueDate(): string {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Sydney", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const get = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  const at = new Date(Date.UTC(get("year"), get("month") - 1, get("day") + 2));
  return at.toISOString().slice(0, 10);
}

/**
 * Pick a day in the panel's calendar, stepping to the next month if the day is not on screen.
 *
 * The booking window can straddle a month end — on 28 September a day four days out is in
 * October — and the calendar opens on the month containing today, exactly as a person would
 * find it. This does what they would do: press the arrow.
 */
async function pickDay(panel: Locator, label: string) {
  const day = panel.getByRole("button", { name: new RegExp(`^${label}`) });
  for (let i = 0; i < 3; i++) {
    if ((await day.count()) > 0 && (await day.first().isEnabled())) break;
    await panel.getByRole("button", { name: "Next month" }).click();
  }
  await day.first().click();
}

const bookingDayLabel = () => {
  const [y, m, d] = bookingVenueDate().split("-").map(Number);
  return new Intl.DateTimeFormat("en-AU", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" })
    .format(new Date(Date.UTC(y!, m! - 1, d!)))
    .replace(/,/g, "");
};

test("the home page shows what the back office says", async ({ page }) => {
  const f = loadFixture();
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText(/sim racing/i);

  // Experiences are sold at a flat price for a fixed length (D65), straight from the database.
  // Single Session and Double Session (D83), in the wording of the owner's mockups (D98).
  const quick = page.getByRole("article").filter({ hasText: "Single Session" });
  await expect(quick.getByRole("heading", { name: "Single Session" })).toBeVisible();
  await expect(quick).toContainText("Your first lap starts here.");
  await expect(quick).toContainText("30 minutes");
  await expect(quick.getByRole("link", { name: "Book your first race" })).toHaveAttribute("href", "/book?experience=quick_race");
  const double = page.getByRole("article").filter({ hasText: "Double Session" });
  await expect(double).toContainText("Twice the time. Twice the trash talk.");
  await expect(double).toContainText("60 minutes");
  await expect(double).toContainText("Most popular");

  // Anything without an experience is still shown at its hourly rate, including this run's own
  // type. The rate comes from the fixture, not from a number typed here: it is the owner's to
  // change in the back office (D74).
  // In the mockup (D88) "Also by the hour" is the small label over each hourly card, not a heading.
  await expect(page.getByText("Also by the hour").first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "Billiard Table" })).toBeVisible();
  await expect(page.getByRole("heading", { name: f.resourceTypeName })).toBeVisible();
  await expect(page.getByText(`$${(f.resourceTypeRateCents / 100).toFixed(2)}/hr`).first()).toBeVisible();

  // The hours are the ones this suite set, shown the way the venue keeps them.
  await expect(page.getByRole("heading", { name: "Hours" })).toBeVisible();
  await expect(page.getByText(`${venueTime(f.openTime)} – ${venueTime(f.closeTime)}`).first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "Silver" })).toBeVisible();
  await shot(page, "web-01-home");

  // D87: the tile sections, from the back office, in their order under the hero.
  // D88: the mockup's hero — the rig turning through its angles, and how many simulators there are.
  await expect(page.getByRole("group", { name: "Choose an angle" }).getByRole("button")).toHaveCount(7);
  await expect(page.getByRole("link", { name: /Simulators/ }).first()).toHaveAttribute("href", "/book");
  const tiles = page.getByRole("region", { name: "What Racegrounds is" });
  await expect(tiles.getByText("Sim Racing", { exact: true })).toBeVisible();
  await expect(tiles.getByText("Compete.", { exact: true })).toBeVisible();
  const events = page.getByRole("region", { name: "Book your event" });
  // Every "Book your event" tile goes to Book now.
  for (const link of await events.getByRole("link").all()) await expect(link).toHaveAttribute("href", "/book");
  await expect(events.getByRole("link", { name: "VR Race" })).toBeVisible();
  // "Types of driving" is shown only: no links.
  const driving = page.getByRole("region", { name: "Types of driving" });
  await expect(driving.getByText("GT3", { exact: true })).toBeVisible();
  await expect(driving.getByRole("link")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: /Drivers, start your engines/i })).toHaveCount(0);

  // D81: the bottom bar is there however far down the page is scrolled. D96: Explore goes back to
  // the top of the home page, from the home page itself and from any other page.
  const bar = page.getByRole("navigation", { name: "Quick links" });
  await page.mouse.wheel(0, 4000);
  await expect(bar.getByRole("link", { name: "Book now" })).toBeInViewport();
  await expect(bar.getByRole("link", { name: "Events" })).toHaveAttribute("href", "/tournaments");
  await bar.getByRole("link", { name: "Explore" }).click();
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  await driving.scrollIntoViewIfNeeded();
  await shot(page, "web-01b-home-tiles");

  await bar.getByRole("link", { name: "Book now" }).click();
  await expect(page.getByRole("heading", { level: 1, name: /Choose your experience/i })).toBeVisible();
  await bar.getByRole("link", { name: "Explore" }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
});

test("clothing is coming soon, and the membership page is the poster", async ({ page }) => {
  await page.goto("/");
  // D86: Clothing sits next to Contact in the top bar.
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Clothing" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Clothing" })).toBeVisible();
  await expect(page.getByText("Coming soon").first()).toBeVisible();

  // D84: the membership poster, with the tiers' own numbers.
  await page.goto("/membership");
  await expect(page.getByRole("heading", { name: /Membership\s*Promo price/i })).toBeVisible();
  const gold = page.getByRole("article").filter({ hasText: "Gold" });
  await expect(gold).toContainText("Most popular");
  await expect(gold.getByText("4 FREE RACES PER MONTH")).toBeVisible();
  await expect(gold).toContainText("(Only $19.50 per race)");
  await expect(gold).toContainText("20% off next bookings");
  // The race prices are the poster's flat member prices (D82), not a percentage of the list price.
  await expect(gold).toContainText("Single Session");
  await expect(gold).toContainText("$28");
  await expect(page.getByRole("article").filter({ hasText: "Silver" })).toContainText("$32");
  await expect(page.getByText("What you'd pay")).toHaveCount(0);
  await shot(page, "web-15-membership-poster");
});

test("a guest books and cancels: the panel, spots left, a referral code, QR, refund", async ({ page }) => {
  const f = loadFixture();
  await page.goto("/book");

  // ── Step 1: date, then a time ─────────────────────────────────────────────
  // This run's own booth is sold by the hour, so it sits under "Also by the hour".
  await page.getByRole("button", { name: `Book ${f.resourceTypeName}` }).click();
  const panel = page.getByRole("dialog");
  await expect(panel.getByRole("heading", { name: f.resourceTypeName, level: 2 })).toBeVisible();

  await pickDay(panel, bookingDayLabel());
  // D90: online, a booking starts on the hour or the half hour.
  await expect(panel.getByRole("button").filter({ hasText: "10:30 am" })).toBeVisible();
  await expect(panel.getByRole("button").filter({ hasText: /\b\d{1,2}:(15|45) (am|pm)/ })).toHaveCount(0);
  const firstSlot = panel.getByRole("button").filter({ hasText: "10:00 am" });
  // D70: every start time says how many are free.
  await expect(firstSlot).toContainText(/\d+ spots?/);
  await firstSlot.click();

  // ── Step 2: how long, which one, and who you are ──────────────────────────
  await expect(panel.getByRole("button", { name: "Details", exact: true })).toHaveAttribute("aria-current", "step");
  // D90: a booking is whole 30-minute sessions — 15 or 45 minutes is a walk-in only.
  const lengths = panel.getByLabel("Or another length");
  await expect(lengths.locator("option").first()).toHaveText("30 min");
  await expect(lengths.locator('option[value="15"]')).toHaveCount(0);
  await expect(lengths.locator('option[value="45"]')).toHaveCount(0);
  await expect(lengths.locator("option").nth(1)).toHaveText("1 hour");
  await lengths.selectOption({ label: "30 min" });
  await expect(panel.getByLabel(`Which ${f.resourceTypeName}?`)).toContainText("Any available");

  await panel.getByRole("textbox", { name: "Name", exact: true }).fill(`E2E Web Guest ${f.run}`);
  await panel.getByRole("textbox", { name: /^Email/ }).fill(f.customerEmail);
  await panel.getByLabel("Referral code").fill(f.usedUpCode);
  await panel.getByRole("button", { name: "Apply" }).click();
  await expect(panel.getByText("That code has already been fully used.")).toBeVisible();
  await panel.getByLabel("Referral code").fill(f.freeCode);
  await panel.getByRole("button", { name: "Apply" }).click();
  await expect(panel.getByText(new RegExp(`Code ${f.freeCode} applied`, "i"))).toBeVisible();
  await shot(page, "web-02-quote");

  // ── Step 3: the price, then confirm ───────────────────────────────────────
  await panel.getByRole("button", { name: "Continue", exact: true }).click();
  const total = panel.getByText("Total to pay").locator("xpath=following-sibling::span");
  // $1,000 off makes this booking free, so no Stripe is involved.
  await expect(total).toHaveText("$0.00");

  const confirm = panel.getByRole("button", { name: /Confirm booking/ });
  await expect(confirm).toBeDisabled();
  await panel.getByRole("checkbox").check();
  await expect(confirm).toBeEnabled();
  await confirm.click();

  await expect(page.getByText("Your booking is confirmed")).toBeVisible();
  const ref = (await page.getByTestId("booking-ref").textContent())!.trim();
  expect(ref).toMatch(/^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{6}$/);
  await expect(page.getByTestId("booking-qr")).toBeVisible();
  await expect(page.getByText(f.resourceTypeName).first()).toBeVisible();
  await shot(page, "web-03-confirmed");
  const bookingUrl = page.url();

  // One booth of the two is now taken, so that time is offered once instead of twice.
  await page.goto("/book");
  await page.getByRole("button", { name: `Book ${f.resourceTypeName}` }).click();
  await pickDay(page.getByRole("dialog"), bookingDayLabel());
  await expect(page.getByRole("dialog").getByRole("button").filter({ hasText: "10:00 am" })).toContainText("1 spot");

  // The link only works with its own code.
  await page.goto(`/booking/${ref}?token=not-the-right-token-at-all`);
  await expect(page.getByRole("alert").filter({ hasText: /Booking not found/i })).toBeVisible();

  // ── Cancel, with a refund preview ─────────────────────────────────────────
  await page.goto(bookingUrl);
  await page.getByRole("link", { name: "Cancel this booking" }).click();
  await expect(page.getByRole("heading", { name: `Cancel booking ${ref}` })).toBeVisible();
  await expect(page.getByText("Cancelled at least 24 hours before the start: full refund.")).toBeVisible();
  await shot(page, "web-04-cancel");
  await page.getByRole("button", { name: /Cancel and refund/ }).click();
  await expect(page.getByText(`Booking ${ref} is cancelled`)).toBeVisible();

  await page.goto(bookingUrl);
  await expect(page.getByText("This booking is cancelled")).toBeVisible();
});

test("an experience is booked for its own fixed length, at its flat price", async ({ page }) => {
  await page.goto("/book");
  // Single Session is a named package: a fixed 30 minutes at a flat price (D65), so the panel
  // never asks how long — the length is not the customer's to choose.
  // D98: the card is the owner's mockup. The big price is the normal one; happy hour has its own line.
  const card = page.getByRole("article").filter({ has: page.getByRole("heading", { name: "Single Session" }) });
  await expect(card).toContainText("Your first lap starts here.");
  await expect(card).toContainText("Never raced before? You're in the right place.");
  await expect(card.getByText("$35.00", { exact: true })).toBeVisible();
  await expect(card).toContainText(/Happy Hour\s*\$29\.00\s*12:00 pm–3:00 pm, every day/);
  await card.getByRole("button", { name: "Book your first race" }).click();
  const panel = page.getByRole("dialog");
  await pickDay(panel, bookingDayLabel());
  // D99: the start times in happy hour (12:00–15:00) say so; the others don't.
  const timeButton = (label: string) => panel.getByRole("button").filter({ hasText: new RegExp(`^${label}`) });
  await expect(timeButton("12:00 pm")).toContainText("Happy hour");
  await expect(timeButton("2:30 pm")).toContainText("Happy hour");
  await expect(timeButton("3:00 pm")).not.toContainText("Happy hour");
  await expect(timeButton("6:00 pm")).not.toContainText("Happy hour");
  await shot(page, "web-14a-times");
  await panel.getByRole("button").filter({ hasText: /\d+ spots?/ }).first().click();

  await expect(panel.getByLabel("Or another length")).toHaveCount(0);
  await expect(panel).toContainText("30 min");

  // "Are you a member?" is asked first; a guest carries on without it (D79).
  await expect(panel.getByRole("heading", { name: "Are you a member?" })).toBeVisible();
  await panel.getByRole("button", { name: "No, continue as a guest" }).click();
  await expect(panel.getByRole("heading", { name: "Are you a member?" })).toBeHidden();

  // The VR rigs are simulators, offered alongside the others at the same price (D77).
  await expect(panel.getByLabel("Which Driving Simulator?").locator("option", { hasText: "VR Sim" }).first()).toBeAttached();

  // ── Pick your game, track and car (D80) ───────────────────────────────────
  // Read from the database rather than typed in: the list is the owner's to change.
  const db = localSupabase();
  const { data: sim } = await db.from("resource_types").select("id").eq("key", "sim").single();
  const { data: games } = await db.from("games").select("id, name, game_tracks(name), game_cars(name)").eq("resource_type_id", sim!.id).eq("active", true).order("sort")
    // In the venue's order, as the panel shows them; unordered, the database may hand them back alphabetically.
    .order("sort", { referencedTable: "game_tracks" })
    .order("sort", { referencedTable: "game_cars" });
  const [game, other] = games as { name: string; game_tracks: { name: string }[]; game_cars: { name: string }[] }[];
  const otherOnly = other!.game_tracks.map((t) => t.name).find((n) => !game!.game_tracks.some((t) => t.name === n))!;

  await expect(panel.getByRole("combobox", { name: "Game" })).toHaveCount(0);
  await panel.getByRole("checkbox", { name: /pick your game, track and car/ }).check();
  await expect(panel.getByRole("combobox", { name: "Track" })).toBeDisabled();

  // Searchable: typing part of the name narrows the list.
  const gameBox = panel.getByRole("combobox", { name: "Game" });
  // A word only this game's name has, typed in lower case: the search ignores case.
  const word = game!.name.split(" ").find((w) => !other!.name.toLowerCase().includes(w.toLowerCase())) ?? game!.name;
  await gameBox.fill(word.toLowerCase());
  await expect(panel.getByRole("option", { name: other!.name, exact: true })).toHaveCount(0);
  await panel.getByRole("option", { name: game!.name, exact: true }).click();
  await expect(gameBox).toHaveValue(game!.name);

  // Only that game's tracks are offered.
  const trackBox = panel.getByRole("combobox", { name: "Track" });
  await trackBox.click();
  await expect(panel.getByRole("option", { name: game!.game_tracks[1]!.name, exact: true })).toBeVisible();
  await expect(panel.getByRole("option", { name: otherOnly, exact: true })).toHaveCount(0);
  await panel.getByRole("option", { name: game!.game_tracks[1]!.name, exact: true }).click();
  const carBox = panel.getByRole("combobox", { name: "Car" });
  await carBox.click();
  await carBox.press("ArrowDown");
  await carBox.press("Enter");
  await expect(carBox).toHaveValue(game!.game_cars[0]!.name);
  await shot(page, "web-14b-pick-game");

  // The student price has to be asked for; ticking it changes the total (D66).
  await panel.getByRole("textbox", { name: "Name", exact: true }).fill("E2E Experience Guest");
  await panel.getByRole("textbox", { name: /^Email/ }).fill("e2e-experience@raceground.test");
  await panel.getByRole("button", { name: "Continue", exact: true }).click();
  const total = panel.getByText("Total to pay").locator("xpath=following-sibling::span");
  const listPrice = await total.textContent();
  // D85: the rules are there before paying. D100: and the owner's big notice, above the pay button.
  await expect(panel.getByText("Before you arrive")).toBeVisible();
  await expect(panel.getByRole("note")).toHaveText(/^Please come \d+ minutes before your booking time to choose cars, tracks and games$/);
  await expect(panel.getByRole("note").locator("p")).toHaveCSS("text-transform", "uppercase");
  await expect(panel.getByText(/Arriving late does not extend it/)).toBeVisible();
  await expect(panel.getByText("Your setup").locator("xpath=following-sibling::span")).toHaveText(
    `${game!.name} · ${game!.game_tracks[1]!.name} · ${game!.game_cars[0]!.name}`,
  );

  await panel.getByRole("button", { name: "Details", exact: true }).click();
  const student = panel.getByRole("checkbox", { name: /Student price/ });
  if (await student.count()) {
    await student.check();
    await panel.getByRole("button", { name: "Continue", exact: true }).click();
    await expect(total).not.toHaveText(listPrice!);
  }
  await shot(page, "web-14-experience");
});

test("in happy hour the summary says so, with the normal price struck through", async ({ page }) => {
  await page.goto("/book");
  await page.getByRole("button", { name: "Book your first race" }).click();
  const panel = page.getByRole("dialog");
  await pickDay(panel, bookingDayLabel());
  await panel.getByRole("button").filter({ hasText: "Happy hour" }).filter({ hasText: /\d+ spots?/ }).first().click();
  await panel.getByRole("button", { name: "No, continue as a guest" }).click();
  await panel.getByRole("textbox", { name: "Name", exact: true }).fill("E2E Happy Hour Guest");
  await panel.getByRole("textbox", { name: /^Email/ }).fill("e2e-happy@raceground.test");
  await panel.getByRole("button", { name: "Continue", exact: true }).click();

  // D99: the pay step and the summary beside it both show the happy-hour price against the normal one.
  const notes = panel.getByText("Happy Hour price");
  await expect(notes).toHaveCount(2);
  await expect(notes.first().locator("xpath=..")).toContainText(/\$29\.00\s*\$35\.00/);
  await expect(panel.locator("s", { hasText: "$35.00" }).first()).toBeVisible();
  await expect(panel.getByText("Total to pay").locator("xpath=following-sibling::span")).toHaveText("$29.00");
  await shot(page, "web-14c-happy-hour");
});

test("a group of 3 books a simulator each, pays once, and is cancelled together (D106)", async ({ page }) => {
  // A one-use code that makes the booking free, so no Stripe is involved.
  const db = localSupabase();
  const { data: code } = await db.from("referral_codes").insert({ discount_type: "fixed", discount_value: 1_000_00, max_uses: 1 }).select("code").single();

  await page.goto("/book");
  await page.getByRole("button", { name: "Book your first race" }).click();
  const panel = page.getByRole("dialog");
  await pickDay(panel, bookingDayLabel());

  // Up to 3 people: the times with fewer than 3 free simulators can't be picked.
  await expect(panel.getByRole("button", { name: "Fewer people" })).toBeDisabled();
  await panel.getByRole("button", { name: "More people" }).click();
  await panel.getByRole("button", { name: "More people" }).click();
  await expect(panel.getByLabel("People", { exact: true })).toHaveText("3");
  await expect(panel.getByText(/you need 3/)).toBeVisible();
  const slots = panel.getByRole("button").filter({ hasText: /\d+ spots?|Full/ });
  for (const slot of await slots.all()) {
    const spots = Number(/(\d+) spots?/.exec((await slot.textContent()) ?? "")?.[1] ?? 0);
    if (spots < 3) await expect(slot).toBeDisabled();
  }
  await panel.getByRole("button").filter({ hasText: /\d+ spots?/ }).and(panel.locator(":enabled")).first().click();

  await panel.getByRole("button", { name: "No, continue as a guest" }).click();
  // No simulator to pick for a group: they're given side by side.
  await expect(panel.getByText("3 people: each of you gets your own simulator, side by side.")).toBeVisible();
  await expect(panel.getByLabel(/^Which /)).toHaveCount(0);
  await panel.getByRole("textbox", { name: "Name", exact: true }).fill("E2E Group Gus");
  await panel.getByRole("textbox", { name: /^Email/ }).fill("e2e-group@raceground.test");
  await panel.getByLabel("Referral code").fill(code!.code as string);
  await panel.getByRole("button", { name: "Apply" }).click();
  await panel.getByRole("button", { name: "Continue", exact: true }).click();

  // The price is per person × 3, then the code comes off the whole of it once.
  await expect(panel.getByText(/^3 people × \$\d+\.\d{2}/)).toBeVisible();
  await expect(panel.getByText("People", { exact: true }).first()).toBeVisible();
  await expect(panel.getByText("Total to pay").locator("xpath=following-sibling::span")).toHaveText("$0.00");
  await panel.getByRole("checkbox").check();
  await panel.getByRole("button", { name: /Confirm booking/ }).click();

  await expect(page.getByText("Your booking is confirmed")).toBeVisible();
  await expect(page.getByText("3, a simulator each")).toBeVisible();
  const ref = (await page.getByTestId("booking-ref").textContent())!.trim();
  await shot(page, "web-17-group");

  const { data: lead } = await db.from("bookings").select("id, party_size, status").eq("ref", ref).single();
  expect(lead).toMatchObject({ party_size: 3, status: "confirmed" });
  const { data: others } = await db.from("bookings").select("status, resource_id").eq("group_lead_id", lead!.id);
  expect(others!.map((o) => o.status)).toEqual(["confirmed", "confirmed"]);

  // Cancelling the one code frees all three simulators.
  await page.getByRole("link", { name: "Cancel this booking" }).click();
  await page.getByRole("button", { name: /Cancel and refund/ }).click();
  await expect(page.getByText(`Booking ${ref} is cancelled`)).toBeVisible();
  const { data: after } = await db.from("bookings").select("status").or(`id.eq.${lead!.id},group_lead_id.eq.${lead!.id}`);
  expect(after!.map((o) => o.status)).toEqual(["cancelled", "cancelled", "cancelled"]);
});

test("bookings open as far ahead as the venue's setting, about 3 months at launch", async ({ page }) => {
  // D104: the window is the back office's "Book ahead" setting; read it rather than assume it.
  const { data: settings } = await localSupabase().from("venue_settings").select("booking_window_days").single();
  const days = settings!.booking_window_days as number;
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Sydney", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const get = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  const last = new Date(Date.UTC(get("year"), get("month") - 1, get("day") + days));
  const label = (d: Date) => new Intl.DateTimeFormat("en-AU", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" }).format(d).replace(/,/g, "");
  const after = new Date(last.getTime() + 86_400_000);

  await page.goto("/");
  await expect(page.getByText(/You can book up to \d+ (days|months?) ahead\./)).toBeVisible();
  if (days >= 84) await expect(page.getByText("You can book up to 3 months ahead.")).toBeVisible();

  await page.goto("/book");
  await page.getByRole("button", { name: "Book your first race" }).click();
  const panel = page.getByRole("dialog");
  const next = panel.getByRole("button", { name: "Next month" });
  // Page forward to the month of the last bookable day: that day can be picked, the next one can't.
  const lastDay = panel.getByRole("button", { name: new RegExp(`^${label(last)}`) });
  for (let i = 0; i < 14 && (await lastDay.count()) === 0; i++) await next.click();
  // A closed weekday is greyed out even inside the window.
  if (!(await lastDay.getAttribute("aria-label"))?.includes("closed")) await expect(lastDay).toBeEnabled();
  const dayAfter = panel.getByRole("button", { name: new RegExp(`^${label(after)}`) });
  if (await dayAfter.count()) await expect(dayAfter).toBeDisabled();
  await expect(panel.getByText(`Booking is open to`)).toBeVisible();
});

test("the legal pages explain the rules", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: "Cancellations & refunds" }).click();
  await expect(page.getByRole("heading", { name: "Cancellations and refunds" })).toBeVisible();
  await expect(page.getByText(/24 hours or more before the start/)).toBeVisible();
  // D101: inside 24 hours there is no refund, and no 50% any more.
  await expect(page.getByText(/Less than 24 hours before:/)).toBeVisible();
  await expect(page.getByText(/50%/)).toHaveCount(0);
  await page.getByRole("link", { name: "Terms", exact: true }).click();
  // D102: the owner's terms, all 16 sections, with the venue's arrive-early minutes in them.
  await expect(page.getByRole("heading", { level: 1, name: "Terms & Conditions" })).toBeVisible();
  await expect(page.getByText("Operated by RACEGROUNDS PTY LTD · ABN 64 700 493 723")).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: /^\d+\. / })).toHaveCount(16);
  await expect(page.getByRole("heading", { name: "Additional Venue Conditions" })).toBeVisible();
  await expect(page.getByText(/Cancellations made more than 24 hours before the scheduled session start time are eligible for a full refund/)).toBeVisible();
  await expect(page.getByText(/^Customers must arrive at least \d+ minutes before their scheduled session/)).toHaveCount(2);
  await expect(page.getByText(/at least 10 minutes/)).toHaveCount(0);
  await page.getByRole("navigation", { name: "Contents" }).getByRole("link", { name: "12. Late Arrivals" }).click();
  await expect(page).toHaveURL(/#section-12$/);
  await shot(page, "web-16-terms");
  await page.getByRole("link", { name: "Privacy", exact: true }).click();
  await expect(page.getByText(/Payments are handled by Stripe/)).toBeVisible();
});
