import Image from "next/image";
import { connection } from "next/server";
import { api } from "@/lib/api";
import { dayName, formatCents, formatRate, formatWallTime } from "@/lib/format";
import type { Experience, PublicConfig } from "@/lib/types";
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

  const { venue, photos, resourceTypes, openingHours, experiences, tiers } = config;
  const happyHourPromo = experiences.flatMap((e) => e.promos).find((p) => !p.claimed);

  return (
    <>
      <Hero intro={venue.intro} />
      <Triptych photos={photos} />
      <Checkers />
      <HowItWorks />
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

/**
 * The reference's "eat / drink / race" triptych. The owner asked to ignore assets for now, so with
 * no photos uploaded these are drawn panels rather than empty frames — the section still reads.
 */
function Triptych({ photos }: { photos: PublicConfig["photos"] }) {
  const panels = [
    { word: "Race", tint: "from-flag/40" },
    { word: "Play", tint: "from-sky-500/35" },
    { word: "Hang out", tint: "from-gold/30" },
  ];
  return (
    <section aria-label="What Raceground is" className="mx-auto w-full max-w-6xl px-4 pb-16">
      <div className="grid gap-3 sm:grid-cols-3">
        {panels.map((panel, i) => {
          const photo = photos[i];
          return (
            <Reveal key={panel.word} delayMs={i * 90}>
              <figure className="group relative h-56 overflow-hidden rounded-2xl border border-line bg-deep sm:h-72">
                {photo ? (
                  <Image
                    src={photo.url}
                    alt={photo.caption ?? "Raceground"}
                    fill
                    sizes="(max-width: 640px) 100vw, 33vw"
                    className="object-cover transition-transform duration-700 group-hover:scale-105"
                  />
                ) : (
                  <div aria-hidden className={`absolute inset-0 bg-gradient-to-br ${panel.tint} via-deep to-night`} />
                )}
                <div aria-hidden className="absolute inset-0 bg-gradient-to-t from-night via-night/20 to-transparent" />
                <figcaption className="display absolute inset-x-0 bottom-0 p-5 text-3xl">{panel.word}.</figcaption>
              </figure>
            </Reveal>
          );
        })}
      </div>
    </section>
  );
}

function HowItWorks() {
  const steps = [
    { n: 1, title: "Book online", body: "Pick what you want, a day and a time. Walk-ins are welcome, but booking is the only way to be sure of a spot." },
    { n: 2, title: "Turn up", body: "Show your booking code at the counter. We hold your spot for 15 minutes after the start time." },
    { n: 3, title: "Play", body: "Race a simulator — standard or VR — or rack up a frame on a billiard table. Staff will get you started." },
    { n: 4, title: "Come back for less", body: "Members get a discount on every booking and free play minutes every month." },
  ];
  const edges = ["border-t-flag", "border-t-gold", "border-t-sky-400", "border-t-emerald-400"];

  return (
    <section className="mx-auto w-full max-w-6xl px-4 py-16">
      <Reveal>
        <SectionTitle kicker="New here?">
          Drivers, <span className="text-flag">start your engines</span>
        </SectionTitle>
      </Reveal>
      <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {steps.map((step, i) => (
          <Reveal key={step.n} delayMs={i * 90}>
            <div className={`h-full rounded-2xl border border-line border-t-2 bg-paper/70 p-5 ${edges[i]}`}>
              <span className="display grid size-9 place-items-center rounded-full border border-line text-base">{step.n}</span>
              <h3 className="display mt-4 text-xl">{step.title}</h3>
              <p className="mt-2 text-sm text-ink-600">{step.body}</p>
            </div>
          </Reveal>
        ))}
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
