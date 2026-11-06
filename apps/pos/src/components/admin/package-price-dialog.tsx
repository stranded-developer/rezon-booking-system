"use client";

import { useState } from "react";
import { DaysPicker, useAction } from "@/components/admin/kit";
import { usePos } from "@/components/pos-provider";
import { Button, ErrorNote, Field, Input, Modal } from "@/components/ui";
import { centsToInput, money, parseDollars } from "@/lib/format";

/** A package's promotional price (D66), as the admin API returns it. */
export interface PackagePromo {
  id: string;
  experience_id: string;
  name: string;
  days_of_week: number[];
  start_time: string;
  end_time: string;
  price_cents: number;
  claimed: boolean;
  active: boolean;
}

/**
 * Change a package's promotional price — its days, times and price (D117).
 *
 * Each package has its own Happy Hour, so changing the days on one used to leave the others as
 * they were. "Every package" (on by default) gives every package's price of the same name the same
 * days and times; each keeps its own price.
 */
export function PackagePriceDialog({
  promo,
  packageName,
  listPriceCents,
  siblings,
  onClose,
  onSaved,
}: {
  promo: PackagePromo;
  packageName: string;
  listPriceCents: number;
  /** The other packages' prices with the same name and kind, e.g. every other Happy Hour. */
  siblings: PackagePromo[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { api } = usePos();
  const action = useAction();
  const [days, setDays] = useState<number[]>(promo.days_of_week);
  const [start, setStart] = useState(promo.start_time.slice(0, 5));
  const [end, setEnd] = useState(promo.end_time.slice(0, 5));
  const [price, setPrice] = useState(centsToInput(promo.price_cents));
  const [everyPackage, setEveryPackage] = useState(siblings.length > 0);
  const [reason, setReason] = useState("");
  const priceCents = parseDollars(price);

  return (
    <Modal title={`${promo.name} — ${packageName}`} onClose={onClose}>
      <div className="space-y-4">
        <Field label="Days">
          <DaysPicker value={days} onChange={setDays} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Start time">
            <Input value={start} onChange={(e) => setStart(e.target.value)} placeholder="12:00" />
          </Field>
          <Field label="End time" hint="24:00 means midnight">
            <Input value={end} onChange={(e) => setEnd(e.target.value)} placeholder="15:00" />
          </Field>
        </div>
        <Field label={`${packageName} price (incl. GST)`} hint={`Normally ${money(listPriceCents)}`}>
          <Input inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} />
        </Field>
        {siblings.length > 0 ? (
          <label className="flex items-start gap-3 text-sm">
            <input type="checkbox" className="mt-1 size-4" checked={everyPackage} onChange={(e) => setEveryPackage(e.target.checked)} />
            <span>
              Use these days and times for every package&apos;s {promo.name}
              <span className="block text-ink-400">
                {siblings.length} more {siblings.length === 1 ? "package" : "packages"}. Each keeps its own price.
              </span>
            </span>
          </label>
        ) : null}
        <Field label="Reason (optional)">
          <Input value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
        <ErrorNote error={action.error} />
        <Button
          variant="primary"
          className="w-full"
          disabled={action.busy || priceCents === null || days.length === 0}
          onClick={() =>
            void action.run(async () => {
              const when = { daysOfWeek: days, startTime: start, endTime: end, ...(reason.trim() ? { reason: reason.trim() } : {}) };
              await api(`/admin/experience-promos/${promo.id}`, { method: "PATCH", body: { ...when, priceCents } });
              if (everyPackage) {
                for (const s of siblings) await api(`/admin/experience-promos/${s.id}`, { method: "PATCH", body: when });
              }
              onSaved();
            })
          }
        >
          Save
        </Button>
      </div>
    </Modal>
  );
}
