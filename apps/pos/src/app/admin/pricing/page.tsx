"use client";

import { useState } from "react";
import { Badge, bpToInput, Card, DaysPicker, daysLabel, PageHeader, parsePercent, Table, Td, useAction, useApiData } from "@/components/admin/kit";
import { usePos } from "@/components/pos-provider";
import { Button, ErrorNote, Field, Input, Modal } from "@/components/ui";
import { centsToInput, money, parseDollars, percent } from "@/lib/format";

interface ResourceType {
  id: string;
  key: string;
  name: string;
  base_rate_cents: number;
  min_minutes: number;
  active: boolean;
  sort: number;
  resources: { id: string; label: string; sort: number; active: boolean }[];
}
interface Band {
  id: string;
  resource_type_id: string;
  days_of_week: number[];
  start_time: string;
  end_time: string;
  rate_cents: number;
  active: boolean;
}
interface HappyHourRow {
  id: string;
  name: string;
  resource_type_ids: string[] | null;
  days_of_week: number[];
  start_time: string;
  end_time: string;
  discount_bp: number;
  active: boolean;
}

export default function PricingPage() {
  const types = useApiData<{ resourceTypes: ResourceType[] }>("/admin/resource-types");
  const bands = useApiData<{ rateBands: Band[] }>("/admin/rate-bands");
  const hhs = useApiData<{ happyHours: HappyHourRow[] }>("/admin/happy-hours");
  const [editingType, setEditingType] = useState<ResourceType | null>(null);
  const [addingBand, setAddingBand] = useState(false);
  const [addingHh, setAddingHh] = useState(false);
  const [showRetired, setShowRetired] = useState(false);
  const visibleTypes = (types.data?.resourceTypes ?? []).filter((t) => showRetired || t.active);
  const visibleBands = (bands.data?.rateBands ?? []).filter((b) => showRetired || b.active);
  const visibleHhs = (hhs.data?.happyHours ?? []).filter((h) => showRetired || h.active);
  const activeTypes = (types.data?.resourceTypes ?? []).filter((t) => t.active);
  const { api } = usePos();
  const action = useAction();
  const typeName = (id: string) => types.data?.resourceTypes.find((t) => t.id === id)?.name ?? "—";
  const reloadAll = () => {
    types.reload();
    bands.reload();
    hhs.reload();
  };

  return (
    <>
      <PageHeader
        title="Rates & happy hours"
        description="All prices include GST. Changes apply to sessions closed from now on; every change is recorded in the audit log."
        actions={
          <Button variant={showRetired ? "primary" : "secondary"} onClick={() => setShowRetired((v) => !v)}>
            {showRetired ? "Showing retired" : "Show retired"}
          </Button>
        }
      />
      <ErrorNote error={types.error ?? bands.error ?? hhs.error ?? action.error} />
      <div className="space-y-6">
        <Card title="Resource types and base rates">
          <Table head={["Type", "Rate per hour", "GST", "Minimum", "Resources", "", ""]}>
            {visibleTypes.map((t) => (
              <tr key={t.id}>
                <Td className="font-medium">{t.name}</Td>
                <Td className="tnum font-semibold">{money(t.base_rate_cents)}</Td>
                <Td className="tnum text-ink-400">incl. {money(Math.floor((t.base_rate_cents * 2 + 11) / 22))}</Td>
                <Td>{t.min_minutes} min</Td>
                <Td className="text-ink-400">
                  {t.resources
                    .filter((r) => r.active)
                    .sort((a, b) => a.sort - b.sort)
                    .map((r) => r.label)
                    .join(", ")}
                </Td>
                <Td>{t.active ? null : <Badge tone="grey">Off</Badge>}</Td>
                <Td>
                  <Button size="sm" variant="ghost" onClick={() => setEditingType(t)}>
                    Edit
                  </Button>
                </Td>
              </tr>
            ))}
          </Table>
        </Card>

        <Card
          title="Rate bands"
          actions={
            <Button size="sm" onClick={() => setAddingBand(true)}>
              Add band
            </Button>
          }
        >
          <p className="mb-3 text-sm text-ink-400">Optional overrides of the base rate for particular days and times, e.g. weekend pricing.</p>
          <Table head={["Type", "Days", "Time", "Rate per hour", "", ""]} empty={bands.data !== null && visibleBands.length === 0}>
            {visibleBands.map((b) => (
              <tr key={b.id}>
                <Td>{typeName(b.resource_type_id)}</Td>
                <Td>{daysLabel(b.days_of_week)}</Td>
                <Td className="tnum">
                  {b.start_time}–{b.end_time}
                </Td>
                <Td className="tnum font-semibold">{money(b.rate_cents)}</Td>
                <Td>{b.active ? <Badge tone="green">On</Badge> : <Badge tone="grey">Off</Badge>}</Td>
                <Td>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={action.busy}
                    onClick={() => void action.run(async () => (await api(`/admin/rate-bands/${b.id}`, { method: "PATCH", body: { active: !b.active } }), bands.reload()))}
                  >
                    {b.active ? "Turn off" : "Turn on"}
                  </Button>
                </Td>
              </tr>
            ))}
          </Table>
        </Card>

        <Card
          title="Happy hours"
          actions={
            <Button size="sm" onClick={() => setAddingHh(true)}>
              Add happy hour
            </Button>
          }
        >
          <Table head={["Name", "Applies to", "Days", "Time", "Discount", "", ""]} empty={hhs.data !== null && visibleHhs.length === 0}>
            {visibleHhs.map((h) => (
              <tr key={h.id}>
                <Td className="font-medium">{h.name}</Td>
                <Td>{h.resource_type_ids ? h.resource_type_ids.map(typeName).join(", ") : "Everything"}</Td>
                <Td>{daysLabel(h.days_of_week)}</Td>
                <Td className="tnum">
                  {h.start_time}–{h.end_time}
                </Td>
                <Td className="font-semibold">{percent(h.discount_bp)} off</Td>
                <Td>{h.active ? <Badge tone="green">On</Badge> : <Badge tone="grey">Off</Badge>}</Td>
                <Td>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={action.busy}
                    onClick={() => void action.run(async () => (await api(`/admin/happy-hours/${h.id}`, { method: "PATCH", body: { active: !h.active } }), hhs.reload()))}
                  >
                    {h.active ? "Turn off" : "Turn on"}
                  </Button>
                </Td>
              </tr>
            ))}
          </Table>
        </Card>
      </div>

      {editingType ? (
        <TypeDialog
          type={editingType}
          onClose={() => setEditingType(null)}
          onSaved={() => {
            setEditingType(null);
            reloadAll();
          }}
        />
      ) : null}
      {addingBand && types.data ? (
        <BandDialog
          types={activeTypes}
          onClose={() => setAddingBand(false)}
          onSaved={() => {
            setAddingBand(false);
            bands.reload();
          }}
        />
      ) : null}
      {addingHh && types.data ? (
        <HappyHourDialog
          types={activeTypes}
          onClose={() => setAddingHh(false)}
          onSaved={() => {
            setAddingHh(false);
            hhs.reload();
          }}
        />
      ) : null}
    </>
  );
}

function TypeDialog({ type, onClose, onSaved }: { type: ResourceType; onClose: () => void; onSaved: () => void }) {
  const { api } = usePos();
  const action = useAction();
  const [rate, setRate] = useState(centsToInput(type.base_rate_cents));
  const [minMinutes, setMinMinutes] = useState(String(type.min_minutes));
  const [reason, setReason] = useState("");
  const [newLabel, setNewLabel] = useState("");
  const rateCents = parseDollars(rate);

  return (
    <Modal title={type.name} onClose={onClose}>
      <div className="space-y-5">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Rate per hour (incl. GST)" hint={rateCents !== null ? `GST ${money(Math.floor((rateCents * 2 + 11) / 22))}` : "Enter an amount"}>
            <Input inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} />
          </Field>
          <Field label="Minimum minutes">
            <Input inputMode="numeric" value={minMinutes} onChange={(e) => setMinMinutes(e.target.value)} />
          </Field>
        </div>
        <Field label="Reason (optional)">
          <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. price review" />
        </Field>
        <ErrorNote error={action.error} />
        <Button
          variant="primary"
          className="w-full"
          disabled={action.busy || rateCents === null || !/^\d+$/.test(minMinutes)}
          onClick={() =>
            void action.run(async () => {
              await api(`/admin/resource-types/${type.id}`, {
                method: "PATCH",
                body: { baseRateCents: rateCents, minMinutes: Number(minMinutes), ...(reason.trim() ? { reason: reason.trim() } : {}) },
              });
              onSaved();
            })
          }
        >
          Save {type.name}
        </Button>

        <div className="space-y-2 border-t border-ink-800 pt-4">
          <h3 className="font-semibold">{type.name} resources</h3>
          {type.resources
            .slice()
            .sort((a, b) => a.sort - b.sort)
            .map((r) => (
              <div key={r.id} className="flex items-center justify-between rounded-lg bg-ink-850 px-3 py-2 text-sm">
                <span className={r.active ? "" : "text-ink-400 line-through"}>{r.label}</span>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={action.busy}
                  onClick={() => void action.run(async () => (await api(`/admin/resources/${r.id}`, { method: "PATCH", body: { active: !r.active } }), onSaved()))}
                >
                  {r.active ? "Retire" : "Bring back"}
                </Button>
              </div>
            ))}
          <div className="flex gap-2">
            <Input className="flex-1" value={newLabel} onChange={(e) => setNewLabel(e.target.value)} placeholder={`e.g. ${type.name.split(" ")[0]} 3`} />
            <Button
              disabled={action.busy || !newLabel.trim()}
              onClick={() => void action.run(async () => (await api("/admin/resources", { body: { resourceTypeId: type.id, label: newLabel.trim(), sort: type.resources.length + 1 } }), onSaved()))}
            >
              Add
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

function BandDialog({ types, onClose, onSaved }: { types: ResourceType[]; onClose: () => void; onSaved: () => void }) {
  const { api } = usePos();
  const action = useAction();
  const [typeId, setTypeId] = useState(types[0]?.id ?? "");
  const [days, setDays] = useState<number[]>([6, 7]);
  const [start, setStart] = useState("10:00");
  const [end, setEnd] = useState("21:00");
  const [rate, setRate] = useState("");
  const rateCents = parseDollars(rate);

  return (
    <Modal title="Add rate band" onClose={onClose}>
      <div className="space-y-4">
        <Field label="Resource type">
          <select value={typeId} onChange={(e) => setTypeId(e.target.value)} className="h-11 rounded-lg bg-ink-900 px-3 ring-1 ring-ink-700">
            {types.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Days">
          <DaysPicker value={days} onChange={setDays} />
        </Field>
        <div className="grid grid-cols-3 gap-3">
          <Field label="From">
            <Input type="time" value={start} onChange={(e) => setStart(e.target.value)} />
          </Field>
          <Field label="Until">
            <Input type="time" value={end} onChange={(e) => setEnd(e.target.value)} />
          </Field>
          <Field label="Rate per hour">
            <Input inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} placeholder="0.00" />
          </Field>
        </div>
        <ErrorNote error={action.error} />
        <Button
          variant="primary"
          className="w-full"
          disabled={action.busy || rateCents === null || days.length === 0}
          onClick={() =>
            void action.run(async () => {
              await api("/admin/rate-bands", { body: { resourceTypeId: typeId, daysOfWeek: days, startTime: start, endTime: end, rateCents } });
              onSaved();
            })
          }
        >
          Add band
        </Button>
      </div>
    </Modal>
  );
}

function HappyHourDialog({ types, onClose, onSaved }: { types: ResourceType[]; onClose: () => void; onSaved: () => void }) {
  const { api } = usePos();
  const action = useAction();
  const [name, setName] = useState("");
  const [all, setAll] = useState(true);
  const [selected, setSelected] = useState<string[]>([]);
  const [days, setDays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [start, setStart] = useState("10:00");
  const [end, setEnd] = useState("15:00");
  const [discount, setDiscount] = useState(bpToInput(1000));
  const bp = parsePercent(discount);

  return (
    <Modal title="Add happy hour" onClose={onClose}>
      <div className="space-y-4">
        <Field label="Name">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Sunday morning" />
        </Field>
        <Field label="Applies to">
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant={all ? "primary" : "secondary"} onClick={() => setAll(true)}>
              Everything
            </Button>
            {types.map((t) => (
              <Button
                key={t.id}
                size="sm"
                variant={!all && selected.includes(t.id) ? "primary" : "secondary"}
                onClick={() => {
                  setAll(false);
                  setSelected((s) => (s.includes(t.id) ? s.filter((x) => x !== t.id) : [...s, t.id]));
                }}
              >
                {t.name}
              </Button>
            ))}
          </div>
        </Field>
        <Field label="Days">
          <DaysPicker value={days} onChange={setDays} />
        </Field>
        <div className="grid grid-cols-3 gap-3">
          <Field label="From">
            <Input type="time" value={start} onChange={(e) => setStart(e.target.value)} />
          </Field>
          <Field label="Until">
            <Input type="time" value={end} onChange={(e) => setEnd(e.target.value)} />
          </Field>
          <Field label="Percent off">
            <Input inputMode="decimal" value={discount} onChange={(e) => setDiscount(e.target.value)} />
          </Field>
        </div>
        <ErrorNote error={action.error} />
        <Button
          variant="primary"
          className="w-full"
          disabled={action.busy || !name.trim() || bp === null || days.length === 0 || (!all && selected.length === 0)}
          onClick={() =>
            void action.run(async () => {
              await api("/admin/happy-hours", {
                body: { name: name.trim(), resourceTypeIds: all ? null : selected, daysOfWeek: days, startTime: start, endTime: end, discountBp: bp },
              });
              onSaved();
            })
          }
        >
          Add happy hour
        </Button>
      </div>
    </Modal>
  );
}
