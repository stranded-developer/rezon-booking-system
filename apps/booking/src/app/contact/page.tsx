import type { Metadata } from "next";
import { connection } from "next/server";
import { api } from "@/lib/api";
import { dayName, formatWallTime } from "@/lib/format";
import type { PublicConfig } from "@/lib/types";
import { Reveal } from "@/components/reveal";
import { ButtonLink, Checkers, Notice, SectionTitle } from "@/components/ui";

export const metadata: Metadata = {
  title: "Find us — Raceground",
  description: "Where Raceground is, when we're open, and how to get in touch.",
};

/** Everything here is edited in the back office (D58). */
export default async function ContactPage() {
  await connection();
  let config: PublicConfig | null = null;
  try {
    config = await api<PublicConfig>("/public/config");
  } catch {
    config = null;
  }

  if (!config) {
    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-16">
        <Notice tone="warn">We couldn&apos;t load the venue details just now. Please try again shortly.</Notice>
      </div>
    );
  }

  const { venue, openingHours } = config;

  return (
    <>
      <section className="mx-auto w-full max-w-4xl px-4 py-16 text-center">
        <h1 className="display text-5xl sm:text-6xl">
          Find <span className="text-flag">us</span>
        </h1>
        {venue.intro ? <p className="mx-auto mt-6 max-w-2xl text-lg text-ink-600">{venue.intro}</p> : null}
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <ButtonLink href="/book" variant="primary" size="lg">
            Book now
          </ButtonLink>
          {venue.address ? (
            <a
              href={`https://maps.google.com/?q=${encodeURIComponent(venue.address)}`}
              target="_blank"
              rel="noreferrer"
              className="display inline-flex h-13 items-center justify-center rounded-xl bg-paper px-7 text-base tracking-wide text-ink-950 ring-1 ring-line transition hover:bg-mist"
            >
              Get directions
            </a>
          ) : null}
        </div>
      </section>

      <Checkers />

      <section className="bg-deep py-16">
        <div className="mx-auto grid w-full max-w-5xl gap-4 px-4 sm:grid-cols-2">
          <Reveal>
            <div className="h-full rounded-2xl border border-line bg-paper/70 p-6">
              <h2 className="display text-sm tracking-[0.2em] text-flag">Where and how</h2>
              <dl className="mt-5 space-y-5 text-sm">
                {venue.address ? (
                  <div>
                    <dt className="text-ink-500">Address</dt>
                    <dd className="mt-1">
                      <a
                        className="text-ink-950 transition hover:text-flag"
                        href={`https://maps.google.com/?q=${encodeURIComponent(venue.address)}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {venue.address}
                      </a>
                    </dd>
                  </div>
                ) : null}
                {venue.phone ? (
                  <div>
                    <dt className="text-ink-500">Phone</dt>
                    <dd className="mt-1">
                      <a className="text-ink-950 transition hover:text-flag" href={`tel:${venue.phone.replace(/\s/g, "")}`}>
                        {venue.phone}
                      </a>
                    </dd>
                  </div>
                ) : null}
                {venue.email ? (
                  <div>
                    <dt className="text-ink-500">Email</dt>
                    <dd className="mt-1">
                      <a className="text-ink-950 transition hover:text-flag" href={`mailto:${venue.email}`}>
                        {venue.email}
                      </a>
                    </dd>
                  </div>
                ) : null}
                {venue.instagramUrl ? (
                  <div>
                    <dt className="text-ink-500">Instagram</dt>
                    <dd className="mt-1">
                      <a className="text-ink-950 transition hover:text-flag" href={venue.instagramUrl} target="_blank" rel="noreferrer">
                        Follow us
                      </a>
                    </dd>
                  </div>
                ) : null}
                {!venue.address && !venue.phone && !venue.email ? <p className="text-ink-500">Contact details are coming soon.</p> : null}
              </dl>
            </div>
          </Reveal>

          <Reveal delayMs={90}>
            <div className="h-full rounded-2xl border border-line bg-paper/70 p-6">
              <h2 className="display text-sm tracking-[0.2em] text-flag">Hours</h2>
              <ul className="mt-5 space-y-2 text-sm">
                {openingHours.map((day) => (
                  <li key={day.dayOfWeek} className="flex items-center justify-between gap-4">
                    <span className="display text-gold">{dayName(day.dayOfWeek)}</span>
                    <span className="tnum text-ink-600">
                      {day.closed ? "Closed" : `${formatWallTime(day.open)} – ${formatWallTime(day.close)}`}
                    </span>
                  </li>
                ))}
              </ul>
              <p className="mt-5 text-sm text-ink-500">All times are Sydney time.</p>
            </div>
          </Reveal>
        </div>
      </section>

      <section className="mx-auto w-full max-w-4xl px-4 py-16">
        <Reveal>
          <SectionTitle>
            Got a <span className="text-flag">question</span>?
          </SectionTitle>
          <p className="mx-auto mt-4 max-w-xl text-center text-ink-600">
            Give us a call or send an email and we&apos;ll get back to you. For a booking you already have, use the link in your confirmation email.
          </p>
        </Reveal>
      </section>
    </>
  );
}
