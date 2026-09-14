import { formatCents } from "@raceground/pricing";

export const money = (cents: number | null | undefined) => (cents === null || cents === undefined ? "—" : formatCents(cents));

/** "12", "12.5", "$12.50" → 1250. Returns null if it isn't a valid non-negative amount. */
export function parseDollars(input: string): number | null {
  const cleaned = input.trim().replace(/^\$/, "").replace(/,/g, "");
  if (!/^\d+(\.\d{0,2})?$/.test(cleaned)) return null;
  const [whole, frac = ""] = cleaned.split(".");
  return Number(whole) * 100 + Number(frac.padEnd(2, "0"));
}

export const centsToInput = (cents: number) => (cents / 100).toFixed(2);

export function timeIn(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-AU", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(iso));
}

export function clockIn(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-AU", { timeZone, weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(date);
}

export function elapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export const percent = (bp: number) => `${bp / 100}%`;
