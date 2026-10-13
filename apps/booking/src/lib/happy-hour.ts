import type { Experience, ExperiencePromo } from "./types";

const SHORT_DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

/**
 * The price an experience drops to by itself at certain hours, e.g. Happy Hour (D98). A price the
 * customer has to ask for (a student price) is not one of these. Where two overlap, the cheapest
 * wins, as in the pricing engine (D66), so the cheapest is the one to show.
 */
export function happyHourOf(exp: Experience): ExperiencePromo | null {
  const own = exp.promos.filter((p) => !p.claimed && p.priceCents < exp.priceCents);
  return own.reduce<ExperiencePromo | null>((best, p) => (best === null || p.priceCents < best.priceCents ? p : best), null);
}

/** ISO days 1–7 → "every day", or "Mon, Tue, Wed". */
export function formatDays(days: number[]): string {
  if (new Set(days).size === 7) return "every day";
  return [...days].sort((a, b) => a - b).map((d) => SHORT_DAYS[d - 1]).join(", ");
}
