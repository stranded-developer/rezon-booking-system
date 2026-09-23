# Phase 8d — The booking website's new look, home page, events and tournaments

**Date:** 2026-09-23
**Decisions:** [D64, D69, D70, D72](../decisions/08-2026-09-23-public-site-experiences-tournaments.md). D64 **supersedes D59**.

**Done**

**The theme, in one place.** `globals.css` redefines the tokens the site was already built on — `paper`, `mist`, `line`, `ink-*`, `flag` — rather than restyling each screen. `paper` is now a raised dark surface instead of white, `flag` is the reference's crimson instead of the POS's lime. Every page moved to the dark theme at once, and the account, booking, cancel and legal pages needed no changes of their own.

Added on top: `night` and `deep` for the page and its sections, `gold` for membership, a `.display` class for the condensed italic capitals the reference uses for headings, and two checkered-flag strips — a wide one between sections and a thin crimson one along the top edge of a card.

**Headings are set in Barlow Condensed italic**, loaded through `next/font`. Body text stays Inter.

**The home page** (D72) is built from what the back office holds and nothing else: the real experiences with their real prices, lengths and badges; whatever is only sold by the hour; the happy-hour window; the tiers; the opening hours. **No price is typed into the markup.** A card shows its "from" price and, when that is a promotional price, says what it normally costs — a "from" price alone tells half the story.

With no photos uploaded (the owner asked to ignore assets), the "race / play / hang out" triptych draws tinted panels rather than leaving empty frames, so the section still reads. Any photo that *is* uploaded is used.

**Sections rise into view** as they are scrolled to. The hiding is added **by the script after it mounts**, never in the markup, so with JavaScript off — or before hydration — everything is simply visible. A page must not need a script to run in order to show its words. `prefers-reduced-motion` turns the movement off in CSS.

**The header** is one bar that shrinks into a floating pill once you scroll past 120px, so "Book now" is always within reach.

**Events** (D69): a banner pinned above the header and a pop-up, each dismissed separately and remembered per visitor under the event's own id, so a new event shows again and an old one stays shut. Every storage read and write is guarded, because storage throws in private windows and with site data blocked — and the fallback is to *show* the event.

**Tournaments** (D68 on the site): the page says **"No tournament available"** when nothing is published and upcoming, exactly as the owner asked. Otherwise each tournament shows its date, its blurb, the entry fee with a member's discount already taken off, and **how many spots are left**, badged crimson once it is down to three. Signing up asks for a name and an email or phone, or uses the signed-in account, then goes free-or-to-payment as the API decides. `/tournaments/[ref]` shows the entry with its QR code, and polls while Stripe's webhook confirms it, the same way a booking does.

**A contact page** with the venue's address, phone, email, Instagram and hours — all from the back office.

**Verified**

1. **Four new browser tests** (`events-tournaments.spec.ts`); the booking suite goes **5 → 9**. They cover the pop-up and banner appearing, being dismissed separately, and **staying** dismissed across navigations; only published tournaments being listed; a guest signing up and getting a QR entry code; the spots count going down; a one-spot tournament filling and refusing the next person; and the empty state.
2. **The home-page test was rewritten**, not deleted: it now asserts the real experiences, their lengths, the "Most popular" badge, the hourly types including the run's own, the hours and a tier.
3. **Looked at, not just tested.** Screenshots at 1280px and at 390px, plus the pop-up, the banner and the collapsed header. The numbers on screen were checked against the database: Quick Race from $29.00 (normally $35.00), Double Race from $49.00 · 60 min, billiards $30.00/hr, tiers $48 / $78 / $128.
4. **Gate:** turbo **11/11** · pgTAP **456** · POS e2e **4** (the walk-in test skips outside 10:00–20:45 Sydney; it was 22:56) · booking e2e **9**.

**Issues found and fixed**

1. **The header had two "Book now" links and two navigations in the page at once.** The first version cross-faded a full bar and a pill, both always rendered. `inert` on the faded one was not enough, and the deeper point is that it should never have been two: anyone on a screen reader or a keyboard would meet whichever one happened to be invisible. Rebuilt as **one bar that changes shape**. The duplicate was found by a browser test refusing to click an ambiguous link — the test was right.
2. **The event pop-up covered every page and swallowed clicks.** Its overlay sat over the tournaments page and the sign-up button underneath could not be pressed. The fix is a product decision, not a z-index: the pop-up belongs on the **landing page only**. The banner carries the same event everywhere else.
3. **A browser test filled the wrong field.** `getByLabel("Name")` also matched the terms checkbox, because its label contains "tour**name**nt". Matched exactly instead.
4. **`appReady` waited on a link the footer now also has.** It waits for the header's account link as a sign that the browser has taken over; the new footer has its own "Member log in", so the locator matched two. Scoped to the header.
5. **A POS test asserted the complete list of resource types.** It broke because a browser run I killed had left its own type active. The assertion is now scoped to the three launch types — the test is about the launch configuration being served, not about nothing else existing. This is the same "pass on a used database" rule as before.
6. **The e2e spec loaded its fixture at import time**, before global setup had written it, and shelled out to read Supabase's settings while the files were only being collected. Moved into `beforeAll`.

**Worth knowing**

- Running the browser suite while a `next dev` server is on port 3000 makes Playwright reuse it, and every page then compiles on demand — tests that take seconds took minutes. Stop the dev server first, or the suite is timing the compiler.

**Not built yet**

- **`/book` is still the old flow** — re-themed and working, but not yet the experience grid and three-step panel from the reference. That is the next step.
- **The membership page** still shows the old layout; the new tier perks are not shown yet.
- **The back office** has no screens for experiences, promotional prices, tournaments or events, so the owner cannot yet create the tournament or event this page would show.
