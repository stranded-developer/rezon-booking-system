"use client";

import Link from "next/link";
import { useState } from "react";
import { clockIn, elapsed, money, timeIn } from "@/lib/format";
import { runningPrice } from "@/lib/pricing-preview";
import type { FloorTile, TileState } from "@/lib/types";
import { BookingsDialog } from "./bookings-dialog";
import { usePos } from "./pos-provider";
import { ShiftDialog } from "./shift-dialog";
import { TileDialog } from "./tile-dialog";
import { Button, ErrorNote } from "./ui";
import { useFloor, useNow } from "./use-floor";
import { Wordmark } from "./wordmark";

const STATE_STYLE: Record<TileState, { label: string; ring: string; dot: string }> = {
  free: { label: "Free", ring: "ring-ink-700", dot: "bg-emerald-400" },
  in_use: { label: "Walk-in", ring: "ring-sky-500/60", dot: "bg-sky-400" },
  booking: { label: "Booking", ring: "ring-indigo-400/60", dot: "bg-indigo-400" },
  awaiting_arrival: { label: "Awaiting arrival", ring: "ring-amber-400/70", dot: "bg-amber-400" },
  overdue: { label: "Overdue", ring: "ring-red-500", dot: "bg-red-500" },
};

export function MainScreen() {
  const { operator, config, lock } = usePos();
  const { floor, error, clockOffsetMs, refresh } = useFloor();
  const now = useNow(clockOffsetMs);
  const [selected, setSelected] = useState<string | null>(null);
  const [dialog, setDialog] = useState<"shift" | "bookings" | null>(null);

  const tz = config?.timeZone ?? floor?.timeZone ?? "Australia/Sydney";
  const groups = new Map<string, FloorTile[]>();
  for (const t of floor?.tiles ?? []) groups.set(t.typeName, [...(groups.get(t.typeName) ?? []), t]);
  const selectedTile = floor?.tiles.find((t) => t.resourceId === selected) ?? null;

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-30 flex flex-wrap items-center gap-3 border-b border-ink-800 bg-ink-950/95 px-5 py-3 backdrop-blur">
        <Wordmark className="text-lg" />
        <span className="tnum text-sm text-ink-400">{clockIn(new Date(now), tz)}</span>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setDialog("shift")}
            className={`h-9 rounded-full px-3 text-sm font-medium ring-1 ${floor?.shift ? "bg-emerald-400/10 text-emerald-300 ring-emerald-400/40" : "bg-red-500/10 text-red-300 ring-red-500/40"}`}
          >
            {floor?.shift ? `Till open · ${timeIn(floor.shift.openedAt, tz)}` : "No shift open"}
          </button>
          <Button size="sm" onClick={() => setDialog("bookings")}>
            Today&apos;s bookings
          </Button>
          {operator?.role === "superadmin" ? (
            <Link href="/admin" className="inline-flex h-9 items-center rounded-lg bg-ink-800 px-3 text-sm font-semibold ring-1 ring-ink-700 hover:bg-ink-700">
              Back office
            </Link>
          ) : null}
          <span className="px-2 text-sm">
            <span className="font-semibold">{operator?.displayName}</span>
            <span className="ml-1.5 text-xs uppercase text-ink-400">{operator?.role}</span>
          </span>
          <Button size="sm" variant="primary" onClick={lock}>
            Lock
          </Button>
        </div>
      </header>

      {floor?.closingSoon ? (
        <div className="bg-amber-400/15 px-5 py-2 text-sm text-amber-200">Closing at {timeIn(floor.closesAt!, tz)} — wrap up open sessions.</div>
      ) : null}

      <main className="flex-1 space-y-8 p-5">
        <ErrorNote error={error} />
        {!floor ? <p className="text-ink-400">Loading floor…</p> : null}
        {[...groups.entries()].map(([typeName, tiles]) => (
          <section key={typeName}>
            <h2 className="mb-3 text-xs font-semibold uppercase tracking-widest text-ink-400">{typeName}</h2>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(210px,1fr))] gap-3">
              {tiles.map((t) => (
                <Tile key={t.resourceId} tile={t} now={now} tz={tz} onOpen={() => setSelected(t.resourceId)} />
              ))}
            </div>
          </section>
        ))}
      </main>

      {selectedTile ? (
        <TileDialog
          tile={selectedTile}
          now={now}
          hasShift={Boolean(floor?.shift)}
          onClose={() => setSelected(null)}
          onChanged={() => void refresh()}
        />
      ) : null}
      {dialog === "shift" ? <ShiftDialog onClose={() => setDialog(null)} onChanged={() => void refresh()} /> : null}
      {dialog === "bookings" ? <BookingsDialog now={now} onClose={() => setDialog(null)} onChanged={() => void refresh()} /> : null}
    </div>
  );
}

function Tile({ tile, now, tz, onOpen }: { tile: FloorTile; now: number; tz: string; onOpen: () => void }) {
  const { config } = usePos();
  const style = STATE_STYLE[tile.state];
  const price = config ? runningPrice(tile, config, now) : null;
  return (
    <button
      type="button"
      onClick={onOpen}
      className={`flex min-h-36 flex-col rounded-2xl bg-ink-900 p-4 text-left ring-2 transition hover:bg-ink-850 ${style.ring} ${tile.state === "overdue" ? "animate-pulse" : ""}`}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="min-w-0 text-lg font-bold leading-tight">{tile.label}</span>
        <span className="flex shrink-0 items-center gap-1.5 whitespace-nowrap text-xs text-ink-200">
          <span className={`size-2 rounded-full ${style.dot}`} />
          {style.label}
        </span>
      </div>
      {tile.session ? (
        <div className="mt-3">
          <div className="tnum text-3xl font-semibold">{elapsed(now - Date.parse(tile.session.openedAt))}</div>
          <div className="mt-1 text-sm text-ink-400">
            {tile.session.bookingEndsAt ? `Booked until ${timeIn(tile.session.bookingEndsAt, tz)}` : `Since ${timeIn(tile.session.openedAt, tz)}`}
            {price !== null && price > 0 ? <span className="tnum ml-2 text-ink-200">≈ {money(price)}</span> : null}
          </div>
        </div>
      ) : tile.currentBooking ? (
        <div className="mt-3 text-sm">
          <div className="font-medium">{tile.currentBooking.customerName}</div>
          <div className="text-ink-400">
            {timeIn(tile.currentBooking.startsAt, tz)}–{timeIn(tile.currentBooking.endsAt, tz)} · {tile.currentBooking.ref}
          </div>
        </div>
      ) : null}
      <div className="mt-auto pt-3 text-xs">
        {tile.bookingWarning ? (
          <span className="font-semibold text-amber-300">Booking in {tile.minutesToNextBooking} min — wrap up</span>
        ) : tile.nextBooking ? (
          <span className="text-ink-400">
            Next {timeIn(tile.nextBooking.startsAt, tz)} · {tile.nextBooking.customerName}
          </span>
        ) : null}
      </div>
    </button>
  );
}
