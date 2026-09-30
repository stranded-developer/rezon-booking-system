import { connection } from "next/server";
import { api } from "@/lib/api";
import { dayName, formatCents, formatRate, formatWallTime } from "@/lib/format";
import type { Experience, PublicConfig } from "@/lib/types";
import { DrivingTiles, EventTiles, HighlightTiles } from "@/components/home-tiles";
import { Reveal } from "@/components/reveal";
import { Badge, ButtonLink, Checkers, Notice, SectionTitle } from "@/components/ui";

/** The venue's own details, photos, prices and experiences all come from the back office. */
export default async function HomePage() {
  // Render per request: a change in the back office should show on the site straight away.
  await connection();
  let config: PublicConfig | null = null;
  try {
    config = await api<PublicConfig>("/public/config");
  } catch {
    config = null;
  }

  if (!config) {
    return (
      <>
        <Hero intro={null} />
        <div className="mx-auto w-full max-w-5xl px-4 py-10">
          <Notice tone="warn">Our booking system is having a moment. Please try again shortly, or call the venue.</Notice>
        </div>
      </>
    );
  }

  const { venue, resourceTypes, openingHours, experiences, tiers } = config;
  const tiles = config.tiles ?? [];
  const simulators = resourceTypes.find((t) => t.key === "sim")?.resources.length ?? 0;
  const happyHourPromo = experiences.flatMap((e) => e.promos).find((p) => !p.claimed);

  return (
    <>
      <Hero intro={venue.intro} />
      {/* D87: the owner's tile layout, in place of the triptych and the four steps. */}
      <HighlightTiles tiles={tiles.filter((t) => t.section === "highlights")} simulators={simulators} />
      <Checkers />
      <EventTiles tiles={tiles.filter((t) => t.section === "events")} />
      <DrivingTiles tiles={tiles.filter((t) => t.section === "driving")} />
      <WhatYouCanBook config={config} experiences={experiences} resourceTypes={resourceTypes} />
      {happyHourPromo ? (
        <Reveal className="mx-auto w-full max-w-6xl px-4">
          <p className="display rounded-2xl border border-gold/40 bg-gold/10 px-6 py-4 text-center text-lg text-gold">
            {happyHourPromo.name}: {formatWallTime(happyHourPromo.startTime)} to {formatWallTime(happyHourPromo.endTime)}, every day
          </p>
        </Reveal>
      ) : null}
      <Membership tiers={tiers} />
      <Hours openingHours={openingHours} bookingWindowDays={config.bookingWindowDays} />
      <ReadyToRace />
    </>
  );
}

function Hero({ intro }: { intro: string | null }) {
  return (
    <section className="relative overflow-hidden">
      <div className="mx-auto w-full max-w-6xl px-4 py-16 text-center sm:py-24">
        <p className="display text-sm tracking-[0.3em] text-flag">Sydney</p>
        <h1 className="display mx-auto mt-4 max-w-5xl text-4xl sm:text-6xl">
          Sydney&apos;s <span className="text-flag">sim racing</span>, billiards and VR lounge
        </h1>
        <p className="mx-auto mt-6 max-w-2xl text-lg text-ink-600">
          {intro ?? "Pick a time, pay online and show your booking code at the counter."}
        </p>
        <div className="mt-9 flex flex-wrap justify-center gap-3">
          <ButtonLink href="/book" variant="primary" size="lg">
            Book now
          </ButtonLink>
          <ButtonLink href="/membership" variant="secondary" size="lg">
            See membership
          </ButtonLink>
        </div>
      </div>
    </section>
  );
}

function WhatYouCanBook({
  config,
  experiences,
  resourceTypes,
}: {
  config: PublicConfig;
  experiences: Experience[];
  resourceTypes: PublicConfig["resourceTypes"];
}) {
  // Resource types sold as an experience are shown as those experiences, not twice.
  const experienceTypeIds = new Set(experiences.map((e) => e.resourceTypeId));
  const hourlyTypes = resourceTypes.filter((t) => !experienceTypeIds.has(t.id));

  return (
    <section className="bg-night/60 py-16">
      <div className="mx-auto w-full max-w-6xl px-4">
        <Reveal>
          <SectionTitle kicker="What you can book">
            Choose your <span className="text-gold">experience</span>
          </SectionTitle>
        </Reveal>

        {experiences.length > 0 ? (
          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {experiences.map((exp, i) => (
              <Reveal key={exp.id} delayMs={i * 90}>
                <article className="flex h-full flex-col overflow-hidden rounded-2xl border border-line bg-paper/80 transition-transform duration-300 hover:-translate-y-1">
                  <div aria-hidden className="checkers-thin" />
                  <div className="flex flex-1 flex-col p-6">
                    {exp.badges.length > 0 ? (
                      <div className="mb-3 flex flex-wrap gap-2">
                        {exp.badges.map((badge, b) => (
                          <Badge key={badge} tone={b === 0 ? "flag" : "gold"}>
                            {badge}
                          </Badge>
                        ))}
                      </div>
                    ) : null}
                    <h3 className="display text-2xl">{exp.name}</h3>
                    {exp.tagline ? <p className="text-sm text-ink-500">{exp.tagline}</p> : null}
                    <p className="mt-4 flex items-baseline gap-2">
                      {exp.fromPriceCents < exp.priceCents ? <span className="display text-sm text-ink-500">from</span> : null}
                      <span className="display tnum text-4xl text-flag">{formatCents(exp.fromPriceCents)}</span>
                      <span className="text-sm text-ink-500">· {exp.minutes} min</span>
                    </p>
                    {/* A "from" price is the cheapest anyone could pay; say what it usually costs too. */}
                    {exp.fromPriceCents < exp.priceCents ? (
                      <p className="tnum mt-1 text-sm text-ink-500">normally {formatCents(exp.priceCents)}</p>
                    ) : null}
                    {exp.bullets.length > 0 ? (
                      <ul className="mt-4 flex-1 space-y-2 text-sm text-ink-600">
                        {exp.bullets.map((bullet) => (
                          <li key={bullet} className="flex gap-2">
                            <span aria-hidden className="text-flag">
                              ✓
                            </span>
                            {bullet}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <div className="flex-1" />
                    )}
                    <ButtonLink href={`/book?experience=${exp.key}`} variant="primary" className="mt-6 w-full">
                      Book now
                    </ButtonLink>
                  </div>
                </article>
              </Reveal>
            ))}
          </div>
        ) : null}

        {hourlyTypes.length > 0 ? (
          <Reveal className="mt-10">
            <div className="rounded-2xl border border-line bg-paper/60 p-6">
              <h3 className="display text-xl">Also by the hour</h3>
              <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {hourlyTypes.map((type) => (
                  <div key={type.id} className="rounded-xl border border-line p-4">
                    <h4 className="display text-lg">{type.name}</h4>
                    <p className="display tnum mt-1 text-2xl text-flag">{formatRate(type.baseRateCents)}</p>
                    {type.fromRateCents < type.baseRateCents ? (
                      <p className="tnum mt-1 text-sm text-gold">{formatRate(type.fromRateCents)} in happy hour</p>
                    ) : null}
                    <p className="mt-1 text-sm text-ink-500">
                      {type.resources.length} available · from {config.sessionMinutes} min
                    </p>
                  </div>
                ))}
              </div>
              <p className="mt-4 text-sm text-ink-500">
                Book a {config.sessionMinutes}-minute session, then add 15 minutes at a time. Walk in and we bill by the minute. Every price includes GST.
              </p>
            </div>
          </Reveal>
        ) : null}
      </div>
    </section>
  );
}

function Membership({ tiers }: { tiers: PublicConfig["tiers"] }) {
  if (tiers.length === 0) return null;
  return (
    <section className="mx-auto w-full max-w-6xl px-4 py-16">
      <Reveal>
        <SectionTitle kicker="Members club">
          Race more, <span className="text-gold">pay less</span>
        </SectionTitle>
      </Reveal>
      <div className="mt-10 grid gap-4 sm:grid-cols-3">
        {tiers.map((tier, i) => (
          <Reveal key={tier.id} delayMs={i * 90}>
            <div className="h-full rounded-2xl border border-line bg-paper/80 p-6 text-center">
              <h3 className="display text-xl text-gold">{tier.name}</h3>
              <p className="display tnum mt-2 text-4xl">
                {formatCents(tier.monthlyPriceCents)}
                <span className="text-base text-ink-500">/mo</span>
              </p>
              <p className="mt-3 text-sm text-ink-600">
                {tier.discountBp / 100}% off every booking, and {tier.monthlyFreeMinutes} free minutes a month.
              </p>
            </div>
          </Reveal>
        ))}
      </div>
      <Reveal className="mt-8 flex flex-wrap justify-center gap-3">
        <ButtonLink href="/membership" variant="gold" size="lg">
          View memberships
        </ButtonLink>
        <ButtonLink href="/login" variant="secondary" size="lg">
          Member log in
        </ButtonLink>
      </Reveal>
    </section>
  );
}

function Hours({ openingHours, bookingWindowDays }: { openingHours: PublicConfig["openingHours"]; bookingWindowDays: number }) {
  return (
    <section className="bg-night/60 py-16">
      <div className="mx-auto w-full max-w-3xl px-4">
        <Reveal>
          <SectionTitle kicker="When we&apos;re open">Hours</SectionTitle>
        </Reveal>
        <Reveal className="mt-8">
          <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-paper/70">
            {openingHours.map((day) => (
              <li key={day.dayOfWeek} className="flex items-center justify-between gap-4 px-5 py-3">
                <span className="display text-gold">{dayName(day.dayOfWeek)}</span>
                <span className="tnum text-sm text-ink-600">
                  {day.closed ? "Closed" : `${formatWallTime(day.open)} – ${formatWallTime(day.close)}`}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-4 text-center text-sm text-ink-500">All times are Sydney time. You can book up to {bookingWindowDays} days ahead.</p>
        </Reveal>
      </div>
    </section>
  );
}

function ReadyToRace() {
  return (
    <section className="mx-auto w-full max-w-6xl px-4 py-20 text-center">
      <Reveal>
        <h2 className="display text-4xl sm:text-5xl">
          Ready to <span className="text-flag">race</span>?
        </h2>
        <p className="mx-auto mt-4 max-w-xl text-ink-600">
          Whether it&apos;s your first lap or your hundredth, the grid is open. Book online and get behind the wheel.
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <ButtonLink href="/book" variant="primary" size="lg">
            Book a session
          </ButtonLink>
          <ButtonLink href="/tournaments" variant="secondary" size="lg">
            See tournaments
          </ButtonLink>
        </div>
      </Reveal>
    </section>
  );
}
