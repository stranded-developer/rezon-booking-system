"use client";

import { useMemo, useState } from "react";
import { formatVenueDate } from "@/lib/format";

const DAY_HEADS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** Venue dates are plain strings; none of this may touch the visitor's own timezone. */
function partsOf(date: string) {
  const [y, m, d] = date.split("-").map(Number);
  return { year: y!, month: m!, day: d! };
}
const iso = (year: number, month: number, day: number) =>
  `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

const daysInMonth = (year: number, month: number) => new Date(Date.UTC(year, month, 0)).getUTCDate();

/** ISO weekday (1 = Monday) of the first of the month. */
function firstWeekday(year: number, month: number) {
  const day = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  return day === 0 ? 7 : day;
}

const monthName = (year: number, month: number) =>
  new Intl.DateTimeFormat("en-AU", { timeZone: "UTC", month: "long", year: "numeric" }).format(new Date(Date.UTC(year, month - 1, 1)));

/**
 * The month grid from the reference's first step.
 *
 * Dates are venue dates end to end — `today` and the booking window both come from the API, so a
 * visitor in another timezone sees the same days a visitor in Sydney does.
 */
export function MonthCalendar({
  today,
  lastDate,
  closedWeekdays,
  value,
  onSelect,
}: {
  today: string;
  lastDate: string;
  /** ISO weekdays the venue is shut, so they can be greyed out before anything is looked up. */
  closedWeekdays: number[];
  value: string | null;
  onSelect: (date: string) => void;
}) {
  const start = partsOf(today);
  const [shown, setShown] = useState({ year: start.year, month: start.month });

  const last = partsOf(lastDate);
  const canGoBack = shown.year > start.year || (shown.year === start.year && shown.month > start.month);
  const canGoForward = shown.year < last.year || (shown.year === last.year && shown.month < last.month);

  const cells = useMemo(() => {
    const total = daysInMonth(shown.year, shown.month);
    const lead = firstWeekday(shown.year, shown.month) - 1;
    const out: (string | null)[] = Array.from({ length: lead }, () => null);
    for (let day = 1; day <= total; day++) out.push(iso(shown.year, shown.month, day));
    return out;
  }, [shown]);

  const step = (by: number) => {
    const m = shown.month + by;
    if (m < 1) setShown({ year: shown.year - 1, month: 12 });
    else if (m > 12) setShown({ year: shown.year + 1, month: 1 });
    else setShown({ ...shown, month: m });
  };

  const weekdayOf = (date: string) => {
    const p = partsOf(date);
    const day = new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay();
    return day === 0 ? 7 : day;
  };

  return (
    <div>
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          aria-label="Previous month"
          disabled={!canGoBack}
          onClick={() => step(-1)}
          className="grid size-9 place-items-center rounded-full border border-line text-ink-600 transition enabled:hover:border-flag enabled:hover:text-ink-950 disabled:opacity-30"
        >
          <svg viewBox="0 0 20 20" className="size-4" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
            <path d="M12 4L6 10l6 6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <p aria-live="polite" className="display text-lg">
          {monthName(shown.year, shown.month)}
        </p>
        <button
          type="button"
          aria-label="Next month"
          disabled={!canGoForward}
          onClick={() => step(1)}
          className="grid size-9 place-items-center rounded-full border border-line text-ink-600 transition enabled:hover:border-flag enabled:hover:text-ink-950 disabled:opacity-30"
        >
          <svg viewBox="0 0 20 20" className="size-4" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
            <path d="M8 4l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>

      <div className="mt-4 grid grid-cols-7 gap-1 text-center">
        {DAY_HEADS.map((head) => (
          <div key={head} className="pb-1 text-xs text-ink-500">
            {head}
          </div>
        ))}
        {cells.map((date, i) => {
          if (!date) return <div key={`pad-${i}`} />;
          const inWindow = date >= today && date <= lastDate;
          const closed = closedWeekdays.includes(weekdayOf(date));
          const selectable = inWindow && !closed;
          const selected = date === value;
          return (
            <button
              key={date}
              type="button"
              disabled={!selectable}
              aria-pressed={selected}
              aria-label={`${formatVenueDate(date)}${closed && inWindow ? " — closed" : ""}`}
              onClick={() => onSelect(date)}
              className={`tnum grid h-10 place-items-center rounded-lg text-sm transition ${
                selected
                  ? "bg-flag font-bold text-white"
                  : selectable
                    ? "bg-mist/60 text-ink-950 hover:bg-mist"
                    : "text-ink-500/40"
              }`}
            >
              {partsOf(date).day}
            </button>
          );
        })}
      </div>

      <p className="mt-4 text-center text-xs text-ink-500">
        Booking is open to {formatVenueDate(lastDate)}. All times are Sydney time.
      </p>
    </div>
  );
}
