import Link from "next/link";
import { formatCents, formatMinutes, formatWallTime } from "@/lib/format";
import { formatDays, happyHourOf } from "@/lib/happy-hour";
import type { Experience } from "@/lib/types";

/** "30 minutes", "60 minutes": written out, as the mockups do. */
const lengthOf = (minutes: number) => `${minutes} minutes`;

/**
 * One experience, as in the owner's three mockups (D98): near-black card, white name, the lime line
 * and price, ticked lines and a lime button. The price reads as it did before (D112): "from" the
 * cheapest price anyone can pay, "normally" the list price; happy hour has its own violet box.
 *
 * `href` makes the button a link (the home page); `onBook` makes it open the booking panel (`/book`).
 */
export function ExperienceCard({ exp, href, onBook }: { exp: Experience; href?: string; onBook?: () => void }) {
  const happy = happyHourOf(exp);
  const label = exp.buttonLabel ?? `Book ${exp.name}`;
  const buttonClass =
    "display mt-6 flex min-h-12 w-full items-center justify-center rounded-xl bg-flag px-4 py-3 text-center text-sm text-on-flag transition hover:bg-flag-bright";

  return (
    <article className="flex h-full flex-col rounded-2xl border border-line bg-night p-6">
      {exp.badges.length > 0 ? (
        <div className="mb-3 flex flex-wrap gap-2">
          {exp.badges.map((badge, i) => (
            <span
              key={badge}
              className={`display rounded-full px-3 py-1 text-[0.65rem] tracking-wide ${i === 0 ? "bg-emerald-950 text-emerald-400" : "bg-mist text-ink-800"}`}
            >
              {badge}
            </span>
          ))}
        </div>
      ) : null}

      <div className="flex items-start justify-between gap-3">
        <h3 className="display text-2xl">{exp.name}</h3>
        {exp.badges.length === 0 ? (
          <span className="display shrink-0 rounded-full bg-mist px-3 py-1 text-[0.65rem] tracking-wide text-ink-800">{lengthOf(exp.minutes)}</span>
        ) : null}
      </div>
      {exp.tagline ? <p className="display mt-2 text-sm text-flag">{exp.tagline}</p> : null}

      {/* D112: the price as it was before D98 — "from" the cheapest price, then what it normally costs. */}
      <p className="mt-4 flex items-baseline gap-2">
        {exp.fromPriceCents < exp.priceCents ? <span className="display text-sm text-ink-500">from</span> : null}
        <span className="display tnum text-4xl text-flag">{formatCents(exp.fromPriceCents)}</span>
        <span className="text-sm text-ink-500">· {formatMinutes(exp.minutes)}</span>
      </p>
      {exp.fromPriceCents < exp.priceCents ? <p className="tnum mt-1 text-sm text-ink-500">normally {formatCents(exp.priceCents)}</p> : null}

      {happy ? (
        <div className="mt-3 rounded-lg bg-violet/25 px-3 py-2 ring-1 ring-violet">
          <p className="display flex items-baseline justify-between gap-3 text-sm">
            <span className="text-flag">{happy.name}</span>
            <span className="tnum text-lg">{formatCents(happy.priceCents)}</span>
          </p>
          <p className="text-xs text-ink-800">
            {formatWallTime(happy.startTime)}–{formatWallTime(happy.endTime)}, {formatDays(happy.daysOfWeek)}
          </p>
        </div>
      ) : null}

      <div aria-hidden className="my-5 h-px bg-line" />

      {exp.bullets.length > 0 ? (
        <ul className="flex-1 space-y-2.5 text-sm text-ink-800">
          {exp.bullets.map((bullet) => (
            <li key={bullet} className="flex gap-2">
              <span aria-hidden>✓</span>
              {bullet}
            </li>
          ))}
        </ul>
      ) : (
        <div className="flex-1" />
      )}

      {href ? (
        <Link href={href} className={buttonClass}>
          {label}
        </Link>
      ) : (
        <button type="button" onClick={onBook} className={buttonClass}>
          {label}
        </button>
      )}
    </article>
  );
}
