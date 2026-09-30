# Decisions 09 — 2026-09-30: our own look, VR rigs as simulators, "Are you a member?", game/track/car

**Supersedes:** D64's colours and fonts (its layout stands); D23 and D74's VR rows (VR is no longer priced on its own).

The owner's message, in short: the flow is fine and the structure stays, but the site looks too much like Velocity, so change the colours and fonts everywhere. Then four changes to the booking itself.

---

## D76 — Raceground's own colours and fonts ✅ owner 2026-09-30

**Asked:** "Terlalu mirip velocity. Flownya oke kok. Keep overall structure… change colouring and fonts of the entire website."

**Decision:**
- **Colours:** volt lime `#e8ff47` on graphite `#0b0d10`, the **same pair the POS already uses**, so the website and the till look like one brand. Amber `#ffb347` stays as the membership colour; a little sky blue for variety where the home page used indigo. Nothing crimson or indigo is left.
- **Fonts:** headings in **Chakra Petch** (squared, upright capitals) instead of Barlow Condensed italic; body text in **Manrope** instead of Inter.
- **The big checkered strips** between sections are the reference's most recognisable detail; they are now a quiet graphite check rather than black and white.
- **Nothing else moves:** every page, section, panel and step is where it was (D64's layout, D71's panel, D72's home page).

**Why lime on graphite:** it is distinct from the reference at a glance, it is already Raceground's colour on the till, and dark text on lime reads well.

**Owner can change:** any of it. The colours are a handful of values in one file (`apps/booking/src/app/globals.css`).

## D77 — The VR rigs are simulators, at the same price ✅ owner 2026-09-30

**Asked:** "Untuk VR, itu sama harganya. Jadi gausa dipisahin. Jadi total spot sim itu 8. 6 normal 2 vr. Jadi bisa di tambahin di 'which driving simulator'."

**Decision:**
- There are **8 driving simulators**: Sim 1–6 and **VR Sim 1–2**. All at the simulator price — every experience (Quick Race, Double Race, Leaderboard Challenge) can be booked on a VR rig, and the spots counter counts all eight.
- "Which Driving Simulator?" lists the VR rigs with the others, and says they are the same price.
- The website no longer shows a separate "VR Seat" card.
- The old VR type and its $40 happy-hour rate are **switched off, not deleted**, so past records still make sense.

**What this changes in money terms:** a walk-in on a VR rig is now charged the simulator's hourly rate ($60/hr) instead of $50/hr, and there is no longer a VR happy-hour rate. **Flagged** in case the owner wanted VR walk-ins kept at $50.

## D78 — Double Race is listed before Leaderboard Challenge ✅ owner 2026-09-30

**Asked:** "right now double race is below leaderboard challenge, replace their positions".

**Decision:** Quick Race, **Double Race**, Leaderboard Challenge — on the home page, `/book` and the membership price table. It is the experiences' `sort` value, which the owner can change in the back office at any time. The migration only moves them if they are still in their launch positions, so an order the owner has already set is left alone.

## D79 — "Are you a member?" at the top of Details ✅ owner 2026-09-30

**Asked:** "after picking time, diatasnya mau ditanya are you a member? Kalo yes… langsung pencet and redirect to log in member untuk special deals (is this possible)".

**Yes, it's possible, and built:**
- After choosing a time, anyone not logged in sees **"Are you a member?"** first, with **Yes, log in** and **No, continue as a guest**.
- **Yes** goes to the member login and then **straight back to the same booking, on Details, at the same day and time**, now with the member's price and free play. If someone else took that time in the meantime, it goes back to the times and says so.
- **No** hides the question for the rest of that booking (going back to Details does not ask again).
- A logged-in customer is never asked.

This was in the original spec (booking flow step 3) and had been dropped when the panel was rebuilt in D71; it is back.

**Also:** the login page now only returns people to a page on our own site. Before, a crafted link could have sent someone elsewhere after logging in.

## D80 — Pick your game, track and car ✅ owner 2026-09-30

**Asked:** under "Any of these apply?" and above the name, "Would you like to pick your games, tracks and cars?" — ticked, three dropdowns that can also be searched.

**Decision:**
- On any simulator booking, a tick box **"Would you like to pick your game, track and car?"** sits between "Any of these apply?" and the name. Ticked, it shows **Game**, **Track** and **Car**, each a dropdown you can type into to search.
- **Track and car come from the chosen game**, so nobody can ask for Monaco in a game that doesn't have it; changing the game clears them. Each is optional ("No preference").
- **It is a preference, not a price.** It never changes what is charged.
- **Staff see it** on the till's Today's bookings, the back office Bookings page, and the customer sees it on Pay, on their booking page and in the confirmation email.
- **The owner edits the lists** in a new back office screen, **Games, tracks & cars**: a game's tracks and cars are typed one per line. A game can be switched off.
- The booking keeps the **names** it was made with, so renaming or removing a car later never changes an existing booking.

**Owner to confirm — the starting list is a guess.** The venue's actual games weren't given, so it starts with three common sim-racing titles and a realistic set of tracks and cars for each:
- **Assetto Corsa Competizione** — 10 tracks (incl. Mount Panorama), 8 GT3 cars
- **Assetto Corsa** — 8 tracks (incl. the Nordschleife), 8 cars
- **F1 25** — 10 tracks (incl. Albert Park), the 10 teams

Replace, add to or switch these off in the back office. If the rigs don't run one of these, it should be switched off before go-live.
