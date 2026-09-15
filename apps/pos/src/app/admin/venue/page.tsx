"use client";

import Image from "next/image";
import { useRef, useState } from "react";
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
  address: string | null;
  phone: string | null;
  contact_email: string | null;
  intro: string | null;
  instagram_url: string | null;
}
interface Photo {
  id: string;
  url: string;
  caption: string | null;
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
  const photos = useApiData<{ photos: Photo[] }>("/admin/venue-photos");
  return (
    <>
      <PageHeader title="Venue & hours" description="Business details for receipts and tax invoices, opening hours, booking rules, and what the booking website shows." />
      <ErrorNote error={settings.error ?? hours.error ?? photos.error} />
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Forms keep their own state after the first load; re-keying on data would remount them and hide "Saved." */}
        {settings.data ? <SettingsForm settings={settings.data.settings} onSaved={settings.reload} /> : null}
        {hours.data ? <HoursForm days={hours.data.days} onSaved={hours.reload} /> : null}
        {settings.data ? <WebsiteForm settings={settings.data.settings} onSaved={settings.reload} /> : null}
        {photos.data ? <PhotosCard photos={photos.data.photos} onChanged={photos.reload} /> : null}
      </div>
    </>
  );
}

function WebsiteForm({ settings, onSaved }: { settings: Settings; onSaved: () => void }) {
  const { api } = usePos();
  const action = useAction();
  const [done, setDone] = useState(false);
  const [f, setF] = useState({
    address: settings.address ?? "",
    phone: settings.phone ?? "",
    contactEmail: settings.contact_email ?? "",
    instagramUrl: settings.instagram_url ?? "",
    intro: settings.intro ?? "",
  });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => {
    setDone(false);
    setF((x) => ({ ...x, [k]: e.target.value }));
  };

  return (
    <Card title="Booking website">
      <div className="space-y-4">
        <p className="text-sm text-ink-400">Shown on the home page of the booking website. Leave a field empty to hide it.</p>
        <Field label="Address">
          <Input value={f.address} onChange={set("address")} placeholder="1 George St, Sydney NSW 2000" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Phone">
            <Input type="tel" value={f.phone} onChange={set("phone")} placeholder="02 9000 0000" />
          </Field>
          <Field label="Contact email">
            <Input type="email" value={f.contactEmail} onChange={set("contactEmail")} placeholder="hello@example.com" />
          </Field>
        </div>
        <Field label="Instagram link">
          <Input value={f.instagramUrl} onChange={set("instagramUrl")} placeholder="https://www.instagram.com/yourname" />
        </Field>
        <Field label="Intro" hint={`${f.intro.length} / 1000`}>
          <textarea
            rows={4}
            maxLength={1000}
            value={f.intro}
            onChange={set("intro")}
            placeholder="A few sentences welcoming visitors"
            className="rounded-lg bg-ink-900 px-3 py-2 text-ink-50 ring-1 ring-ink-700 placeholder:text-ink-600 focus:outline-none focus:ring-2 focus:ring-flag"
          />
        </Field>
        <ErrorNote error={action.error} />
        <Button
          variant="primary"
          className="w-full"
          disabled={action.busy}
          onClick={() =>
            void action.run(async () => {
              await api("/admin/settings", { method: "PATCH", body: { ...f, reason: "Website details" } });
              setDone(true);
              onSaved();
            })
          }
        >
          Save website details
        </Button>
        {done ? <p className="text-sm text-emerald-300">Website details saved.</p> : null}
      </div>
    </Card>
  );
}

function PhotosCard({ photos, onChanged }: { photos: Photo[]; onChanged: () => void }) {
  const { api } = usePos();
  const action = useAction();
  const fileInput = useRef<HTMLInputElement>(null);
  const [caption, setCaption] = useState("");

  const move = (index: number, by: -1 | 1) => {
    const ids = photos.map((p) => p.id);
    [ids[index], ids[index + by]] = [ids[index + by]!, ids[index]!];
    void action.run(async () => {
      await api("/admin/venue-photos/order", { method: "PUT", body: { ids } });
      onChanged();
    });
  };

  return (
    <Card title={`Website photos (${photos.length} / 12)`}>
      <div className="space-y-4">
        <div className="space-y-3 rounded-xl bg-ink-850 p-4 ring-1 ring-ink-800">
          <Field label="Photo" hint="JPEG, PNG or WebP, up to 5 MB. Landscape photos look best.">
            <input ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp" className="text-sm text-ink-200 file:mr-3 file:rounded-lg file:border-0 file:bg-ink-700 file:px-3 file:py-2 file:text-ink-50" />
          </Field>
          <Field label="Caption (optional)">
            <Input value={caption} maxLength={200} onChange={(e) => setCaption(e.target.value)} />
          </Field>
          <Button
            variant="primary"
            className="w-full"
            disabled={action.busy || photos.length >= 12}
            onClick={() =>
              void action.run(async () => {
                const file = fileInput.current?.files?.[0];
                if (!file) throw new Error("Choose a photo first");
                const form = new FormData();
                form.set("file", file);
                form.set("caption", caption);
                await api("/admin/venue-photos", { body: form });
                setCaption("");
                if (fileInput.current) fileInput.current.value = "";
                onChanged();
              })
            }
          >
            Upload photo
          </Button>
        </div>
        <ErrorNote error={action.error} />
        {photos.length === 0 ? <p className="text-sm text-ink-400">No photos yet.</p> : null}
        <ul className="space-y-3">
          {photos.map((p, i) => (
            <li key={p.id} data-testid="venue-photo" className="flex gap-3 rounded-xl bg-ink-850 p-3 ring-1 ring-ink-800">
              <Image src={p.url} alt={p.caption ?? `Photo ${i + 1}`} width={112} height={80} unoptimized className="h-20 w-28 shrink-0 rounded-lg object-cover" />
              <div className="flex min-w-0 flex-1 flex-col gap-2">
                <CaptionEditor photo={p} onSaved={onChanged} />
                <div className="flex flex-wrap gap-1">
                  <Button size="sm" variant="ghost" disabled={action.busy || i === 0} onClick={() => move(i, -1)} aria-label={`Move photo ${i + 1} up`}>
                    ↑
                  </Button>
                  <Button size="sm" variant="ghost" disabled={action.busy || i === photos.length - 1} onClick={() => move(i, 1)} aria-label={`Move photo ${i + 1} down`}>
                    ↓
                  </Button>
                  <Button
                    size="sm"
                    variant="danger"
                    className="ml-auto"
                    disabled={action.busy}
                    onClick={() => {
                      if (!window.confirm("Remove this photo from the website?")) return;
                      void action.run(async () => {
                        await api(`/admin/venue-photos/${p.id}`, { method: "DELETE" });
                        onChanged();
                      });
                    }}
                  >
                    Remove
                  </Button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </Card>
  );
}

function CaptionEditor({ photo, onSaved }: { photo: Photo; onSaved: () => void }) {
  const { api } = usePos();
  const action = useAction();
  const [value, setValue] = useState(photo.caption ?? "");
  const changed = value.trim() !== (photo.caption ?? "");
  return (
    <div className="flex gap-2">
      <Input aria-label="Caption" className="h-9 min-w-0 flex-1 text-sm" maxLength={200} value={value} placeholder="No caption" onChange={(e) => setValue(e.target.value)} />
      {changed ? (
        <Button
          size="sm"
          disabled={action.busy}
          onClick={() =>
            void action.run(async () => {
              await api(`/admin/venue-photos/${photo.id}`, { method: "PATCH", body: { caption: value } });
              onSaved();
            })
          }
        >
          Save
        </Button>
      ) : null}
    </div>
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
