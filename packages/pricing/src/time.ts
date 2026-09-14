import { PricingError } from "./errors.js";
import type { IsoDayOfWeek, WallTime } from "./types.js";

export const MINUTE_MS = 60_000;

export interface LocalWallClock {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  isoDayOfWeek: IsoDayOfWeek;
  /** Minutes since local midnight, 0–1439. */
  minuteOfDay: number;
  /** "YYYY-MM-DD" */
  date: string;
  /** "YYYY-MM-DD HH:MM" */
  label: string;
}

const WEEKDAYS: Record<string, IsoDayOfWeek> = {
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
  Sun: 7,
};

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    try {
      f = new Intl.DateTimeFormat("en-US", {
        timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        weekday: "short",
        hourCycle: "h23",
      });
    } catch {
      throw new PricingError(`Unknown time zone: ${timeZone}`);
    }
    formatters.set(timeZone, f);
  }
  return f;
}

const pad2 = (n: number) => String(n).padStart(2, "0");

/** Wall-clock reading of a UTC instant in the given IANA time zone. */
export function toLocal(instantMs: number, timeZone: string): LocalWallClock {
  const parts = formatterFor(timeZone).formatToParts(new Date(instantMs));
  const get = (type: Intl.DateTimeFormatPartTypes) => {
    const part = parts.find((p) => p.type === type);
    if (!part) throw new PricingError(`Missing ${type} in local time conversion`);
    return part.value;
  };
  const year = Number(get("year"));
  const month = Number(get("month"));
  const day = Number(get("day"));
  const hour = Number(get("hour"));
  const minute = Number(get("minute"));
  const isoDayOfWeek = WEEKDAYS[get("weekday")];
  if (!isoDayOfWeek) throw new PricingError("Unrecognised weekday in local time conversion");
  const date = `${year}-${pad2(month)}-${pad2(day)}`;
  return {
    year,
    month,
    day,
    hour,
    minute,
    isoDayOfWeek,
    minuteOfDay: hour * 60 + minute,
    date,
    label: `${date} ${pad2(hour)}:${pad2(minute)}`,
  };
}

const WALL_TIME = /^(?:([01]\d|2[0-3]):([0-5]\d)|(24):(00))$/;

export function isWallTime(value: string): boolean {
  return WALL_TIME.test(value);
}

/** "HH:MM" → minutes since midnight. "24:00" → 1440. */
export function parseWallTime(value: WallTime): number {
  const m = WALL_TIME.exec(value);
  if (!m) throw new PricingError(`Invalid time "${value}", expected HH:MM`);
  const hours = Number(m[1] ?? m[3]);
  const minutes = Number(m[2] ?? m[4]);
  return hours * 60 + minutes;
}

export interface Window {
  daysOfWeek: IsoDayOfWeek[];
  startTime: WallTime;
  endTime: WallTime;
}

export function windowContains(window: Window, local: LocalWallClock): boolean {
  if (!window.daysOfWeek.includes(local.isoDayOfWeek)) return false;
  const start = parseWallTime(window.startTime);
  const end = parseWallTime(window.endTime);
  return local.minuteOfDay >= start && local.minuteOfDay < end;
}

/** "YYYY-MM-DD" plus `days` (calendar arithmetic, no time zone involved). */
export function addDaysToDate(date: string, days: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) throw new PricingError(`Invalid date "${date}", expected YYYY-MM-DD`);
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + days));
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

/**
 * UTC instant for a venue-local date and wall time.
 * - Normal times: exact.
 * - Skipped times (DST start gap): the instant the clock reads the same number of minutes after the gap
 *   (e.g. 02:30 on the October change → 03:30 AEDT).
 * - Repeated times (DST end overlap): the earlier of the two instants.
 */
export function localToInstant(date: string, time: WallTime, timeZone: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) throw new PricingError(`Invalid date "${date}", expected YYYY-MM-DD`);
  const minutes = parseWallTime(time);
  const target = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 0, minutes);
  const wallAsUtc = (instant: number) => {
    const l = toLocal(instant, timeZone);
    return Date.UTC(l.year, l.month - 1, l.day, l.hour, l.minute);
  };
  // Offsets in use around the target (the zone offset can differ by DST on either side).
  const offsets = new Set<number>();
  for (const probe of [target - 86_400_000, target, target + 86_400_000]) {
    offsets.add(wallAsUtc(probe) - probe);
  }
  const candidates = [...offsets]
    .map((offset) => target - offset)
    .filter((instant) => wallAsUtc(instant) === target)
    .sort((a, b) => a - b);
  if (candidates.length > 0) return candidates[0]!;
  // In a DST gap: use the offset from before the gap, which lands after the transition.
  const before = wallAsUtc(target - 86_400_000) - (target - 86_400_000);
  return target - before;
}
