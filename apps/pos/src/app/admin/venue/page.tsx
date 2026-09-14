"use client";

import { useState } from "react";
import { Card, DAY_NAMES, PageHeader, useAction, useApiData } from "@/components/admin/kit";
import { usePos } from "@/components/pos-provider";
import { Button, ErrorNote, Field, Input } from "@/components/ui";
import { centsToInput, parseDollars } from "@/lib/format";

interface Settings {
  business_name: string | null;
  abn: string | null;
  booking_window_days: number;
  online_cutoff_minutes: number;
  no_show_hold_minutes: number;
  walkin_last_open_minutes: number;
  cash_variance_threshold_cents: number;
  balance_forfeit_days: number;
}
interface Day {
  day_of_week: number;
  open_time: string;
  close_time: string;
  closed: boolean;
}

export default function VenuePage() {
  const settings = useApiData<{ settings: Settings }>("/admin/settings");
  const hours = useApiData<{ days: Day[] }>("/admin/opening-hours");
  return (
    <>
      <PageHeader title="Venue & hours" description="Business details for receipts and tax invoices, opening hours and booking rules." />
      <ErrorNote error={settings.error ?? hours.error} />
      <div className="grid gap-6 lg:grid-cols-2">
        {settings.data ? <SettingsForm key={JSON.stringify(settings.data.settings)} settings={settings.data.settings} onSaved={settings.reload} /> : null}
        {hours.data ? <HoursForm key={JSON.stringify(hours.data.days)} days={hours.data.days} onSaved={hours.reload} /> : null}
      </div>
    </>
  );
}

function SettingsForm({ settings, onSaved }: { settings: Settings; onSaved: () => void }) {
  const { api } = usePos();
  const action = useAction();
  const [done, setDone] = useState(false);
  const [f, setF] = useState({
    businessName: settings.business_name ?? "",
    abn: settings.abn ?? "",
    bookingWindowDays: String(settings.booking_window_days),
    onlineCutoffMinutes: String(settings.online_cutoff_minutes),
    noShowHoldMinutes: String(settings.no_show_hold_minutes),
    walkinLastOpenMinutes: String(settings.walkin_last_open_minutes),
    variance: centsToInput(settings.cash_variance_threshold_cents),
    balanceForfeitDays: String(settings.balance_forfeit_days),
  });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => {
    setDone(false);
    setF((x) => ({ ...x, [k]: e.target.value }));
  };
  const int = (v: string) => (/^\d+$/.test(v) ? Number(v) : null);
  const numbers = [f.bookingWindowDays, f.onlineCutoffMinutes, f.noShowHoldMinutes, f.walkinLastOpenMinutes, f.balanceForfeitDays].map(int);
  const variance = parseDollars(f.variance);

  return (
    <Card title="Business and booking rules">
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Business name" hint="Printed on receipts">
            <Input value={f.businessName} onChange={set("businessName")} />
          </Field>
          <Field label="ABN" hint="Required on tax invoices">
            <Input value={f.abn} onChange={set("abn")} placeholder="12 345 678 901" />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Book ahead (days)">
            <Input inputMode="numeric" value={f.bookingWindowDays} onChange={set("bookingWindowDays")} />
          </Field>
          <Field label="Online cutoff (min before start)">
            <Input inputMode="numeric" value={f.onlineCutoffMinutes} onChange={set("onlineCutoffMinutes")} />
          </Field>
          <Field label="No-show hold (min)">
            <Input inputMode="numeric" value={f.noShowHoldMinutes} onChange={set("noShowHoldMinutes")} />
          </Field>
          <Field label="Last walk-in (min before close)">
            <Input inputMode="numeric" value={f.walkinLastOpenMinutes} onChange={set("walkinLastOpenMinutes")} />
          </Field>
          <Field label="Flag till differences over">
            <Input inputMode="decimal" value={f.variance} onChange={set("variance")} />
          </Field>
          <Field label="Forfeit balance after (days ended)">
            <Input inputMode="numeric" value={f.balanceForfeitDays} onChange={set("balanceForfeitDays")} />
          </Field>
        </div>
        <ErrorNote error={action.error} />
        <Button
          variant="primary"
          className="w-full"
          disabled={action.busy || numbers.some((n) => n === null) || variance === null}
          onClick={() =>
            void action.run(async () => {
              await api("/admin/settings", {
                method: "PATCH",
                body: {
                  businessName: f.businessName.trim() || null,
                  abn: f.abn.trim() || null,
                  bookingWindowDays: numbers[0],
                  onlineCutoffMinutes: numbers[1],
                  noShowHoldMinutes: numbers[2],
                  walkinLastOpenMinutes: numbers[3],
                  balanceForfeitDays: numbers[4],
                  cashVarianceThresholdCents: variance,
                },
              });
              setDone(true);
              onSaved();
            })
          }
        >
          Save settings
        </Button>
        {done ? <p className="text-sm text-emerald-300">Saved.</p> : null}
      </div>
    </Card>
  );
}

function HoursForm({ days, onSaved }: { days: Day[]; onSaved: () => void }) {
  const { api } = usePos();
  const action = useAction();
  const [rows, setRows] = useState(days);
  const [done, setDone] = useState(false);
  const update = (day: number, patch: Partial<Day>) => {
    setDone(false);
    setRows((r) => r.map((d) => (d.day_of_week === day ? { ...d, ...patch } : d)));
  };

  return (
    <Card title="Opening hours">
      <div className="space-y-2">
        {rows.map((d) => (
          <div key={d.day_of_week} className="grid grid-cols-[3rem_1fr_1fr_auto] items-center gap-2">
            <span className="text-sm font-medium">{DAY_NAMES[d.day_of_week - 1]}</span>
            <Input type="time" aria-label={`${DAY_NAMES[d.day_of_week - 1]} opens`} value={d.open_time} disabled={d.closed} onChange={(e) => update(d.day_of_week, { open_time: e.target.value })} />
            <Input type="time" aria-label={`${DAY_NAMES[d.day_of_week - 1]} closes`} value={d.close_time} disabled={d.closed} onChange={(e) => update(d.day_of_week, { close_time: e.target.value })} />
            <label className="flex items-center gap-2 text-sm text-ink-200">
              <input type="checkbox" checked={d.closed} onChange={(e) => update(d.day_of_week, { closed: e.target.checked })} />
              Closed
            </label>
          </div>
        ))}
        <ErrorNote error={action.error} />
        <Button
          variant="primary"
          className="mt-2 w-full"
          disabled={action.busy}
          onClick={() =>
            void action.run(async () => {
              await api("/admin/opening-hours", {
                method: "PUT",
                body: { days: rows.map((d) => ({ dayOfWeek: d.day_of_week, openTime: d.open_time, closeTime: d.close_time, closed: d.closed })) },
              });
              setDone(true);
              onSaved();
            })
          }
        >
          Save opening hours
        </Button>
        {done ? <p className="text-sm text-emerald-300">Saved.</p> : null}
      </div>
    </Card>
  );
}
