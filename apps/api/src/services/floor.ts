import { addDaysToDate, localToInstant, toLocal } from "@raceground/pricing";
import type { AppDeps } from "../context.js";
import { mapDbError } from "../errors.js";
import { loadSettings, parseRange, wallTime } from "./venue.js";

export type TileState = "free" | "in_use" | "booking" | "overdue" | "awaiting_arrival";

export interface FloorBooking {
  id: string;
  ref: string;
  status: string;
  startsAt: string;
  endsAt: string;
  customerName: string;
  memberId: string | null;
}

export interface FloorTile {
  resourceId: string;
  label: string;
  typeKey: string;
  typeName: string;
  state: TileState;
  session: {
    id: string;
    kind: string;
    openedAt: string;
    openedBy: string;
    bookingId: string | null;
    bookingEndsAt: string | null;
  } | null;
  currentBooking: FloorBooking | null;
  nextBooking: FloorBooking | null;
  /** Minutes until the next booking starts (null if none today). */
  minutesToNextBooking: number | null;
  /** A walk-in is running and a booking starts within 10 minutes. */
  bookingWarning: boolean;
  noShowAvailableAt: string | null;
}

export async function venueDay(deps: AppDeps) {
  const settings = await loadSettings(deps.db);
  const now = deps.clock.now();
  const today = toLocal(now.getTime(), settings.timezone);
  const start = new Date(localToInstant(today.date, "00:00", settings.timezone));
  const end = new Date(localToInstant(addDaysToDate(today.date, 1), "00:00", settings.timezone));
  return { settings, now, today, start, end };
}

export async function getFloor(deps: AppDeps) {
  const { db } = deps;
  const { settings, now, today, start, end } = await venueDay(deps);

  const [resourcesRes, sessionsRes, bookingsRes, hoursRes, shiftRes] = await Promise.all([
    db.from("resources").select("id, label, sort, resource_types!inner(key, name, sort, active)").eq("active", true),
    db
      .from("sessions")
      .select("id, resource_id, kind, opened_at, booking_id, opener:staff!sessions_opened_by_fkey(display_name), bookings(period)")
      .eq("status", "open"),
    db
      .from("bookings")
      .select("id, ref, resource_id, status, period, member_id, customers!inner(name)")
      .in("status", ["confirmed", "arrived"])
      .overlaps("period", `[${start.toISOString()},${end.toISOString()})`),
    db.from("opening_hours").select("*").eq("day_of_week", today.isoDayOfWeek).maybeSingle(),
    db.from("shifts").select("id, opened_at, opening_float_cents, opener:staff!shifts_staff_id_fkey(display_name)").is("closed_at", null).maybeSingle(),
  ]);
  for (const r of [resourcesRes, sessionsRes, bookingsRes, hoursRes, shiftRes]) if (r.error) throw mapDbError(r.error);

  const bookings = (bookingsRes.data ?? []).map((b) => {
    const { start: s, end: e } = parseRange(b.period);
    return {
      resourceId: b.resource_id,
      booking: {
        id: b.id,
        ref: b.ref,
        status: b.status,
        startsAt: s.toISOString(),
        endsAt: e.toISOString(),
        customerName: (b.customers as { name: string }).name,
        memberId: b.member_id,
      } satisfies FloorBooking,
      start: s,
      end: e,
    };
  });

  const tiles: FloorTile[] = (resourcesRes.data ?? [])
    .filter((r) => (r.resource_types as { active: boolean }).active)
    .sort((a, b) => {
      const ta = a.resource_types as { sort: number };
      const tb = b.resource_types as { sort: number };
      return ta.sort - tb.sort || a.sort - b.sort || a.label.localeCompare(b.label);
    })
    .map((r) => {
      const type = r.resource_types as { key: string; name: string };
      const raw = (sessionsRes.data ?? []).find((s) => s.resource_id === r.id);
      const mine = bookings.filter((b) => b.resourceId === r.id).sort((a, b) => a.start.getTime() - b.start.getTime());
      const current = mine.find((b) => b.start <= now && now < b.end) ?? null;
      const next = mine.find((b) => b.start > now && b.booking.status === "confirmed") ?? null;
      const bookingEnd = raw?.bookings ? parseRange((raw.bookings as { period: unknown }).period).end : null;
      const minutesToNext = next ? Math.ceil((next.start.getTime() - now.getTime()) / 60_000) : null;

      let state: TileState = "free";
      if (raw) {
        state = raw.kind === "walk_in" ? "in_use" : bookingEnd && now > bookingEnd ? "overdue" : "booking";
      } else if (current && current.booking.status === "confirmed") {
        state = "awaiting_arrival";
      }

      return {
        resourceId: r.id,
        label: r.label,
        typeKey: type.key,
        typeName: type.name,
        state,
        session: raw
          ? {
              id: raw.id,
              kind: raw.kind,
              openedAt: raw.opened_at,
              openedBy: (raw.opener as { display_name: string } | null)?.display_name ?? "",
              bookingId: raw.booking_id,
              bookingEndsAt: bookingEnd?.toISOString() ?? null,
            }
          : null,
        currentBooking: current?.booking ?? null,
        nextBooking: next?.booking ?? null,
        minutesToNextBooking: minutesToNext,
        bookingWarning: raw?.kind === "walk_in" && minutesToNext !== null && minutesToNext <= 10,
        noShowAvailableAt:
          state === "awaiting_arrival" && current
            ? new Date(current.start.getTime() + settings.no_show_hold_minutes * 60_000).toISOString()
            : null,
      } satisfies FloorTile;
    });

  const hours = hoursRes.data;
  const closesAt = hours && !hours.closed ? new Date(localToInstant(today.date, wallTime(hours.close_time), settings.timezone)) : null;
  const shift = shiftRes.data;

  return {
    now: now.toISOString(),
    venueDate: today.date,
    timeZone: settings.timezone,
    opensAt: hours && !hours.closed ? new Date(localToInstant(today.date, wallTime(hours.open_time), settings.timezone)).toISOString() : null,
    closesAt: closesAt?.toISOString() ?? null,
    closingSoon: closesAt ? closesAt.getTime() - now.getTime() <= 15 * 60_000 : false,
    shift: shift
      ? {
          id: shift.id,
          openedAt: shift.opened_at,
          openedBy: (shift.opener as { display_name: string } | null)?.display_name ?? "",
        }
      : null,
    tiles,
  };
}

export async function todaysBookings(deps: AppDeps, query?: string) {
  const { db } = deps;
  const { start, end } = await venueDay(deps);
  const { data, error } = await db
    .from("bookings")
    .select("id, ref, status, period, member_id, total_cents, resources!inner(label), customers!inner(name, email, phone)")
    .not("status", "in", "(held,expired)")
    .overlaps("period", `[${start.toISOString()},${end.toISOString()})`);
  if (error) throw mapDbError(error);
  const q = query?.trim().toLowerCase();
  return data
    .map((b) => {
      const { start: s, end: e } = parseRange(b.period);
      const c = b.customers as { name: string; email: string | null; phone: string | null };
      return {
        id: b.id,
        ref: b.ref,
        status: b.status,
        startsAt: s.toISOString(),
        endsAt: e.toISOString(),
        resource: (b.resources as { label: string }).label,
        customerName: c.name,
        email: c.email,
        phone: c.phone,
        memberId: b.member_id,
        totalCents: b.total_cents,
      };
    })
    .filter((b) => !q || [b.ref, b.customerName, b.email ?? "", b.phone ?? ""].some((v) => v.toLowerCase().includes(q)))
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
}
