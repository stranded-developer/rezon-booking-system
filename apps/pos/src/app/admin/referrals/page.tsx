"use client";

import { useState } from "react";
import { Badge, Card, PageHeader, Table, Td, parsePercent, useAction, useApiData } from "@/components/admin/kit";
import { usePos } from "@/components/pos-provider";
import { Button, ErrorNote, Field, Input, Modal } from "@/components/ui";
import { money, parseDollars, percent } from "@/lib/format";

interface Code {
  id: string;
  code: string;
  discount_type: "percent" | "fixed";
  discount_value: number;
  max_uses: number;
  uses_count: number;
  valid_until: string | null;
  active: boolean;
  usable: boolean;
  creator: string | null;
  created_at: string;
}

export default function ReferralsPage() {
  const { config } = usePos();
  const tz = config?.timeZone ?? "Australia/Sydney";
  const { data, error, reload } = useApiData<{ codes: Code[] }>("/admin/referral-codes?include=all");
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Code | null>(null);
  const date = (iso: string) => new Intl.DateTimeFormat("en-AU", { timeZone: tz, day: "numeric", month: "short", year: "numeric" }).format(new Date(iso));

  return (
    <>
      <PageHeader
        title="Referral codes"
        description="Codes customers enter online or at the counter. Each code has a discount, a use limit and an optional expiry. Members can't use them."
        actions={
          <Button variant="primary" onClick={() => setCreating(true)}>
            Generate codes
          </Button>
        }
      />
      <ErrorNote error={error} />
      <Card>
        <Table head={["Code", "Discount", "Used", "Expires", "Status", "Created by", ""]} empty={data !== null && data.codes.length === 0}>
          {(data?.codes ?? []).map((c) => (
            <tr key={c.id}>
              <Td className="font-mono text-base font-semibold tracking-widest">{c.code}</Td>
              <Td>{c.discount_type === "percent" ? `${percent(c.discount_value)} off` : `${money(c.discount_value)} off`}</Td>
              <Td className="tnum">
                {c.uses_count} / {c.max_uses}
              </Td>
              <Td>{c.valid_until ? date(c.valid_until) : "Never"}</Td>
              <Td>
                {c.usable ? (
                  <Badge tone="green">Usable</Badge>
                ) : !c.active ? (
                  <Badge tone="grey">Off</Badge>
                ) : c.uses_count >= c.max_uses ? (
                  <Badge tone="amber">Used up</Badge>
                ) : (
                  <Badge tone="red">Expired</Badge>
                )}
              </Td>
              <Td className="text-ink-400">{c.creator ?? "—"}</Td>
              <Td>
                <Button size="sm" variant="ghost" onClick={() => setEditing(c)}>
                  Edit
                </Button>
              </Td>
            </tr>
          ))}
        </Table>
      </Card>
      {creating ? <GenerateDialog onClose={() => setCreating(false)} onCreated={reload} /> : null}
      {editing ? (
        <EditDialog
          code={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            reload();
          }}
        />
      ) : null}
    </>
  );
}

function GenerateDialog({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const { api } = usePos();
  const action = useAction();
  const [type, setType] = useState<"percent" | "fixed">("percent");
  const [value, setValue] = useState("10");
  const [maxUses, setMaxUses] = useState("10");
  const [expires, setExpires] = useState("");
  const [count, setCount] = useState("1");
  const [created, setCreated] = useState<Code[] | null>(null);

  const discount = type === "percent" ? parsePercent(value) : parseDollars(value);
  const uses = /^\d+$/.test(maxUses) ? Number(maxUses) : 0;
  const n = /^\d+$/.test(count) ? Number(count) : 0;
  const valid = discount !== null && discount > 0 && (type === "fixed" || discount < 10_000) && uses >= 1 && n >= 1 && n <= 100;

  if (created) {
    return (
      <Modal title={`${created.length} code${created.length === 1 ? "" : "s"} created`} onClose={onClose}>
        <div className="grid grid-cols-3 gap-2" data-testid="created-codes">
          {created.map((c) => (
            <div key={c.id} className="rounded-lg bg-ink-850 py-3 text-center font-mono text-lg font-bold tracking-widest">
              {c.code}
            </div>
          ))}
        </div>
      </Modal>
    );
  }

  return (
    <Modal title="Generate referral codes" onClose={onClose}>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-2">
          {(["percent", "fixed"] as const).map((t) => (
            <Button key={t} variant={type === t ? "primary" : "secondary"} onClick={() => setType(t)}>
              {t === "percent" ? "Percentage off" : "Dollar amount off"}
            </Button>
          ))}
        </div>
        <div className="grid grid-cols-3 gap-3">
          <Field label={type === "percent" ? "Percent off" : "Dollars off"}>
            <Input inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} />
          </Field>
          <Field label="Max uses (each)">
            <Input inputMode="numeric" value={maxUses} onChange={(e) => setMaxUses(e.target.value)} />
          </Field>
          <Field label="How many codes">
            <Input inputMode="numeric" value={count} onChange={(e) => setCount(e.target.value)} />
          </Field>
        </div>
        <Field label="Expires (optional)" hint="Codes stop working at the end of this day, Sydney time.">
          <Input type="date" value={expires} onChange={(e) => setExpires(e.target.value)} />
        </Field>
        <ErrorNote error={action.error} />
        <Button
          variant="primary"
          className="w-full"
          disabled={!valid || action.busy}
          onClick={async () => {
            const r = await action.run(() =>
              api<{ codes: Code[] }>("/admin/referral-codes", {
                body: {
                  type,
                  value: discount,
                  maxUses: uses,
                  count: n,
                  ...(expires ? { validUntil: new Date(`${expires}T23:59:59+10:00`).toISOString() } : {}),
                },
              }),
            );
            if (r) {
              setCreated(r.codes);
              onCreated();
            }
          }}
        >
          Generate {n > 1 ? `${n} codes` : "code"}
        </Button>
      </div>
    </Modal>
  );
}

function EditDialog({ code, onClose, onSaved }: { code: Code; onClose: () => void; onSaved: () => void }) {
  const { api } = usePos();
  const action = useAction();
  const [maxUses, setMaxUses] = useState(String(code.max_uses));
  const [reason, setReason] = useState("");

  const save = (body: Record<string, unknown>) =>
    action.run(async () => {
      await api(`/admin/referral-codes/${code.id}`, { method: "PATCH", body: { ...body, ...(reason.trim() ? { reason: reason.trim() } : {}) } });
      onSaved();
    });

  return (
    <Modal title={`Code ${code.code}`} onClose={onClose}>
      <div className="space-y-4">
        <p className="text-sm text-ink-400">
          Used {code.uses_count} of {code.max_uses} times.
        </p>
        <Field label="Max uses">
          <Input inputMode="numeric" value={maxUses} onChange={(e) => setMaxUses(e.target.value)} />
        </Field>
        <Field label="Reason (optional)">
          <Input value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
        <ErrorNote error={action.error} />
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" disabled={action.busy || !/^\d+$/.test(maxUses)} onClick={() => void save({ maxUses: Number(maxUses) })}>
            Save limit
          </Button>
          <Button disabled={action.busy} onClick={() => void save({ validUntil: null })}>
            Remove expiry
          </Button>
          <Button variant={code.active ? "danger" : "secondary"} disabled={action.busy} onClick={() => void save({ active: !code.active })}>
            {code.active ? "Turn off" : "Turn on"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
