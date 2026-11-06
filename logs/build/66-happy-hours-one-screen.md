# 66 — Every happy hour on one screen; the website shows the real days

**Date:** 2026-11-05
**Decision:** [D117](../decisions/16-2026-11-05-happy-hours-longer-sessions.md).

**Checked first:** the owner set the happy hour on *Rates & happy hours* to Mon–Fri, and the website still showed Saturday and Sunday. The live public config (`/public/config`) showed:
- the hourly happy hour at `1,2,3,4,5` (Mon–Fri);
- each simulator package's own happy-hour price at `1,2,3,4,5,6,7` (every day).

The website was right about the simulators. The cause is that there are two separate kinds of happy hour, and only one of them had been changed. Two bugs turned up along the way: two lines on the website said "every day" whatever the days were, and the home page's billiards card showed the simulators' happy hour.

**Done**

- **Back office, *Rates & happy hours***
  - The *Happy hours* card now has two parts:
    - **Sold by the hour — percent off**, with a new **Edit** (the add dialog, filled in, saving with PATCH);
    - **Packages — a price of their own**: every active package's automatic promotional price, with **Edit**.
  - Times are shown as `12:00`, not `12:00:00`.
- **`PackagePriceDialog`** (`components/admin/package-price-dialog.tsx`)
  - Edits a package price's days, times and price.
  - **"Use these days and times for every package's Happy Hour"** is ticked by default. It patches every other active package price with the same name and kind; each keeps its own price.
  - The same dialog is behind a new **Edit** on *Experiences*.
- **Website**
  - The home page and `/book` billiards cards show that type's own hourly happy hour (one for its type, or for everything) with `formatDays` (`hourlyHappyHoursFor` in `lib/happy-hour.ts`).
  - The line on `/book` that said "every day" is removed; each package card already shows its own days.
- **Spec:** `back-office.md`, `booking-site.md`.

**Verified**

1. **POS browser test `happy-hours-admin.spec.ts` (new).** The test makes its own two packages, each with an every-day "E2E Hour" price, and its own hourly happy hour.
   - The owner opens *Rates & happy hours*, edits one package's price and unticks Sat and Sun. "Every package" is ticked.
   - Both rows then show Mon–Fri. In the database both prices are `{1,2,3,4,5}`, still $29 and $49.
   - Editing the hourly happy hour to Mon–Fri saves, and its 10% is unchanged.
2. **Website.** With an hourly happy hour of Mon–Fri added, the home page printed "Check HH: 12:00 pm to 3:00 pm, Mon, Tue, Wed, Thu, Fri". The happy hour was removed afterwards.
3. **Screenshot** of the combined screen checked: both tables, Edit buttons, struck-through normal prices.
4. **Gate:** see the commit for steps 66–67.

**Issues found and fixed**

1. The test's first run found two "Sat" buttons. The *Days* field's label is folded into the first day button's name, so the test now picks day buttons by exact name. This was a test quirk, not a page problem.

**For the owner**

- To make the simulators' happy hour Mon–Fri on the live site, open *Rates & happy hours → Packages*, then **Edit** on any *Happy Hour* row. Untick Sat and Sun and keep "every package" ticked.
