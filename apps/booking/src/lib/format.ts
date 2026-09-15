export const formatCents = (cents: number) =>
  (cents / 100).toLocaleString("en-AU", { style: "currency", currency: "AUD" });

/** "$30.00/hr" for a rate given in cents per hour. */
export const formatRate = (cents: number) => `${formatCents(cents)}/hr`;

export function formatMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} min`;
  if (m === 0) return h === 1 ? "1 hour" : `${h} hours`;
  return `${h} h ${m} min`;
}

const DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"] as const;
export const dayName = (isoDayOfWeek: number) => DAY_NAMES[isoDayOfWeek - 1] ?? "";

/** "10:00" → "10:00 am". Venue wall-clock times are shown as they are, never converted. */
export function formatWallTime(time: string): string {
  const [h = "0", m = "00"] = time.split(":");
  const hour = Number(h);
  const suffix = hour < 12 ? "am" : "pm";
  const twelve = hour % 12 === 0 ? 12 : hour % 12;
  return `${twelve}:${m} ${suffix}`;
}

/** "2030-02-11" → "Mon 11 Feb 2030", without touching the visitor's timezone. */
export function formatVenueDate(date: string, opts: { weekday?: boolean; year?: boolean } = {}): string {
  const [y, m, d] = date.split("-").map(Number);
  if (!y || !m || !d) return date;
  const at = new Date(Date.UTC(y, m - 1, d));
  return new Intl.DateTimeFormat("en-AU", {
    timeZone: "UTC",
    ...(opts.weekday === false ? {} : { weekday: "short" }),
    day: "numeric",
    month: "short",
    ...(opts.year === false ? {} : { year: "numeric" }),
  })
    .format(at)
    .replace(/,/g, "");
}

/** Venue date string ("2030-02-11") plus days, without timezone maths. */
export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const at = new Date(Date.UTC(y!, m! - 1, d! + days));
  return at.toISOString().slice(0, 10);
}

export const gstNote = (gstCents: number) => `incl. GST ${formatCents(gstCents)}`;
