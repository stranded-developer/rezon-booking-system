# Decisions 10 — 2026-10-01: bottom bar, session names, member prices, rules, clothing, home tiles

**Supersedes:** D67's member-price arithmetic (percentage on top of a promotion) for experiences; D72's "how it works" and triptych sections; D68's "free tournament entry off" for Diamond.

The owner sent a round of changes with reference images in `logs/screenshots/`: `new-raceplay.jpeg` / `no-6.jpeg` (the same image: a 2×2 tile grid with a wide bar), `no-7.jpeg` (a 3-column square tile grid), and `poster-example.jpeg` (the membership poster). Four points were asked back and answered before building; the answers are marked **(asked)**.

---

## D81 — A bottom bar with Book now, Events and Explore ✅ owner 2026-10-01

Three buttons fixed to the bottom of every page, however far down it is scrolled. **(asked)** Book now → `/book`, Events → the tournaments page, Explore → the "Types of driving" section on the home page; on phones and on desktop.

## D82 — Member prices are flat, per tier, and never stack ✅ owner 2026-10-01

**Asked:** "Member promo price CANNOT be applied to other promos since PRICE GIVEN IS ALREADY CHEAPEST RATE", and the poster's race prices, "follow the values exactly too, change it in the db".

**Decision:**
- Each tier has its own **flat price** per experience: Silver **$32** Single / **$52** Double, Gold and Diamond **$28** / **$46** — exactly the poster, not the $31.50 / $46.40 a percentage gives.
- A member price is **never combined** with Happy Hour or the student price. **(asked)** The member pays the **cheapest single price**: Gold pays $28 in Happy Hour (not $29 − 20% = $23.20); Silver pays Happy Hour's $29 rather than their $32.
- The tiers' percentage still applies to time booked by the hour (billiards) — the poster's "10% / 20% off next bookings".
- **Leaderboard Challenge is not on the poster**, so it has no flat member price and a member pays their tier's percentage off $35 (Silver $31.50, Gold/Diamond $28). **Flagged** — say the word and it gets the Single Session prices.
- Member prices are edited per experience in the back office.

## D83 — Single Session and Double Session ✅ owner 2026-10-01

Quick Race → **Single Session** ("Quick Race, Time trial, Drift, and more."), Double Race → **Double Session** ("Full Experience, Double Race, Drift, Free Roam, and more"). Prices, lengths and badges unchanged. Leaderboard Challenge unchanged.

## D84 — The membership page is the poster ✅ owner 2026-10-01

**Asked:** remove "What you'd get" (the member-price table, "What you'd pay"), and above it make it exactly like the poster, wording copied, free races and prices in heavy bold, keep "Most popular".

**Decision:**
- "MEMBERSHIP / PROMO PRICE" heading with the gold underline; per tier the RG hexagon badge in the tier's colour (silver, gold, icy blue), "SILVER TIER", "**$48** / Month", then **"2 races per month"** with "(Only $24 per race)", the poster's lines, "10% off next bookings", and a **Race price** block with the flat member prices. Gold keeps "Most popular".
- **(asked)** The poster's words, with the spelling fixed ("Hourss", "Every months", "Registrtion", "birtthdayy").
- The race-price rows use the new names (Single Session / Double Session) rather than the poster's "Quick Race / Single Session".
- The poster's numbers are the tiers' numbers already ($48 / $78 / $128, 10% / 20% / 20%, 2 / 4 / 8 races). The poster gives **Diamond a free monthly tournament entry**, so that is switched on — which settles the question D68 left open.

## D85 — Guests arrive 15 minutes early; lateness isn't made up ✅ owner 2026-10-01

**Asked:** Velocity's rules — arrive 15 minutes before, a late arrival isn't extended, the time is cut at the booked end.

**Decision:** written in our own words rather than copied (another venue's text is theirs):
1. Arrive 15 minutes before the session starts, to check in and get set up.
2. The session starts and ends at the booked time; arriving late does not extend it.
3. The spot is held 15 minutes after the start (as before).

Shown on the Pay step, the booking page, the terms, and in the confirmation and reminder emails. **"15" is a venue setting** (Venue & hours → Arrive early). The till already ends a booked session at the booked end (its "Overdue" state), so the rule matches what staff see.

## D86 — Clothing, coming soon ✅ owner 2026-10-01

"Clothing" in the top bar after Contact, to a page with a coming-soon banner and empty catalogue tiles until the collection is ready. The catalogue itself is built when the products are.

## D87 — The home page tiles ✅ owner 2026-10-01

**Decision:** three tile sections, every title and image edited in the back office (Home page tiles); a tile with no image yet shows a dark placeholder.
- **Under the hero**, replacing the Race / Play / Hang out triptych, in the `new-raceplay.jpeg` format: a heading, a 2×2 grid of image tiles with the title across the middle, and a wide bar — "8 Simulators · Explore" → Book now. Tiles: Race., Play., Hang out., and **Compete.** added to fill the grid (remove it in the back office if not wanted).
- **#6 Book your event**, **(asked)** replacing "Drivers, start your engines", in the same format **(asked: same layout on purpose)**: Solo Race, Race with Friends, VR Race, Free Roam, Leaderboard Challenge, Time Attack. **Every tile goes to Book now.**
- **#7 Types of driving**, below it, in the `no-7.jpeg` format (3 columns of squares on a phone, 4 on a wide screen): F1, GT3, Rally, Drift, Supercars, Offroad Trucks, & Others. **Static** — not links. The bottom bar's Explore lands here.
