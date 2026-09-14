"use client";

import { useEffect, useState } from "react";
import { money, timeIn } from "@/lib/format";
import type { TodayBooking } from "@/lib/types";
import { usePos } from "./pos-provider";
import { Button, ErrorNote, Input, Modal } from "./ui";

const STATUS_STYLE: Record<string, string> = {
  confirmed: "text-amber-300",
  arrived: "text-sky-300",
  completed: "text-emerald-300",
  no_show: "text-red-300",
  cancelled: "text-ink-400",
};

export function BookingsDialog({ now, onClose, onChanged }: { now: number; onClose: () => void; onChanged: () => void }) {
  const { api, config } = usePos();
  const tz = config?.timeZone ?? "Australia/Sydney";
  const holdMs = (config?.noShowHoldMinutes ?? 15) * 60_000;
  const [bookings, setBookings] = useState<TodayBooking[] | null>(null);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      api<{ bookings: TodayBooking[] }>(`/pos/bookings/today?q=${encodeURIComponent(query)}`)
        .then((r) => !cancelled && setBookings(r.bookings))
        .catch((err: unknown) => !cancelled && setError(err instanceof Error ? err.message : "Could not load bookings"));
    }, 200);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [api, query, version]);

  async function act(id: string, action: "arrive" | "no-show") {
    setBusyId(id);
    setError(null);
    try {
      await api(`/pos/bookings/${id}/${action}`, { body: {} });
      onChanged();
      setVersion((v) => v + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update the booking");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Modal title="Today's bookings" onClose={onClose} wide>
      <div className="space-y-4">
        <Input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search name, phone, email or booking ref" className="w-full" />
        <ErrorNote error={error} />
        {bookings === null ? <p className="text-ink-400">Loading…</p> : null}
        {bookings?.length === 0 ? <p className="text-ink-400">No bookings today.</p> : null}
        <ul className="divide-y divide-ink-800">
          {bookings?.map((b) => {
            const start = Date.parse(b.startsAt);
            const end = Date.parse(b.endsAt);
            const canArrive = b.status === "confirmed" && now >= start - 15 * 60_000 && now < end;
            const canNoShow = b.status === "confirmed" && now >= start + holdMs;
            return (
              <li key={b.id} className="flex flex-wrap items-center gap-3 py-3">
                <div className="tnum w-24 text-sm font-semibold">
                  {timeIn(b.startsAt, tz)}–{timeIn(b.endsAt, tz)}
                </div>
                <div className="min-w-40 flex-1">
                  <div className="font-medium">
                    {b.customerName} <span className="text-xs text-ink-400">{b.ref}</span>
                  </div>
                  <div className="text-xs text-ink-400">
                    {b.resource} · {b.phone ?? b.email} · paid {money(b.totalCents)}
                    {b.memberId ? " · member" : ""}
                  </div>
                </div>
                <span className={`text-xs font-semibold uppercase ${STATUS_STYLE[b.status] ?? ""}`}>{b.status.replace("_", " ")}</span>
                {canArrive ? (
                  <Button size="sm" variant="primary" disabled={busyId === b.id} onClick={() => void act(b.id, "arrive")}>
                    Check in
                  </Button>
                ) : null}
                {canNoShow ? (
                  <Button size="sm" variant="danger" disabled={busyId === b.id} onClick={() => void act(b.id, "no-show")}>
                    No-show
                  </Button>
                ) : null}
              </li>
            );
          })}
        </ul>
      </div>
    </Modal>
  );
}
