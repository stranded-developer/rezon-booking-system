# Decisions — 2026-11-05: happy hours on one screen, longer simulator sessions

## D117 — Every happy hour on one screen, each one editable; the website shows the real days ✅ owner 2026-11-05

**Asked:** "changing the happy hour in backoffice to monday-friday for some reason in the web it still shows saturday and sunday too, is this reproducable bug, why does this happen, can fix??"

**What was found:**
- There are **two kinds of happy hour**. *Rates & happy hours* holds the **percent off** for anything sold by the hour (the billiard tables). Each **simulator package** (Single Session, Double Session, Leaderboard Challenge) has its **own happy-hour price** on *Experiences*. The owner changed the first to Mon–Fri. The three package prices were still every day 12–3pm (checked on the live public config), so the website correctly showed every day for the simulators.
- Two lines on the website said "every day" **whatever the days were**: the home page's billiards card and the top of `/book`. The home page's billiards card also showed the **simulators'** happy hour, not the billiards one.
- A package's happy-hour price could only be added, turned off or deleted. There was no way to change its days.

**Asked back:** should the simulators' happy hour also be Mon–Fri? **Answer:** "combine billiard tables and sim into one page."

**Decision:**
- *Rates & happy hours → Happy hours* lists **both kinds**:
  - **Sold by the hour — percent off** (as before, now with **Edit**);
  - **Packages — a price of their own**: every package's automatic promotional price, with **Edit** for days, times and price.
- Editing a package's price has **"Use these days and times for every package's Happy Hour"**, ticked by default. Every active package's price of the same name gets the same days and times, and each keeps its own price. The same Edit is on *Experiences*.
- Student prices (those the customer has to ask for) stay on *Experiences*.
- **Website:**
  - the billiards card on the home page and on `/book` shows the billiards' own happy hour with its real days;
  - the line on `/book` that said "every day" is gone; each package card already shows its own days.
- Changing the live prices to Mon–Fri is the owner's job in the back office. The system doesn't do it for them.

## D118 — A simulator session can be booked for longer, made of the packages ✅ owner 2026-11-05

**Asked:** "multiple hours booking for website is not available? so only able to book one hour time slot then to book more need new booking? can we add that"

**Explained:** billiard tables can already be booked for any length. The simulators are sold as packages with a fixed length (Single Session 30 min, Double Session 1 hour), so 1 hour was the most.

**Asked back:** how should a longer simulator booking be priced? **Answer:** "can it follow the promotions/packages setup with walk ins, else if not existing package follow the repeat sessions". **Confirmed:** the rule below, with the worked prices.

**Decision:**
- On **Single Session** and **Double Session**, the customer also picks **how long**: from the package's own length, in 30-minute steps, until the simulator's next booking or closing time. For a group, the length is limited to what every simulator is free for.
- **The price is made of packages** (`splitIntoPackages` in the pricing engine):
  - if the owner has a package of **exactly that length**, that package is used;
  - otherwise the **longest packages first**: 2 h = Double + Double, 1.5 h = Double + Single.
  - Today's prices: 1 h $58 · 1.5 h $93 · 2 h $116 · 3 h $174. With a "2 Hours" package at $99, 2 h = $99 and 3 h = $99 + $58.
- **Each package is priced at its own start time:**
  - happy hour counts for a package that starts in it (2 h from 2pm = $49 + $58 = $107);
  - a member's flat price, or their percentage, applies to each;
  - a student price that the customer asks for applies to each package that has a price of that name;
  - free play and groups work over the whole length, as before (D106);
  - a referral comes off the total once.
- Which packages can do this is a tick on *Experiences*: **"Customers can book it for longer online"** (`experiences.extendable`). It's on for Single and Double Session at launch and off for Leaderboard Challenge, which keeps its fixed length. A longer booking is made only of ticked, online packages of the same type.
- **The database** lets an extendable package's booking be longer than the package, in whole sessions only and never shorter. The time is blocked for everyone else exactly as for any booking.
- Nothing changes at the counter: walk-in packages (D115, D116) are still their own length.
