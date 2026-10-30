# Decisions — 2026-10-29/30: the 12-month membership plan, walk-in packages

## D114 — A 12-month membership paid monthly: 12 payments, then it stops ✅ owner 2026-10-29

**Asked:** "right now i see the membership can choose 12 months directly payment of card terminal … cant it do monthly rolling instead of straight up payment, like indefinite monthly rolling option, and 12 month option but monthly rolling too? is this possible? or not possible with stripe."

**Explained to the owner:**
- **Rolling monthly with no end already exists.** In the till, *Sell membership → On their phone* starts a Stripe subscription charged every month until the member cancels; joining on the website is the same.
- **The CommBank card terminal can't do rolling payments.** It isn't connected to Stripe, and the card never reaches our system, so nothing can charge it next month. That is why *At the counter* (D61) is paid up front.
- **A 12-month plan paid monthly is possible with Stripe.** Stripe can't force a payment, though: if a member cancels their card, the payments fail and the membership pauses and then ends, like any subscription.

**Asked back:** what happens at the end, and can they leave early? **Answer:** "12 payments, then stops" — charged monthly for 12 months, then it ends by itself, and the member can't cancel in the portal during the 12 months.

**Asked back:** how should staff sign people up for a rolling membership at the counter, since the terminal can't save the card? **Answer:** keep the phone QR (the customer types their card once on their own phone). No Stripe card reader.

**Decision:**
- *Sell membership → On their phone* offers two plans: **Monthly, until cancelled** (as before) and **12 months, paid monthly**. Same monthly price for both.
- The 12-month plan takes 12 monthly payments and then ends by itself. When it ends the member gets the usual "membership has ended" email, and the balance freezes for 30 days, then is forfeited (as for any ended membership).
- The member can't cancel it: there's no Cancel button on the account page, and Stripe's portal has cancelling turned off for these members. They can still update their card and see invoices.
- **Staff can end it early** in the back office (at the end of the paid month), and undo that. This covers someone moving away.
- *At the counter* (cash or card terminal, 1–12 months up front, D61) is unchanged.
- The website's *Join* stays monthly-until-cancelled. The API already accepts the 12-month plan there, so offering it online later is a page change only.

## D115 — Walk-in packages: 30 min / 1 hour / 2 hours, paid up front, priced in the back office ✅ owner 2026-10-29

**Asked:** "if i do walk in, theres no package, theres like unlimited playtime only, can we add package option so playtime 30 mins, 1 hour and 2 hour options, additionally in backoffice we also allow setting up optional package price? like if 1 hour then its $30 but 2 hour its $55, dynamically set."

**Asked back:** when do they pay, and what if they play past their time? **Answer:** "Pay first, no overrun charge" — they pay at the start; at the end the time-up pop-up appears as for a booking, and nothing extra is charged.

**Asked back:** which discounts apply, and should the simulators reuse the website's prices? **Answer:** "Same as website packages" — simulators use the existing Single/Double Session prices with happy hour, member prices and free play; billiards get new packages with their own prices.

**Decision:**
- A walk-in package is an **experience** (D65) marked **"At the counter"** in the back office. Each experience can now be sold **on the website**, **at the counter**, or both. All prices, promotions (Happy Hour, student) and member prices are set in the back office as they already were.
- At the till, a free table offers **Open time (pay at the end)** — the walk-in charged by the hour as before — or the table's packages.
- **Paid before the table starts.** Priced exactly as online: the cheapest of the list price, any promotion running when it starts, a price the customer asks for (student), and the member's own price; or the tier's percentage; free play in whole 30-minute sessions; or a referral code. Cash or card terminal on the open till. A receipt is printed then.
- The tile shows "1 hour until 17:00". At the end the time-up pop-up appears and **closing takes nothing more**, however late (as D48 for bookings). Closing early refunds nothing. A void (superadmin) refunds it and returns any free play.
- **Refused if** it would run past closing time, or a booking on that table starts before it would end.
- **Launch values:**
  - Simulators: Single Session (30 min) and Double Session (1 hour) are sold at the counter at their website prices. Leaderboard Challenge is sold at the counter too.
  - **New, counter only:** simulators 2 hours **$116** (two Double Sessions); billiards 30 min **$12.50**, 1 hour **$25**, 2 hours **$50**, which is the tables' current hourly rate.
  - **The owner should set the billiard and 2-hour prices** (their example was 1 hour $30, 2 hours $55).

**Worth knowing:**
- Billiard packages have no Happy Hour price unless one is added to them in the back office. The tables' hourly happy-hour rate (the $20 rate band) applies to open time only.
- Counter-only packages are never listed or bookable on the website.

## D116 — Packages can be paid at the end; the 12-month plan on the website; "monthly until cancelled" said plainly ✅ owner 2026-10-30

**Asked:** "can we add option of pay now or pay at the end for walk ins package" · "add the optional 12 month plan on the website, also on the backoffice and website make it clear if the months for membership are not picked it will run nonstop monthly recurring" · "close the leftover program".

**Decision (sensible defaults, not asked back — tell the owner):**
- **Packages:** the package screen has **Pay now** (D115, as before) and **Pay at the end**. Paid at the end:
  - the table starts at once with the package's end time; the same refusals (closing time, a booking on the table);
  - closing charges the **package's price at the time it started** (Happy Hour counts if it started in Happy Hour), with the member card, free play, student price or referral code given at the end, like open time;
  - **running over is not charged**, as with a package paid up front (D115's "no overrun charge");
  - a void refunds nothing, as nothing was paid.
- **Website:** the membership page offers **Monthly, until you cancel** (preselected) and **12 months, paid monthly**, with the note that without the 12-month plan it renews every month with no end date until cancelled. The account shows which plan.
- **Back office and till:** each member is labelled *Monthly, until cancelled*, *12-month plan*, *Paid at the counter* (doesn't renew) or *Complimentary*; the till's plan note says monthly is the default with no end date, and counter months "paid now, doesn't renew".
- Fixed along the way: a member who paid at the counter used to be labelled "Complimentary" in the back office.
