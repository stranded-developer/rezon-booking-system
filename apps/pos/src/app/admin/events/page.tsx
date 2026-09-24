"use client";

import { useState } from "react";
import { Badge, Card, PageHeader, Table, Td, useAction, useApiData } from "@/components/admin/kit";
import { usePos } from "@/components/pos-provider";
import { Button, ErrorNote, Field, Input, Modal } from "@/components/ui";

/** What's on: the pop-up and the banner on the public site (D69). */

interface SiteEvent {
  id: string;
  title: string;
  body: string | null;
  detail: string | null;
  cta_label: string | null;
  cta_url: string | null;
  show_from: string | null;
  show_until: string | null;
  as_popup: boolean;
  as_banner: boolean;
  active: boolean;
  sort: number;
}

const TZ = "Australia/Sydney";
const venueWhen = (iso: string) =>
  new Intl.DateTimeFormat("en-AU", { timeZone: TZ, day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: true }).format(new Date(iso)).replace(/,/g, "");

function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false })
    .formatToParts(new Date(iso))
    .reduce<Record<string, string>>((acc, p) => ({ ...acc, [p.type]: p.value }), {});
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour === "24" ? "00" : parts.hour}:${parts.minute}`;
}

/** Venue wall-clock time → an instant, using the venue's offset rather than the browser's. */
function fromLocalInput(value: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!m) return null;
  const [, y, mo, d, h, mi] = m;
  const asUtc = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi));
  let guess = asUtc;
  for (let i = 0; i < 2; i++) {
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false })
      .formatToParts(new Date(guess))
      .reduce<Record<string, string>>((acc, p) => ({ ...acc, [p.type]: p.value }), {});
    const shown = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour) % 24, Number(parts.minute));
    guess += asUtc - shown;
  }
  return new Date(guess).toISOString();
}

export default function EventsPage() {
  const events = useApiData<{ events: SiteEvent[] }>("/admin/site-events");
  const [editing, setEditing] = useState<SiteEvent | null>(null);
  const [adding, setAdding] = useState(false);
  const [showOff, setShowOff] = useState(false);
  const { api } = usePos();
  const action = useAction();
  const rows = (events.data?.events ?? []).filter((e) => showOff || e.active);

  return (
    <>
      <PageHeader
        title="What's on"
        description="A pop-up on the home page and a banner across the top of the website. Visitors can close each one, and it stays closed for them."
        actions={
          <div className="flex gap-2">
            <Button variant={showOff ? "primary" : "secondary"} onClick={() => setShowOff((v) => !v)}>
              {showOff ? "Showing hidden" : "Show hidden"}
            </Button>
            <Button onClick={() => setAdding(true)}>Add event</Button>
          </div>
        }
      />
      <ErrorNote error={events.error ?? action.error} />

      <Card>
        <Table head={["Title", "Highlight", "Button", "Shows", "Where", "", ""]} empty={events.data !== null && rows.length === 0}>
          {rows.map((e) => (
            <tr key={e.id}>
              <Td className="font-medium">{e.title}</Td>
              <Td className="text-ink-400">{e.detail ?? "—"}</Td>
              <Td className="text-ink-400">{e.cta_label ?? "—"}</Td>
              <Td className="text-ink-400">
                {e.show_from || e.show_until ? `${e.show_from ? venueWhen(e.show_from) : "now"} – ${e.show_until ? venueWhen(e.show_until) : "no end"}` : "Always"}
              </Td>
              <Td>
                <div className="flex gap-1">
                  {e.as_popup ? <Badge tone="blue">Pop-up</Badge> : null}
                  {e.as_banner ? <Badge tone="blue">Banner</Badge> : null}
                  {!e.as_popup && !e.as_banner ? <span className="text-ink-400">Nowhere</span> : null}
                </div>
              </Td>
              <Td>{e.active ? <Badge tone="green">On</Badge> : <Badge tone="grey">Off</Badge>}</Td>
              <Td>
                <div className="flex gap-1">
                  <Button size="sm" variant="ghost" onClick={() => setEditing(e)}>
                    Edit
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={action.busy}
                    onClick={() => void action.run(async () => (await api(`/admin/site-events/${e.id}`, { method: "PATCH", body: { active: !e.active } }), events.reload()))}
                  >
                    {e.active ? "Turn off" : "Turn on"}
                  </Button>
                </div>
              </Td>
            </tr>
          ))}
        </Table>
        <p className="mt-3 text-sm text-ink-400">
          The pop-up appears on the home page only. Somewhere a visitor went on purpose — the booking panel, a tournament sign-up — it would be in the way.
        </p>
      </Card>

      {(adding || editing) && (
        <EventDialog
          event={editing ?? undefined}
          onClose={() => {
            setAdding(false);
            setEditing(null);
          }}
          onSaved={() => {
            setAdding(false);
            setEditing(null);
            events.reload();
          }}
        />
      )}
    </>
  );
}

function EventDialog({ event, onClose, onSaved }: { event?: SiteEvent; onClose: () => void; onSaved: () => void }) {
  const { api } = usePos();
  const action = useAction();
  const [title, setTitle] = useState(event?.title ?? "");
  const [body, setBody] = useState(event?.body ?? "");
  const [detail, setDetail] = useState(event?.detail ?? "");
  const [ctaLabel, setCtaLabel] = useState(event?.cta_label ?? "");
  const [ctaUrl, setCtaUrl] = useState(event?.cta_url ?? "");
  const [from, setFrom] = useState(toLocalInput(event?.show_from ?? null));
  const [until, setUntil] = useState(toLocalInput(event?.show_until ?? null));
  const [asPopup, setAsPopup] = useState(event?.as_popup ?? true);
  const [asBanner, setAsBanner] = useState(event?.as_banner ?? true);
  const [reason, setReason] = useState("");

  const ctaPaired = (ctaLabel.trim() === "") === (ctaUrl.trim() === "");
  const datesOk = !from || !until || from < until;

  return (
    <Modal title={event ? `Edit ${event.title}` : "Add event"} onClose={onClose}>
      <div className="space-y-4">
        <Field label="Title">
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Sydney Race of Champions" />
        </Field>
        <Field label="Highlight (optional)" hint="The big line in the pop-up, e.g. $2,000 cash prize pool">
          <Input value={detail} onChange={(e) => setDetail(e.target.value)} />
        </Field>
        <Field label="Description (optional)">
          <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={3} className="w-full rounded-lg bg-ink-900 p-3 text-sm ring-1 ring-ink-700" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Button label (optional)">
            <Input value={ctaLabel} onChange={(e) => setCtaLabel(e.target.value)} placeholder="Enter now" />
          </Field>
          <Field label="Button goes to">
            <Input value={ctaUrl} onChange={(e) => setCtaUrl(e.target.value)} placeholder="/tournaments" />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Show from (optional)" hint="Sydney time. Leave empty to start now.">
            <Input type="datetime-local" value={from} onChange={(e) => setFrom(e.target.value)} />
          </Field>
          <Field label="Show until (optional)" hint="Leave empty for no end.">
            <Input type="datetime-local" value={until} onChange={(e) => setUntil(e.target.value)} />
          </Field>
        </div>
        <div className="space-y-2">
          <label className="flex items-center gap-3 text-sm">
            <input type="checkbox" className="size-4" checked={asPopup} onChange={(e) => setAsPopup(e.target.checked)} />
            Show as a pop-up on the home page
          </label>
          <label className="flex items-center gap-3 text-sm">
            <input type="checkbox" className="size-4" checked={asBanner} onChange={(e) => setAsBanner(e.target.checked)} />
            Show as a banner across every page
          </label>
        </div>
        <Field label="Reason (optional)">
          <Input value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>

        <ErrorNote error={action.error} />
        {!ctaPaired ? <p className="text-sm text-amber-300">A button needs both a label and a link, or neither.</p> : null}
        {!datesOk ? <p className="text-sm text-amber-300">The end has to be after the start.</p> : null}

        <Button
          variant="primary"
          className="w-full"
          disabled={action.busy || !title.trim() || !ctaPaired || !datesOk}
          onClick={() =>
            void action.run(async () => {
              const payload = {
                title: title.trim(),
                body: body.trim(),
                detail: detail.trim(),
                ctaLabel: ctaLabel.trim(),
                ctaUrl: ctaUrl.trim(),
                showFrom: from ? fromLocalInput(from) : null,
                showUntil: until ? fromLocalInput(until) : null,
                asPopup,
                asBanner,
                ...(reason.trim() ? { reason: reason.trim() } : {}),
              };
              if (event) await api(`/admin/site-events/${event.id}`, { method: "PATCH", body: payload });
              else await api("/admin/site-events", { body: payload });
              onSaved();
            })
          }
        >
          {event ? "Save event" : "Add event"}
        </Button>
      </div>
    </Modal>
  );
}
