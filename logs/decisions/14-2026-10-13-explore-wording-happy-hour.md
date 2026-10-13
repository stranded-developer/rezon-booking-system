# Decisions 14 — 2026-10-13: Explore, card wording, happy hour shown clearly, arrive early

**Supersedes:** *Explore* → `/#explore` from D81 (D96); the experience cards' "from" price (D98).

## D96 — Explore goes to the top of the home page ✅ owner 2026-10-13

**Asked:** "when the explore in bottom tab is clicked make it redirect to top of home page."

**Decision:** *Explore* in the bottom bar opens `/` at the top. Tapped while already on the home page, it scrolls back up to the top.

## D97 — Free races are written "x FREE RACES PER MONTH" ✅ owner 2026-10-13

**Asked:** "in the silver other tiers rename: into x FREE RACES PER MONTH instead of x races."

**Decision:** on the membership page and the home page's members club, every tier's free races read e.g. "2 FREE RACES PER MONTH" (one: "1 FREE RACE PER MONTH"). The number still comes from the tier's free minutes.

## D98 — The experience cards follow the owner's three mockups; the normal price is the big one ✅ owner 2026-10-13

**Given:** `assets/brand/ui-1.jpeg` (Single Session), `ui-2.jpeg` (Double Session), `ui-3.jpeg` (Leaderboard Challenge): "keep our layout but follow the new wordings and colors."

**Decision:**
- The wording on the three cards is the mockups', word for word: the lime line under the name, the three ticked lines, and the button ("Book your first race", "Book the full experience", "Take on the leaderboard"). The button text is a new back-office field per experience.
- Colours as in the mockups: near-black card, white name, lime line and price, "Most popular" in green, other badges grey, a lime button.
- **The big price is the normal price** ($35.00), not the happy-hour one. Happy hour gets its own clearly coloured line ("Happy hour 12:00pm–3:00pm · $29.00"). Owner's choice, so nobody sees $29 at 7pm and then $35 at checkout.
- **Double Session stays $58.00.** The mockup's "Normally $68.00" was wording only.

## D99 — Happy hour is shown wherever a price depends on it ✅ owner 2026-10-13

**Asked:** "if its happy hour hours it shows happy hour price … and if not it shows actual price, clearly distinguished … during checkout it highlight if its happy hour … for the summary" and "when booking session times table can we add 'happy hour' (if is happy hour time) and … x spots."

**Decision:**
- Each start time in the session table that falls in happy hour is marked **Happy hour**. "x spots" was already there and stays. No "Quick race" label: owner, "not needed".
- The booking summary shows the price that applies: in happy hour, the happy-hour price labelled **Happy hour**, with the normal price struck through beside it.

## D100 — A big "come 15 minutes early" notice before the booking is finished ✅ owner 2026-10-13

**Asked:** "before booking completed i want a big text shows 'PLEASE COME 15 MINUTE BEFORE BOOKING TIMES TO CHOOSE CARS, TRACKS AND GAMES' make it super clear."

**Decision:** shown large, in capitals, on the last step before paying. The minutes come from the back office's arrive-early setting (D85, 15 at launch).

## Open

- **Terms and conditions:** the owner put a file at `assets/brand/tnc`, but it is empty (0 bytes). Waiting for the text.
