# Decisions 14 — 2026-10-13: Explore, card wording, happy hour shown clearly, arrive early

**Supersedes:** *Explore* → `/#explore` from D81 (D96); the experience cards' "from" price (D98); **the 50% refund between 2 and 24 hours before the start** (D101).

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

## D101 — No refund inside 24 hours ✅ owner 2026-10-13

**From:** the owner's terms and conditions (`assets/brand/tnc.txt`, section 3): "Cancellations made more than 24 hours before the scheduled session start time are eligible for a full refund. Cancellations made within 24 hours of the scheduled session are generally non-refundable." The system gave 50% back between 2 and 24 hours. **Asked:** which is right? **Answer:** the terms.

**Decision:** a customer cancelling **24 hours or more** before the start gets a full refund and their free-play minutes back. **Inside 24 hours** a booking can't be cancelled online and nothing is refunded. Staff can still cancel at any time as the venue's fault (full refund) or set a refund amount with a reason, as before. Exactly 24 hours before still counts as a full refund.

## D102 — The owner's terms and conditions, with 15 minutes to arrive early ✅ owner 2026-10-13

**Given:** `assets/brand/tnc.txt`, RACEGROUNDS PTY LTD's terms (16 sections). Sections 4 and 12 say to arrive "at least 10 minutes before"; the booking rules and the big notice (D100) say 15. **Asked:** which? **Answer:** 15.

**Decision:** `/terms` shows the owner's text in full, with "at least 15 minutes" in sections 4 and 12 (from the back office's arrive-early setting, so they never disagree with the notice). Nothing else in the text is changed.

## D103 — Signing up with an email that already has an account says so ✅ owner 2026-10-14

**Asked:** "if account already existing then it doesnt say?? … silently swallowed?"

**Answer:** it was. For an email with a confirmed account, Supabase either refuses the sign-up ("User already registered", which the page showed word for word) or, with other project settings, answers as if it worked and sends nothing — and the page then said "We've sent a confirmation link".

**Decision:** in both cases the sign-up page says "There's already an account with <email>. Log in, or reset your password if you've forgotten it." This tells someone typing an email whether it has an account here; for a venue's member site that's the clearer choice, and logging in still needs the password.

## D104 — Bookings open about 3 months ahead ✅ owner 2026-10-14

**Asked:** "for the booking availability it shows can only be up to next week make it up to next 3 months."

**Decision:** the back office's "Book ahead (days)" setting goes from 7 to **92** (about 3 months); the back office now accepts up to 365 (it stopped at 60). The home page says "up to 3 months ahead".

## D105 — The venue gets an email for every confirmed booking ✅ owner 2026-10-14

**Asked:** "whenever a booking is confirmed, send an email confirmation to racegrounds@gmail.com with the booking details." **Asked back:** fixed, or a back-office setting? **Answer:** a setting.

**Decision:** a back-office setting "Booking alerts to", set to racegrounds@gmail.com. Every confirmed online booking sends it the booking's details. Empty = no alerts.

## D106 — A simulator booking can be for several people ✅ owner 2026-10-14

**Asked:** "they can book for x person (more than 1, thus multiplying the price to pay with the x number of person)."

**Answers:**
- Each person gets **their own simulator, side by side, at the same time**; the price is × people and it needs that many free spots; one payment.
- **Billiards stays per table**: no number of people asked.
- A **member booking for a group gets the member price for everyone**; free play covers the member's own place only.

## D107 — The happy-hour price is in each happy-hour time slot ✅ owner 2026-10-15

**Asked:** "when booking in the timetable if its happy hour have a small price under it showing the happy hour price (inside each timeslot under the happy hour text)." Also: "Sim racing" in lime and "VR lounge" in the normal colour on the home page heading.

**Decision:** under the Happy hour tag, the happy-hour price for one person ("$29.00"; "$29.00 each" for a group). The hero swaps its lime from "VR lounge" to "Sim racing".

## D108 — Every tier lists "SPECIAL MEMBERS NIGHTS ONLY EVENTS" ✅ owner 2026-10-15

**Decision:** added once to the end of every tier's listed perks, in the owner's words and capitals. Still editable per tier in the back office.

## D109 — The site icon is the RG badge ✅ owner 2026-10-15

**Asked:** "fill in logo raceground for the small icon in google search." **Asked back:** the logo is a long word, unreadable at icon size; which square mark? **Answer:** the RG badge.

**Decision:** the hexagon RG badge from the membership poster, lime on near-black, in Garet Heavy: the browser tab, phone home-screen and search-result icon for the booking site and the POS. Google shows it after it next visits the site.

**Not done (owner):** "Stripe log in" — "ignore this one".

## D110 — Online bookings from 7 November 2026 ✅ owner 2026-10-15

**Asked:** "allow bookings starting from 7 november onwards (can book now but then only from 7 november onwards date), just disable dates before that."

**Decision:** a back-office setting "Bookings open from", set to Sat 7 Nov 2026. Customers can book now, but only for that day or later; the calendar opens on November with the earlier days greyed out and says "Bookings start on Sat 7 Nov 2026". The API and the database refuse earlier dates too. Empty = from today. Walk-ins at the counter aren't affected.

## D111 — Picking the game, track and car is for 1-hour sessions ✅ owner 2026-10-15

**Asked:** "for 30minutes gamau ada opsi pick your games. Kalau 1 hour baru adaa" (no "pick your game" for 30 minutes; only for 1 hour).

**Decision:** the game/track/car picker is offered only for bookings of 60 minutes or more (Double Session at launch). A 30-minute session (Single Session, Leaderboard Challenge) starts on whatever is set up. The API refuses a pick on a shorter booking, and tells the site the length (`pickGameFromMinutes`), so the two never disagree.

## D112 — The cards' price line goes back to "from $29.00 · 30 min" ✅ owner 2026-10-15

**Supersedes:** D98's "the big price is the normal one".

**Asked:** "change the single session, double session and leaderboard challenge ui to the older version which shows from $xx . 30 min … keep the current ui just change that part."

**Decision:** on each experience card only the price lines change back: "from" + the cheapest price anyone can pay without asking (Happy Hour at launch) + "· 30 min", then "normally $35.00" underneath. The rest of the card — wording, colours, badges, the happy-hour box, the button — stays as D98 made it.
