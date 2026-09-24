# Phase 8f — Back office screens for experiences, tournaments and what's on

**Date:** 2026-09-24
**Decisions:** [D65, D66, D68, D69](../decisions/08-2026-09-23-public-site-experiences-tournaments.md).
**Migration:** `20260924001900_audit_experiences_tournaments_events.sql`
**Spec updated:** [back-office.md](../../spec/back-office.md) (three new screens, audited tables), [data-model.md](../../spec/data-model.md).

**Done**

Everything added in this phase can now be run by the owner without SQL. Three new screens, in the same shape as the ones already there.

**Experiences.** Each one is a card: its flat price, its fixed length, what it runs on, and the words that go on the website — tagline, bullet points, badges. Adding or editing one checks the length is **a whole number of the venue's own sessions** and says so before the Save button will work. Under each experience, a table of its **promotional prices**: name, days, hours, price, and whether it applies automatically or only when the customer asks.

**Overlapping promotional prices are allowed here and rejected nowhere**, unlike rate bands and percentage happy hours, because the cheapest matching one wins. The screen says this in as many words, so the next person to look does not think it is a bug.

**Tournaments.** Create as a draft, publish when ready, unpublish again. The table shows how many are signed up and how many spots are left, and "Who's in" lists the entries with their contact details and whether each is confirmed or still paying. **Spots cannot be cut below the number already signed up** — someone holding a spot must not be left holding one that no longer exists — and the message says how many are in.

**What's on.** The website's pop-up and banner: a title, a highlight line, a description, a button, the dates to show between, and whether it shows as a pop-up, a banner or both. A button needs a label *and* a link, or neither, and the form says so before it will save.

**Dates are read and written in venue time, never the browser's.** A `datetime-local` field is wall-clock time with no timezone, so both screens convert it against Sydney's own offset for that date. A manager on holiday overseas must not be able to move a tournament by an accident of where they are sitting.

**The audit gap this step closed**

The migration that created these tables in step 8b **did not attach the audit trigger** every other configuration table carries. That broke the rule in `spec/README.md` — *every change to money or rules is written to the audit log with actor, before and after* — and experiences and promotional prices **are** prices, while a tournament carries an entry fee. A new migration attaches it to all four tables.

**Verified**

1. **20 new API tests** (`admin-experiences.integration.test.ts`). API **213 → 233**. Every write is checked for its audit row with the actor and the reason, and a price change is checked for **what it was before**. Also: a length off the session grid is refused, a bad short code and a negative price are refused, a backwards window and a window with no days are refused, a second overlapping promotional price is **accepted** (D66), a draft tournament is invisible to the public until published, spots cannot be cut below the entries, a half-finished button is refused, and an event is hidden both when switched off and when outside its window.
2. **5 new pgTAP tests** (pgTAP **456 → 461**): a write from outside the API is not audited, and changing an experience price, a promotional price, a tournament entry fee or adding an event all are — with actor, before and after.
3. **One new browser test** (POS e2e **5 → 6**): the owner creates an experience — including being **blocked at 45 minutes** and allowed at 60 — adds an automatic price and a claimed one, creates a tournament as a draft and publishes it, and creates an event, including being **blocked by a button with a label and no link**. The audit row for the experience is then read straight from the database to confirm it names a real person.
4. **Deliberate break, killed:** attaching the audit trigger to only one of the four tables fails three pgTAP tests.
5. **Gate:** turbo **11/11** · pgTAP **461** · API **233** · POS e2e **6** · booking e2e **10**. pgTAP was also run a second time on the same database, as the project requires.

**Issues found and fixed**

1. **The audit trigger was missing on all four new tables** — see above. This is the most serious thing in this step, and it was only found by sitting down to write the audit test.
2. **Two fields were labelled "From" and "To".** "To" is a substring of "What the cus**to**mer sees" and "has **to** ask for", so a form query matched three different controls. Renamed to **"Start time"** and **"End time"** — clearer copy, and the ambiguity goes with it.
3. **A test bound the cashier's operator token to the cashier's own device**, then sent the owner's session with it. The API answered 401, which is correct: a token minted for one device is a foreign token on another. The test was wrong, not the API. Fixed by minting the cashier's token **on the owner's device**, which is what happens at a real counter.
4. **A pgTAP audit test counted every audit row rather than its own.** It passed alone and failed the moment the new API tests wrote some — the same "pass on a used database" rule as before. Scoped with a high-water mark, the way `06_admin` already does.
5. **A browser test expected a switched-off event to still be in the list.** It is filtered out, which is right; the test now asserts it disappears and then reappears under "Show hidden".

**Worth knowing**

- **The back office cannot be reached with `page.goto`.** Who is on the counter is held in the browser, not in a cookie, so a full page load returns to the operator picker — correct for a shared machine at a counter, and something every test here has to navigate by clicking.

**Not built yet**

- **Cancelling a tournament entry, and refunding it**, is still not built. The columns are there.
- **Reordering** experiences and promotional prices is by a sort number in the API but has no drag-and-drop in the screen.
- Free tournament entry per tier is a number in the database with no field in the back office yet; it is 0 for every tier and the owner has not asked for it to be switched on.
