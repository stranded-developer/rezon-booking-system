"use client";

import { useState } from "react";
import { MemberCard } from "@/components/admin/member-card";
import { Badge, Card, PageHeader, Table, Td, useAction, useApiData } from "@/components/admin/kit";
import { usePos } from "@/components/pos-provider";
import { Button, ErrorNote, Field, Input, Modal } from "@/components/ui";
import { percent } from "@/lib/format";
import type { MemberSummary } from "@/lib/types";

interface MemberRow {
  id: string;
  memberNo: string;
  status: string;
  currentPeriodEnd: string | null;
  name: string;
  email: string | null;
  phone: string | null;
  tierName: string;
  balanceMinutes: number;
}

interface LedgerEntry {
  id: string;
  delta_minutes: number;
  kind: string;
  reason: string | null;
  created_at: string;
  actor: string | null;
}

const STATUS_TONE: Record<string, "green" | "red" | "amber" | "grey" | "blue"> = {
  active: "green",
  cancelling: "amber",
  past_due: "red",
  ended: "grey",
  pending: "blue",
};

export default function MembersPage() {
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const { data, error, reload } = useApiData<{ members: MemberRow[] }>(`/admin/members${search ? `?q=${encodeURIComponent(search)}` : ""}`);
  const [creating, setCreating] = useState(false);
  const [open, setOpen] = useState<string | null>(null);

  return (
    <>
      <PageHeader
        title="Members"
        description="Look up members, adjust free-play balances and reissue cards. Paid memberships arrive with online billing; here you can add complimentary ones."
        actions={
          <Button variant="primary" onClick={() => setCreating(true)}>
            Add complimentary member
          </Button>
        }
      />
      <form
        className="mb-4 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setSearch(query.trim());
        }}
      >
        <Input className="flex-1" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search name, email or phone" />
        <Button type="submit">Search</Button>
      </form>
      <ErrorNote error={error} />
      <Card>
        <Table head={["Member", "Name", "Contact", "Tier", "Status", "Balance"]} empty={data !== null && data.members.length === 0}>
          {(data?.members ?? []).map((m) => (
            <tr key={m.id} className="cursor-pointer hover:bg-ink-850" onClick={() => setOpen(m.id)}>
              <Td className="tnum">{m.memberNo}</Td>
              <Td className="font-medium">{m.name}</Td>
              <Td className="text-ink-400">{m.email ?? m.phone}</Td>
              <Td>{m.tierName}</Td>
              <Td>
                <Badge tone={STATUS_TONE[m.status] ?? "grey"}>{m.status.replace("_", " ")}</Badge>
              </Td>
              <Td className="tnum">{m.balanceMinutes} min</Td>
            </tr>
          ))}
        </Table>
      </Card>
      {creating ? (
        <CreateMemberDialog
          onClose={() => setCreating(false)}
          onCreated={() => {
            reload();
          }}
        />
      ) : null}
      {open ? <MemberDialog memberId={open} onClose={() => setOpen(null)} onChanged={reload} /> : null}
    </>
  );
}

function CreateMemberDialog({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const { api, config } = usePos();
  const action = useAction();
  const [form, setForm] = useState({ name: "", email: "", phone: "", tierId: "", validUntil: "", reason: "" });
  const [created, setCreated] = useState<{ member: MemberSummary; card: { qr: string } } | null>(null);
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));

  if (created) {
    return (
      <Modal title="Member created" onClose={onClose}>
        <MemberCard qr={created.card.qr} name={created.member.name} memberNo={created.member.memberNo} />
      </Modal>
    );
  }

  return (
    <Modal title="Add complimentary member" onClose={onClose}>
      <div className="space-y-4">
        <Field label="Name">
          <Input value={form.name} onChange={set("name")} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Email">
            <Input type="email" value={form.email} onChange={set("email")} />
          </Field>
          <Field label="Phone">
            <Input value={form.phone} onChange={set("phone")} />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Tier">
            <select value={form.tierId} onChange={set("tierId")} className="h-11 rounded-lg bg-ink-900 px-3 ring-1 ring-ink-700">
              <option value="">Choose…</option>
              {config?.tiers.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} · {percent(t.discount_bp)} off
                </option>
              ))}
            </select>
          </Field>
          <Field label="Valid until (optional)">
            <Input type="date" value={form.validUntil} onChange={set("validUntil")} />
          </Field>
        </div>
        <Field label="Reason">
          <Input value={form.reason} onChange={set("reason")} placeholder="e.g. staff perk, sponsor" />
        </Field>
        <ErrorNote error={action.error} />
        <Button
          variant="primary"
          className="w-full"
          disabled={action.busy || !form.name.trim() || !form.tierId || (!form.email.trim() && !form.phone.trim()) || form.reason.trim().length < 3}
          onClick={async () => {
            const r = await action.run(() =>
              api<{ member: MemberSummary; card: { qr: string } }>("/admin/members", {
                body: {
                  name: form.name.trim(),
                  ...(form.email.trim() ? { email: form.email.trim() } : {}),
                  ...(form.phone.trim() ? { phone: form.phone.trim() } : {}),
                  tierId: form.tierId,
                  ...(form.validUntil ? { validUntil: new Date(`${form.validUntil}T23:59:59+10:00`).toISOString() } : {}),
                  reason: form.reason.trim(),
                },
              }),
            );
            if (r) {
              setCreated(r);
              onCreated();
            }
          }}
        >
          Create member
        </Button>
      </div>
    </Modal>
  );
}

function MemberDialog({ memberId, onClose, onChanged }: { memberId: string; onClose: () => void; onChanged: () => void }) {
  const { api, config } = usePos();
  const tz = config?.timeZone ?? "Australia/Sydney";
  const { data, error, reload } = useApiData<{ member: MemberSummary & { billing: string; currentPeriodEnd: string | null }; ledger: LedgerEntry[] }>(`/admin/members/${memberId}`);
  const balance = useAction();
  const card = useAction();
  const [minutes, setMinutes] = useState("");
  const [reason, setReason] = useState("");
  const [newCard, setNewCard] = useState<string | null>(null);
  const delta = /^-?\d+$/.test(minutes.trim()) ? Number(minutes.trim()) : null;
  const when = (iso: string) => new Intl.DateTimeFormat("en-AU", { timeZone: tz, day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(iso));

  if (!data) {
    return (
      <Modal title="Member" onClose={onClose}>
        <ErrorNote error={error} />
        {!error ? <p className="text-ink-400">Loading…</p> : null}
      </Modal>
    );
  }
  const m = data.member;

  return (
    <Modal title={`${m.name} · ${m.memberNo}`} onClose={onClose} wide>
      <div className="grid gap-6 md:grid-cols-2">
        <div className="space-y-4">
          <div className="rounded-xl bg-ink-850 p-4 text-sm">
            <div className="flex flex-wrap gap-2">
              <Badge tone={STATUS_TONE[m.status] ?? "grey"}>{m.status.replace("_", " ")}</Badge>
              <Badge tone="blue">
                {m.tierName} · {percent(m.discountBp)} off
              </Badge>
              <Badge tone="grey">{m.billing === "stripe" ? "Paid online" : "Complimentary"}</Badge>
            </div>
            <div className="mt-3 text-ink-200">{m.email ?? m.phone}</div>
            {m.currentPeriodEnd ? <div className="text-ink-400">Valid until {when(m.currentPeriodEnd)}</div> : null}
            <div className="tnum mt-3 text-3xl font-bold" data-testid="member-balance">
              {m.balanceMinutes} min
            </div>
            <div className="text-xs uppercase tracking-wide text-ink-400">Free-play balance</div>
          </div>

          <div className="space-y-3 rounded-xl bg-ink-850 p-4">
            <h3 className="font-semibold">Adjust balance</h3>
            <div className="grid grid-cols-[7rem_1fr] gap-2">
              <Field label="Minutes (+/−)">
                <Input inputMode="numeric" value={minutes} onChange={(e) => setMinutes(e.target.value)} placeholder="30 or -15" />
              </Field>
              <Field label="Reason">
                <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. goodwill" />
              </Field>
            </div>
            <ErrorNote error={balance.error} />
            <Button
              className="w-full"
              disabled={balance.busy || !delta || reason.trim().length < 3}
              onClick={async () => {
                const ok = await balance.run(() => api(`/admin/members/${memberId}/balance`, { body: { deltaMinutes: delta, reason: reason.trim() } }));
                if (ok) {
                  setMinutes("");
                  setReason("");
                  reload();
                  onChanged();
                }
              }}
            >
              {delta && delta < 0 ? `Remove ${-delta} min` : delta ? `Add ${delta} min` : "Adjust"}
            </Button>
          </div>

          <div className="space-y-3 rounded-xl bg-ink-850 p-4">
            <h3 className="font-semibold">Member card</h3>
            {newCard ? (
              <MemberCard qr={newCard} name={m.name} memberNo={m.memberNo} />
            ) : (
              <>
                <p className="text-sm text-ink-400">Reissuing makes the old card stop working immediately.</p>
                <ErrorNote error={card.error} />
                <Button
                  disabled={card.busy}
                  onClick={async () => {
                    const r = await card.run(() => api<{ card: { qr: string } }>(`/admin/members/${memberId}/card`, { body: { reason: "Reissued in back office" } }));
                    if (r) setNewCard(r.card.qr);
                  }}
                >
                  Reissue card
                </Button>
              </>
            )}
          </div>
        </div>

        <div>
          <h3 className="mb-2 font-semibold">Balance history</h3>
          <ul className="divide-y divide-ink-800 text-sm">
            {data.ledger.length === 0 ? <li className="py-3 text-ink-400">No entries yet.</li> : null}
            {data.ledger.map((l) => (
              <li key={l.id} className="flex items-start justify-between gap-3 py-2.5">
                <div>
                  <div className="capitalize">{l.kind}</div>
                  <div className="text-xs text-ink-400">
                    {when(l.created_at)}
                    {l.actor ? ` · ${l.actor}` : ""}
                    {l.reason ? ` · ${l.reason}` : ""}
                  </div>
                </div>
                <span className={`tnum font-semibold ${l.delta_minutes > 0 ? "text-emerald-300" : "text-red-300"}`}>
                  {l.delta_minutes > 0 ? "+" : ""}
                  {l.delta_minutes} min
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </Modal>
  );
}
