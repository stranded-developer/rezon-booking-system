"use client";

import { useState } from "react";
import { Badge, Card, PageHeader, Table, Td, useAction, useApiData } from "@/components/admin/kit";
import { usePos } from "@/components/pos-provider";
import { Button, ErrorNote, Field, Input, Modal } from "@/components/ui";
import { centsToInput, money, parseDollars } from "@/lib/format";

/** Tournaments and who has signed up (D68). */

interface Tournament {
  id: string;
  name: string;
  blurb: string | null;
  starts_at: string;
  spots: number;
  entry_fee_cents: number;
  published: boolean;
  entries: number;
  spots_left: number;
}

interface Entry {
  id: string;
  ref: string;
  status: string;
  free_entry: boolean;
  total_cents: number | null;
  created_at: string;
  customers: { name: string; email: string | null; phone: string | null };
}

const TZ = "Australia/Sydney";
/** An instant → what the clock says in the venue's own timezone. */
const venueWhen = (iso: string) =>
  new Intl.DateTimeFormat("en-AU", { timeZone: TZ, weekday: "short", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: true })
    .format(new Date(iso))
    .replace(/,/g, "");

/** An instant → the value a `datetime-local` input wants, read in venue time. */
function toLocalInput(iso: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false })
    .formatToParts(new Date(iso))
    .reduce<Record<string, string>>((acc, p) => ({ ...acc, [p.type]: p.value }), {});
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour === "24" ? "00" : parts.hour}:${parts.minute}`;
}

/**
 * A `datetime-local` value is venue wall-clock time, so it is turned into an instant using the
 * venue's own offset for that date — never the browser's. A manager on holiday overseas must not
 * be able to move a tournament by an accident of where they are sitting.
 */
function fromLocalInput(value: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!m) return null;
  const [, y, mo, d, h, mi] = m;
  const asUtc = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi));
  // Two probes are enough to land on the right side of a daylight-saving change.
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

export default function TournamentsPage() {
  const tournaments = useApiData<{ tournaments: Tournament[] }>("/admin/tournaments");
  const [editing, setEditing] = useState<Tournament | null>(null);
  const [adding, setAdding] = useState(false);
  const [viewing, setViewing] = useState<Tournament | null>(null);
  const { api } = usePos();
  const action = useAction();
  const rows = tournaments.data?.tournaments ?? [];

  return (
    <>
      <PageHeader
        title="Tournaments"
        description="People sign up on the website. Nothing shows there until it is published, and a tournament disappears once it has started."
        actions={<Button onClick={() => setAdding(true)}>Add tournament</Button>}
      />
      <ErrorNote error={tournaments.error ?? action.error} />

      <Card>
        <Table head={["Tournament", "When", "Entry", "Signed up", "Spots left", "", "", ""]} empty={tournaments.data !== null && rows.length === 0}>
          {rows.map((t) => (
            <tr key={t.id}>
              <Td className="font-medium">{t.name}</Td>
              <Td>{venueWhen(t.starts_at)}</Td>
              <Td className="tnum">{t.entry_fee_cents === 0 ? "Free" : money(t.entry_fee_cents)}</Td>
              <Td className="tnum">
                {t.entries} of {t.spots}
              </Td>
              <Td className="tnum">{t.spots_left === 0 ? <Badge tone="amber">Full</Badge> : t.spots_left}</Td>
              <Td>{t.published ? <Badge tone="green">Published</Badge> : <Badge tone="grey">Draft</Badge>}</Td>
              <Td>
                <Button size="sm" variant="ghost" onClick={() => setViewing(t)}>
                  Who&apos;s in
                </Button>
              </Td>
              <Td>
                <div className="flex gap-1">
                  <Button size="sm" variant="ghost" onClick={() => setEditing(t)}>
                    Edit
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={action.busy}
                    onClick={() => void action.run(async () => (await api(`/admin/tournaments/${t.id}`, { method: "PATCH", body: { published: !t.published } }), tournaments.reload()))}
                  >
                    {t.published ? "Unpublish" : "Publish"}
                  </Button>
                </div>
              </Td>
            </tr>
          ))}
        </Table>
      </Card>

      {(adding || editing) && (
        <TournamentDialog
          tournament={editing ?? undefined}
          onClose={() => {
            setAdding(false);
            setEditing(null);
          }}
          onSaved={() => {
            setAdding(false);
            setEditing(null);
            tournaments.reload();
          }}
        />
      )}
      {viewing ? <EntriesDialog tournament={viewing} onClose={() => setViewing(null)} /> : null}
    </>
  );
}

function TournamentDialog({ tournament, onClose, onSaved }: { tournament?: Tournament; onClose: () => void; onSaved: () => void }) {
  const { api } = usePos();
  const action = useAction();
  const [name, setName] = useState(tournament?.name ?? "");
  const [blurb, setBlurb] = useState(tournament?.blurb ?? "");
  const [when, setWhen] = useState(tournament ? toLocalInput(tournament.starts_at) : "");
  const [spots, setSpots] = useState(String(tournament?.spots ?? 16));
  const [fee, setFee] = useState(tournament ? centsToInput(tournament.entry_fee_cents) : "");
  const [reason, setReason] = useState("");

  const feeCents = parseDollars(fee);
  const spotsNumber = /^\d+$/.test(spots) ? Number(spots) : null;
  const startsAt = fromLocalInput(when);

  return (
    <Modal title={tournament ? `Edit ${tournament.name}` : "Add tournament"} onClose={onClose}>
      <div className="space-y-4">
        <Field label="Name">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Weekly Race Night" />
        </Field>
        <Field label="Description (optional)" hint="Shown on the website under the name.">
          <textarea value={blurb} onChange={(e) => setBlurb(e.target.value)} rows={3} className="w-full rounded-lg bg-ink-900 p-3 text-sm ring-1 ring-ink-700" />
        </Field>
        <Field label="Starts" hint="Sydney time.">
          <Input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Spots" hint={tournament ? `${tournament.entries} already signed up` : undefined}>
            <Input inputMode="numeric" value={spots} onChange={(e) => setSpots(e.target.value)} />
          </Field>
          <Field label="Entry fee (incl. GST)" hint="Enter 0 for a free tournament.">
            <Input inputMode="decimal" value={fee} onChange={(e) => setFee(e.target.value)} placeholder="25.00" />
          </Field>
        </div>
        <Field label="Reason (optional)">
          <Input value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>

        <ErrorNote error={action.error} />
        <p className="text-sm text-ink-400">
          {tournament ? "Changes show on the website straight away if it is published." : "It is saved as a draft. Publish it when you're ready."}
        </p>
        <Button
          variant="primary"
          className="w-full"
          disabled={action.busy || !name.trim() || feeCents === null || spotsNumber === null || spotsNumber < 1 || startsAt === null}
          onClick={() =>
            void action.run(async () => {
              const body = {
                name: name.trim(),
                blurb: blurb.trim(),
                startsAt,
                spots: spotsNumber,
                entryFeeCents: feeCents,
                ...(reason.trim() ? { reason: reason.trim() } : {}),
              };
              if (tournament) await api(`/admin/tournaments/${tournament.id}`, { method: "PATCH", body });
              else await api("/admin/tournaments", { body });
              onSaved();
            })
          }
        >
          {tournament ? "Save tournament" : "Add tournament"}
        </Button>
      </div>
    </Modal>
  );
}

function EntriesDialog({ tournament, onClose }: { tournament: Tournament; onClose: () => void }) {
  const entries = useApiData<{ entries: Entry[] }>(`/admin/tournaments/${tournament.id}/entries`);
  const rows = entries.data?.entries ?? [];
  const live = rows.filter((e) => e.status === "confirmed" || e.status === "held");

  return (
    <Modal title={`${tournament.name} — who's in`} onClose={onClose}>
      <ErrorNote error={entries.error} />
      <p className="mb-3 text-sm text-ink-400">
        {live.length} of {tournament.spots} spots taken. An entry waiting for payment holds its spot until the hold runs out.
      </p>
      <Table head={["Code", "Name", "Contact", "Paid", ""]} empty={entries.data !== null && rows.length === 0}>
        {rows.map((e) => (
          <tr key={e.id}>
            <Td className="tnum font-medium">{e.ref}</Td>
            <Td>{e.customers.name}</Td>
            <Td className="text-ink-400">{e.customers.email ?? e.customers.phone ?? "—"}</Td>
            <Td className="tnum">{e.free_entry ? "Membership" : e.total_cents === 0 ? "Free" : money(e.total_cents ?? 0)}</Td>
            <Td>
              {e.status === "confirmed" ? (
                <Badge tone="green">In</Badge>
              ) : e.status === "held" ? (
                <Badge tone="amber">Paying</Badge>
              ) : (
                <Badge tone="grey">{e.status}</Badge>
              )}
            </Td>
          </tr>
        ))}
      </Table>
    </Modal>
  );
}
