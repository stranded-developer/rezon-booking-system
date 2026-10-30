"use client";

import { useEffect, useState } from "react";
import { elapsed, money, timeIn } from "@/lib/format";
import type { CounterPackage, FloorTile } from "@/lib/types";
import { CloseDialog } from "./close-dialog";
import { PackageDialog } from "./package-dialog";
import { usePos } from "./pos-provider";
import { Button, ErrorNote, Field, Input, Modal } from "./ui";

export function TileDialog({
  tile,
  now,
  hasShift,
  startClosing = false,
  onClose,
  onChanged,
}: {
  tile: FloorTile;
  now: number;
  hasShift: boolean;
  /** Open straight into the close screen (from the time-up alert). */
  startClosing?: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { api, operator, config, reloadConfig } = usePos();
  // Packages changed in the back office show up without reloading the till (D115).
  useEffect(() => reloadConfig(), [reloadConfig]);
  const tz = config?.timeZone ?? "Australia/Sydney";
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [closing, setClosing] = useState(startClosing);
  const [voiding, setVoiding] = useState(false);
  const [voidReason, setVoidReason] = useState("");
  const [selling, setSelling] = useState<CounterPackage | null>(null);
  // D115: the packages for this kind of table, paid now or at the end (D116).
  const typeId = config?.resourceTypes.find((t) => t.key === tile.typeKey)?.id;
  const packages = (config?.packages ?? []).filter((p) => p.resourceTypeId === typeId);

  /** Runs an action; if it returns a notice the dialog stays open to show it, otherwise it closes. */
  async function run(action: () => Promise<string | void | unknown>) {
    setBusy(true);
    setError(null);
    try {
      const note = await action();
      onChanged();
      if (typeof note === "string") setNotice(note);
      else onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  if (closing && tile.session) {
    return (
      <CloseDialog
        sessionId={tile.session.id}
        title={tile.label}
        hasShift={hasShift}
        onCancel={() => setClosing(false)}
        onDone={() => {
          onChanged();
          onClose();
        }}
      />
    );
  }

  if (selling) {
    return (
      <PackageDialog
        resourceId={tile.resourceId}
        title={tile.label}
        pkg={selling}
        hasShift={hasShift}
        onCancel={() => setSelling(null)}
        onDone={() => {
          onChanged();
          onClose();
        }}
      />
    );
  }

  const booking = tile.currentBooking ?? (tile.minutesToNextBooking !== null && tile.minutesToNextBooking <= 15 ? tile.nextBooking : null);
  const noShowReady = tile.noShowAvailableAt ? now >= Date.parse(tile.noShowAvailableAt) : false;

  return (
    <Modal title={tile.label} onClose={onClose}>
      <div className="space-y-4">
        <p className="text-sm text-ink-400">{tile.typeName}</p>

        {tile.session ? (
          <div className="rounded-xl bg-ink-850 p-4">
            <div className="tnum text-4xl font-semibold">{elapsed(now - Date.parse(tile.session.openedAt))}</div>
            <div className="mt-1 text-sm text-ink-400">
              {tile.session.packageName ? `${tile.session.packageName} (${tile.session.packagePayAtEnd ? "pay at the end" : "paid"})` : tile.session.kind === "walk_in" ? "Walk-in" : "Booking"} opened{" "}
              {timeIn(tile.session.openedAt, tz)} by {tile.session.openedBy}
              {tile.session.bookingEndsAt ? ` · ${tile.session.packageName ? "until" : "booked until"} ${timeIn(tile.session.bookingEndsAt, tz)}` : ""}
            </div>
          </div>
        ) : null}

        {!tile.session && booking ? (
          <div className="rounded-xl bg-ink-850 p-4 text-sm">
            <div className="font-semibold">{booking.customerName}</div>
            <div className="text-ink-400">
              Booking {booking.ref} · {timeIn(booking.startsAt, tz)}–{timeIn(booking.endsAt, tz)}
            </div>
          </div>
        ) : null}

        {tile.nextBooking && !booking ? (
          <p className="text-sm text-ink-200">
            Next booking {timeIn(tile.nextBooking.startsAt, tz)} ({tile.minutesToNextBooking} min) · {tile.nextBooking.customerName}
          </p>
        ) : null}

        {notice ? <p className="rounded-lg bg-amber-400/10 px-3 py-2 text-sm text-amber-200">{notice}</p> : null}
        <ErrorNote error={error} />

        <div className="flex flex-wrap gap-2">
          {tile.session ? (
            <Button variant="primary" size="lg" className="flex-1" onClick={() => setClosing(true)}>
              Close & pay
            </Button>
          ) : null}

          {!tile.session && tile.state === "free" && !notice ? (
            <Button
              variant="primary"
              size="lg"
              className="flex-1"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  const r = await api<{ warning: string | null; nextBooking: { startsAt: string } | null }>("/pos/sessions", {
                    body: { resourceId: tile.resourceId },
                  });
                  if (r.warning && r.nextBooking) {
                    return `Walk-in started. This table is booked from ${timeIn(r.nextBooking.startsAt, tz)} — let the customer know.`;
                  }
                })
              }
            >
              {packages.length > 0 ? "Open time (pay at the end)" : "Start walk-in"}
            </Button>
          ) : null}
        </div>

        {!tile.session && tile.state === "free" && !notice && packages.length > 0 ? (
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-ink-400">Or a package</p>
            <div className="mt-2 grid grid-cols-3 gap-2">
              {packages.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setSelling(p)}
                  className="rounded-xl bg-ink-850 p-3 text-left ring-2 ring-ink-700 hover:ring-flag"
                  data-testid="package-option"
                >
                  <div className="font-semibold">{p.name}</div>
                  <div className="text-sm text-ink-400">from {money(p.priceCents)}</div>
                </button>
              ))}
            </div>
          </div>
        ) : null}

        <div className="flex flex-wrap gap-2">

          {!tile.session && booking ? (
            <>
              <Button
                variant="primary"
                size="lg"
                className="flex-1"
                disabled={busy}
                onClick={() => void run(() => api(`/pos/bookings/${booking.id}/arrive`, { body: {} }))}
              >
                Check in {booking.customerName.split(" ")[0]}
              </Button>
              {tile.currentBooking ? (
                <Button
                  size="lg"
                  disabled={busy || !noShowReady}
                  title={noShowReady ? undefined : `Available from ${timeIn(tile.noShowAvailableAt!, tz)}`}
                  onClick={() => void run(() => api(`/pos/bookings/${booking.id}/no-show`, { body: {} }))}
                >
                  No-show{!noShowReady && tile.noShowAvailableAt ? ` (${timeIn(tile.noShowAvailableAt, tz)})` : ""}
                </Button>
              ) : null}
            </>
          ) : null}
        </div>

        {tile.session?.kind === "walk_in" && operator?.role === "superadmin" ? (
          <div className="border-t border-ink-800 pt-4">
            {!voiding ? (
              <Button variant="danger" size="sm" onClick={() => setVoiding(true)}>
                Void this session
              </Button>
            ) : (
              <div className="space-y-3">
                <Field label="Reason for voiding">
                  <Input value={voidReason} onChange={(e) => setVoidReason(e.target.value)} placeholder="Opened on the wrong table" autoFocus />
                </Field>
                <Button
                  variant="danger"
                  disabled={busy || voidReason.trim().length < 3}
                  onClick={() => void run(() => api(`/pos/sessions/${tile.session!.id}/void`, { body: { reason: voidReason.trim() } }))}
                >
                  Confirm void
                </Button>
              </div>
            )}
          </div>
        ) : null}
      </div>
    </Modal>
  );
}
