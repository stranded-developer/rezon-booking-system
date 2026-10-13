# Step 53 — The owner's terms and conditions

**Date:** 2026-10-13
**Decisions:** [D102](../decisions/14-2026-10-13-explore-wording-happy-hour.md) (and D101 for section 3).

**Done**

- `assets/brand/tnc.txt` (RACEGROUNDS PTY LTD, ABN 64 700 493 723, 16 sections) is now `apps/booking/src/lib/terms.ts`, word for word: sections, the (a)–(d) sub-headings, the bullet lists, the IMPORTANT line. Invisible characters from copying (word joiners, figure spaces) were removed.
- Two changes only: "at least 10 minutes" in sections 4 and 12 is the back office's arrive-early setting (15; owner's choice), and "8-18 Bowden Street. Alexandria" has a comma.
- `/terms`: title, company and ABN, a contents list linking to each section, the 16 sections with "Additional Venue Conditions" as its own heading before 12, the IMPORTANT line highlighted, the email as a link. The "Draft" notice is gone. The old short list of rules was replaced: the same rules are on the pay step, the booking page, the emails and the cancellation policy page.
- Spec: `booking-site.md`.

**Verified**

1. Browser test "the legal pages": the title, company and ABN; 16 numbered sections; the Additional Venue Conditions heading; section 3's 24-hour rule; both arrive-early lines with the venue's minutes and no "10 minutes" anywhere; the contents link to section 12 works.
2. Screenshot `web-16-terms` checked.
3. **Gate:** see the commit for this step.

**Issues found and fixed**

1. The contents list adds a "9. Privacy" link, so the test's click on the footer's "Privacy" matched two links; it matches exactly now.

**Worth knowing (not changed)**

- Section 12 says late arrivals "may result in reduced playing time" and "extensions are subject to availability". The booking rules say arriving late does not extend a session. They agree (any extension is a new sale at the counter).
- Section 7 mentions driver tags given when booking; the booking form doesn't ask for one yet.
- Section 11's address and email aren't in the back office's venue details yet, so the site footer still says "Contact details are coming soon". They are the owner's to enter there.
