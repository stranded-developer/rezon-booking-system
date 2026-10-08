import Link from "next/link";
import { connection } from "next/server";
import { api } from "@/lib/api";
import { dayName, formatCents, formatRate, formatWallTime } from "@/lib/format";
import type { Experience, PublicConfig } from "@/lib/types";
import { Chevron, DrivingTiles, EventTiles, HighlightTiles, SectionHeading } from "@/components/home-tiles";
import { Reveal } from "@/components/reveal";
import { RigGallery } from "@/components/rig-gallery";
import { Badge, ButtonLink, Notice } from "@/components/ui";

/**
 * The home page in the owner's mockup (D88). Every word that isn't a heading, and every number,
 * still comes from the back office: experiences, prices, tiers, hours and the tiles.
 */
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
        <Hero intro={null} simulators={0} />
        <div className="mx-auto w-full max-w-6xl px-4 py-10">
          <Notice tone="warn">Our booking system is having a moment. Please try again shortly, or call the venue.</Notice>
        </div>
      </>
    );
  }

  const tiles = config.tiles ?? [];
  const simulators = config.resourceTypes.find((t) => t.key === "sim")?.resources.length ?? 0;

  return (
    <>
      <Hero intro={config.venue.intro} simulators={simulators} />
      <WhatYouCanBook config={config} />
      <HighlightTiles tiles={tiles.filter((t) => t.section === "highlights")} />
      <EventTiles tiles={tiles.filter((t) => t.section === "events")} />
      <DrivingTiles tiles={tiles.filter((t) => t.section === "driving")} />
      <MembersClub tiers={config.tiers} sessionMinutes={config.sessionMinutes} />
      <Hours openingHours={config.openingHours} bookingWindowDays={config.bookingWindowDays} />
      <ReadyToRace />
    </>
  );
}

function Hero({ intro, simulators }: { intro: string | null; simulators: number }) {
  return (
    <section className="relative overflow-hidden">
      <div className="mx-auto grid w-full max-w-6xl items-center gap-6 px-4 pb-10 pt-12 sm:pt-16 lg:grid-cols-[1fr_1.05fr]">
        <div>
          <p className="kicker flex items-center gap-3">
            <span aria-hidden className="h-px w-8 bg-flag" />
            Sydney
          </p>
          <h1 className="display mt-5">
            <span className="block text-lg sm:text-2xl">Sydney&apos;s</span>
            <span className="mt-1 block text-[2.6rem] leading-[0.95] sm:text-6xl">Sim racing,</span>
            <span className="mt-1 block text-2xl sm:text-4xl">Billiards and</span>
            <span className="mt-1 block text-[2.6rem] leading-[0.95] text-flag sm:text-7xl">VR lounge</span>
          </h1>
          <p className="mt-6 max-w-md text-ink-600">{intro ?? "Pick a time, pay online and show your booking code at the counter."}</p>
          <div className="mt-8 flex flex-wrap items-center gap-5">
            <ButtonLink href="/book" variant="primary" size="lg">
              Book now
            </ButtonLink>
            <Link href="/membership" className="kicker flex items-center gap-1 text-ink-950! hover:text-flag!">
              See membership <Chevron />
            </Link>
          </div>
        </div>

        <div>
          {/* D92: the owner asked for the rig smaller — three quarters of the column on a phone, at most 24rem. */}
          <RigGallery className="mx-auto w-3/4 max-w-sm" />
          <div className="mt-6 flex items-end justify-between gap-4">
            <p className="border-l-2 border-flag pl-3">
              <span className="kicker block max-w-[14ch] leading-relaxed">Your place on the grid</span>
              <span className="mt-1 block text-xs uppercase tracking-wider text-ink-500">Triple screens · Bucket seat</span>
            </p>
            {simulators > 0 ? (
              <Link href="/book" className="flex items-center gap-3 rounded-lg border border-line bg-paper/80 px-4 py-3 transition hover:border-flag">
                <span className="display text-3xl">{simulators}</span>
                <span>
                  <span className="kicker block text-ink-950!">Simulators</span>
                  <span className="kicker block">Explore</span>
                </span>
              </Link>
            ) : null}
          </div>
        </div>
      </div>
    </section>
  );
}

function WhatYouCanBook({ config }: { config: PublicConfig }) {
  const { experiences, resourceTypes } = config;
  // Resource types sold as an experience are shown as those experiences, not twice.
  const experienceTypeIds = new Set(experiences.map((e) => e.resourceTypeId));
  const hourlyTypes = resourceTypes.filter((t) => !experienceTypeIds.has(t.id));
  const happyHour = experiences.flatMap((e) => e.promos).find((p) => !p.claimed);

  return (
    <section className="mx-auto w-full max-w-6xl px-4 py-16 sm:py-20">
      <SectionHeading kicker="What you can book" title="Choose your experience" />
      {experiences.length > 0 ? (
        <div className="mt-8 grid gap-4 lg:grid-cols-3">
          {experiences.map((exp, i) => (
            <Reveal key={exp.id} delayMs={i * 80}>
              <ExperienceCard exp={exp} />
            </Reveal>
          ))}
        </div>
      ) : null}

      {hourlyTypes.map((type) => (
        <Reveal key={type.id} className="mt-4">
          <article className="rounded-xl border border-line bg-paper/70 p-5 sm:p-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="kicker">Also by the hour</p>
                <h3 className="display mt-2 text-lg">{type.name}</h3>
                <p className="mt-1 text-xs text-ink-500">
                  {type.resources.length} available · from {config.sessionMinutes} min
                </p>
              </div>
              <div className="text-right">
                <p className="display tnum text-2xl">
                  {formatCents(type.baseRateCents)}
                  <span className="ml-1 text-xs text-ink-500">/hr</span>
                </p>
                {type.fromRateCents < type.baseRateCents ? <p className="tnum text-xs text-ink-500">{formatRate(type.fromRateCents)} in happy hour</p> : null}
              </div>
            </div>
            <p className="mt-4 border-t border-line pt-4 text-sm text-ink-600">
              Book in {config.sessionMinutes}-minute sessions. Walk in and we charge in 15-minute blocks. Every price includes GST.
            </p>
            {happyHour ? (
              <p className="kicker mt-3">
                {happyHour.name}: {formatWallTime(happyHour.startTime)} to {formatWallTime(happyHour.endTime)}, every day
              </p>
            ) : null}
          </article>
        </Reveal>
      ))}
    </section>
  );
}

/** The mockup's experience card; the most popular one is the violet, featured card. */
function ExperienceCard({ exp }: { exp: Experience }) {
  const featured = exp.badges.length > 0;
  return (
    <article
      className={`flex h-full flex-col rounded-xl border p-5 sm:p-6 ${
        featured ? "border-violet bg-gradient-to-br from-violet to-violet-deep shadow-[0_20px_60px_-25px_var(--color-violet)]" : "border-line bg-paper/70"
      }`}
    >
      {featured ? (
        <div className="mb-3 flex flex-wrap gap-2">
          {exp.badges.map((badge, b) => (
            <Badge key={badge} tone={b === 0 ? "flag" : "quiet"}>
              {badge}
            </Badge>
          ))}
        </div>
      ) : null}
      <h3 className="display text-xl">{exp.name}</h3>
      {exp.tagline ? <p className={`mt-1 text-sm ${featured ? "text-ink-800" : "text-ink-500"}`}>{exp.tagline}</p> : null}

      <p className="kicker mt-5 text-ink-950!">From</p>
      <div className="mt-1 flex items-baseline justify-between gap-3">
        <p className="flex items-baseline gap-2">
          <span className={`display tnum text-3xl ${featured ? "text-flag" : ""}`}>{formatCents(exp.fromPriceCents)}</span>
          <span className="text-xs text-ink-500">{exp.minutes} min</span>
        </p>
        {/* A "from" price is the cheapest anyone could pay; say what it usually costs too. */}
        {exp.fromPriceCents < exp.priceCents ? <span className="tnum text-xs text-ink-500">normally {formatCents(exp.priceCents)}</span> : null}
      </div>

      {exp.bullets.length > 0 ? (
        <ul className={`mt-5 flex-1 space-y-2 border-t pt-5 text-sm ${featured ? "border-white/15 text-ink-800" : "border-line text-ink-600"}`}>
          {exp.bullets.map((bullet) => (
            <li key={bullet} className="flex gap-3">
              <span aria-hidden className={featured ? "text-flag" : "text-violet"}>
                •
              </span>
              {bullet}
            </li>
          ))}
        </ul>
      ) : (
        <div className="flex-1" />
      )}

      <Link
        href={`/book?experience=${exp.key}`}
        className={`kicker mt-6 flex h-11 items-center justify-between rounded-lg px-4 transition ${
          featured ? "bg-flag text-on-flag! hover:bg-flag-bright" : "border border-line text-ink-950! hover:border-flag"
        }`}
      >
        Book now <Chevron />
      </Link>
    </article>
  );
}

function MembersClub({ tiers, sessionMinutes }: { tiers: PublicConfig["tiers"]; sessionMinutes: number }) {
  if (tiers.length === 0) return null;
  return (
    <section className="bg-gradient-to-b from-violet-deep via-violet/60 to-night">
      <div className="mx-auto w-full max-w-6xl px-4 py-16 sm:py-20">
        <SectionHeading
          kicker="Members club"
          title={
            <>
              Race more,
              <br />
              pay less
            </>
          }
          center
        />
        <div className="mt-10 grid gap-4 lg:grid-cols-3">
          {tiers.map((tier, i) => {
            // The middle tier is the most popular, as on the membership page.
            const featured = i === 1;
            const races = Math.floor(tier.monthlyFreeMinutes / sessionMinutes);
            return (
              <Reveal key={tier.id} delayMs={i * 80}>
                <article className={`h-full rounded-xl border p-5 sm:p-6 ${featured ? "border-flag bg-flag text-on-flag" : "border-white/10 bg-violet-deep/60 backdrop-blur"}`}>
                  <div className="flex items-baseline justify-between gap-3">
                    <h3 className={`kicker ${featured ? "text-on-flag!" : "text-ink-950!"}`}>{tier.name}</h3>
                    <p className="display tnum text-3xl">
                      {formatCents(tier.monthlyPriceCents)}
                      <span className="ml-1 text-[0.6rem]">/mo</span>
                    </p>
                  </div>
                  <p className={`mt-4 text-sm ${featured ? "text-on-flag/80" : "text-ink-600"}`}>
                    {tier.discountBp / 100}% off every booking, and{" "}
                    {races > 0 ? `${races} free ${races === 1 ? "race" : "races"}` : `${tier.monthlyFreeMinutes} free minutes`} a month.
                  </p>
                </article>
              </Reveal>
            );
          })}
        </div>
        <Reveal className="mt-8 flex flex-col items-center gap-4">
          <ButtonLink href="/membership" variant="secondary" size="lg">
            View memberships
          </ButtonLink>
          <Link href="/login" className="kicker flex items-center gap-1 text-ink-950! hover:text-flag!">
            Member log in <Chevron />
          </Link>
        </Reveal>
      </div>
    </section>
  );
}

function Hours({ openingHours, bookingWindowDays }: { openingHours: PublicConfig["openingHours"]; bookingWindowDays: number }) {
  return (
    <section className="mx-auto w-full max-w-6xl px-4 py-16 sm:py-20">
      <div className="grid gap-8 lg:grid-cols-[1fr_1.4fr]">
        <SectionHeading kicker="When we're open" title="Hours" sub={`All times are Sydney time. You can book up to ${bookingWindowDays} days ahead.`} />
        <Reveal>
          <ul className="divide-y divide-line border-y border-line">
            {openingHours.map((day) => (
              <li key={day.dayOfWeek} className="flex items-center justify-between gap-4 py-3.5">
                <span className="kicker text-ink-950!">{dayName(day.dayOfWeek)}</span>
                <span className="tnum text-sm text-ink-600">{day.closed ? "Closed" : `${formatWallTime(day.open)} – ${formatWallTime(day.close)}`}</span>
              </li>
            ))}
          </ul>
        </Reveal>
      </div>
    </section>
  );
}

function ReadyToRace() {
  return (
    <section className="mx-auto w-full max-w-6xl px-4 pb-20">
      <Reveal>
        <div className="rounded-2xl border border-violet/50 bg-gradient-to-br from-violet/70 via-violet-deep to-paper p-7 sm:p-12">
          <h2 className="display text-4xl sm:text-6xl">
            Ready to
            <br />
            race?
          </h2>
          <p className="mt-5 max-w-md text-ink-800">Whether it&apos;s your first lap or your hundredth, the grid is open. Book online and get behind the wheel.</p>
          <div className="mt-8 flex flex-wrap items-center gap-5">
            <ButtonLink href="/book" variant="primary" size="lg">
              Book a session
            </ButtonLink>
            <Link href="/tournaments" className="kicker flex items-center gap-1 text-ink-950! hover:text-flag!">
              See tournaments <Chevron />
            </Link>
          </div>
        </div>
      </Reveal>
    </section>
  );
}
