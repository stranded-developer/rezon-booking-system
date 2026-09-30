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
