"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useAccount } from "@/components/account-provider";
import { BookingPanel, type BookTarget } from "@/components/book/booking-panel";
import { ExperienceCard } from "@/components/experience-card";
import { Reveal } from "@/components/reveal";
import { Button, Notice, SectionTitle, Spinner } from "@/components/ui";
import { errorMessage } from "@/lib/api";
import { formatMinutes, formatRate, formatWallTime } from "@/lib/format";
import type { PublicConfig } from "@/lib/types";

/**
 * `/book`: choose what you want, then book it in a panel over the page (D71).
 *
 * The grid is the shape the reference uses — the named experiences first, then anything still sold
 * by the hour. `?experience=<key>` opens the panel straight away, so a "Book now" on a card
 * elsewhere on the site lands on the right thing.
 */
export function BookView() {
  const { request } = useAccount();
  const params = useSearchParams();
  const [config, setConfig] = useState<PublicConfig | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [target, setTarget] = useState<BookTarget | null>(null);
  /** `?experience=<key>` opens the panel on arrival, so a "Book now" elsewhere lands on the right thing. */
  const wantedExperience = params.get("experience");
  /** `?type=<key>` does the same for something booked by the hour. */
  const wantedType = params.get("type");
  /**
   * `&date=…&time=…` puts the customer back where they were: a guest who says they are a member
   * logs in and returns here with the day and time they had already picked (D79).
   */
  const resumeDate = params.get("date");
  const resumeTime = params.get("time");
  /** Only for the panel the URL opened: closing it and picking something else starts fresh. */
  const [resumeAt, setResumeAt] = useState<{ date: string; time: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    request<PublicConfig>("/public/config")
      .then((c) => {
        if (cancelled) return;
        setConfig(c);
        const experience = wantedExperience ? c.experiences.find((e) => e.key === wantedExperience) : undefined;
        const type = wantedType ? c.resourceTypes.find((t) => t.key === wantedType) : undefined;
        if (experience) setTarget({ kind: "experience", experience });
        else if (type) setTarget({ kind: "hourly", type });
        if ((experience || type) && resumeDate && resumeTime) setResumeAt({ date: resumeDate, time: resumeTime });
      })
      .catch((err: unknown) => !cancelled && setError(errorMessage(err)));
    return () => {
      cancelled = true;
    };
  }, [request, wantedExperience, wantedType, resumeDate, resumeTime]);

  if (error) return <Notice tone="error">{error}</Notice>;
  if (!config) return <Spinner label="Loading what's available…" />;

  const experienceTypeIds = new Set(config.experiences.map((e) => e.resourceTypeId));
  const hourlyTypes = config.resourceTypes.filter((t) => !experienceTypeIds.has(t.id));
  const happyHour = config.experiences.flatMap((e) => e.promos).find((p) => !p.claimed);

  return (
    <>
      <SectionTitle kicker="Book now" level={1} className="mb-3">
        Choose your <span className="text-gold">experience</span>
      </SectionTitle>
      <p className="mx-auto mb-10 max-w-xl text-center text-sm text-ink-600">
        Every price includes GST. All times are Sydney time.
        {happyHour ? ` ${happyHour.name} runs ${formatWallTime(happyHour.startTime)} to ${formatWallTime(happyHour.endTime)} every day.` : ""}
      </p>

      {config.experiences.length > 0 ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {config.experiences.map((exp, i) => (
            <Reveal key={exp.id} delayMs={i * 80}>
              <ExperienceCard exp={exp} onBook={() => setTarget({ kind: "experience", experience: exp })} />
            </Reveal>
          ))}
        </div>
      ) : null}

      {hourlyTypes.length > 0 ? (
        <Reveal className="mt-12">
          <h2 className="display mb-4 text-xl">Also by the hour</h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {hourlyTypes.map((type) => (
              <article key={type.id} className="flex flex-col rounded-2xl border border-line bg-paper/70 p-6">
                <h3 className="display text-xl">{type.name}</h3>
                <p className="display tnum mt-2 text-3xl text-flag">{formatRate(type.baseRateCents)}</p>
                {type.fromRateCents < type.baseRateCents ? (
                  <p className="tnum mt-1 text-sm text-gold">{formatRate(type.fromRateCents)} in happy hour</p>
                ) : null}
                <p className="mt-1 flex-1 text-sm text-ink-500">
                  {type.resources.length} available · booked in {formatMinutes(config.sessionMinutes)} sessions
                </p>
                <Button variant="secondary" className="mt-5 w-full" onClick={() => setTarget({ kind: "hourly", type })}>
                  Book {type.name}
                </Button>
              </article>
            ))}
          </div>
        </Reveal>
      ) : null}

      {target ? (
        <BookingPanel
          config={config}
          target={target}
          resumeAt={resumeAt}
          onClose={() => {
            setTarget(null);
            setResumeAt(null);
          }}
        />
      ) : null}
    </>
  );
}
