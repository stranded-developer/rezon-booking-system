/**
 * The session rules (D85), in one place so the booking panel, the booking page and the terms say
 * the same thing. The numbers are the venue's own settings, edited in the back office.
 */
export function sessionRules(arriveEarlyMinutes: number, noShowHoldMinutes: number): string[] {
  return [
    `Please arrive ${arriveEarlyMinutes} minutes before your session starts, so you can check in and get set up.`,
    "Your session starts and ends at the time you booked. Arriving late does not extend it: your time is counted from the booked start.",
    `We hold your spot for ${noShowHoldMinutes} minutes after the start time. After that it may be given to someone else.`,
  ];
}

export function SessionRules({ arriveEarlyMinutes, noShowHoldMinutes, className = "" }: { arriveEarlyMinutes: number; noShowHoldMinutes: number; className?: string }) {
  return (
    <div className={`rounded-xl border border-flag/40 bg-flag/5 p-4 text-sm text-ink-600 ${className}`}>
      <p className="display text-ink-950">Before you arrive</p>
      <ul className="mt-2 space-y-1.5">
        {sessionRules(arriveEarlyMinutes, noShowHoldMinutes).map((rule) => (
          <li key={rule} className="flex gap-2">
            <span aria-hidden className="text-flag">
              ›
            </span>
            {rule}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * The owner's "super clear" notice before a booking is finished (D100): the arrive-early minutes
 * from the back office, in big capitals on a lime band, right above the button that completes it.
 */
export function ArriveEarlyNotice({ minutes }: { minutes: number }) {
  return (
    <div role="note" className="rounded-xl bg-flag px-5 py-5 text-center text-on-flag shadow-[0_6px_24px_-10px_var(--color-flag)]">
      <p className="display text-xl leading-tight sm:text-2xl">
        Please come {minutes} minutes before your booking time to choose cars, tracks and games
      </p>
    </div>
  );
}
