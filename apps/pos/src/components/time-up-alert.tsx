"use client";

import { useState } from "react";
import { timeIn } from "@/lib/format";
import type { Floor, FloorTile } from "@/lib/types";
import { Button } from "./ui";

const SNOOZE_MS = 2 * 60_000;

export interface TimeUpItem {
  tile: FloorTile;
  reason: "booking_ended" | "venue_closed";
}

/** Tables whose booking has ended, or any open table after closing time. */
export function timeUpItems(floor: Floor | null, now: number): TimeUpItem[] {
  if (!floor) return [];
  const closed = floor.closesAt !== null && now >= Date.parse(floor.closesAt);
  return floor.tiles.flatMap((tile): TimeUpItem[] => {
    if (!tile.session) return [];
    if (tile.session.bookingEndsAt && now >= Date.parse(tile.session.bookingEndsAt)) return [{ tile, reason: "booking_ended" }];
    if (closed) return [{ tile, reason: "venue_closed" }];
    return [];
  });
}

/**
 * Pops up over the floor when time is up, so the cashier asks the customer to finish and closes the table.
 * Booked customers are never charged for running over (D48); the alert is how overstays are handled.
 */
export function TimeUpAlert({
  floor,
  now,
  tz,
  onCloseTable,
}: {
  floor: Floor | null;
  now: number;
  tz: string;
  onCloseTable: (resourceId: string) => void;
}) {
  const [snoozedUntil, setSnoozedUntil] = useState<Record<string, number>>({});
  const items = timeUpItems(floor, now).filter((i) => (snoozedUntil[i.tile.session!.id] ?? 0) <= now);
  if (items.length === 0) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" role="alertdialog" aria-modal="true" aria-labelledby="time-up-title">
      <div className="w-full max-w-lg rounded-2xl bg-ink-900 p-6 shadow-2xl ring-2 ring-red-500">
        <h2 id="time-up-title" className="text-xl font-bold text-red-300">
          {items.length === 1 ? `${items[0]!.tile.label} — time is up` : `${items.length} tables — time is up`}
        </h2>
        <ul className="mt-4 space-y-3">
          {items.map(({ tile, reason }) => {
            const overBy = tile.session!.bookingEndsAt ? Math.floor((now - Date.parse(tile.session!.bookingEndsAt)) / 60_000) : null;
            return (
              <li key={tile.resourceId} className="rounded-xl bg-ink-850 p-4">
                <div className="font-semibold">{tile.label}</div>
                <p className="mt-1 text-sm text-ink-200">
                  {reason === "booking_ended"
                    ? `Booking ended at ${timeIn(tile.session!.bookingEndsAt!, tz)}${overBy ? ` (${overBy} min ago)` : ""}. Ask the customer to finish and close the table.`
                    : `The venue closed at ${timeIn(floor!.closesAt!, tz)}. Close this table.`}
                </p>
                <div className="mt-3 flex gap-2">
                  <Button variant="primary" onClick={() => onCloseTable(tile.resourceId)}>
                    Close {tile.label}
                  </Button>
                  <Button onClick={() => setSnoozedUntil((s) => ({ ...s, [tile.session!.id]: now + SNOOZE_MS }))}>Remind me in 2 min</Button>
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
