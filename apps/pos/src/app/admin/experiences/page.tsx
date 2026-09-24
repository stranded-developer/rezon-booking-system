"use client";

import { useState } from "react";
import { Badge, Card, DaysPicker, daysLabel, PageHeader, Table, Td, useAction, useApiData } from "@/components/admin/kit";
import { usePos } from "@/components/pos-provider";
import { Button, ErrorNote, Field, Input, Modal } from "@/components/ui";
import { centsToInput, money, parseDollars } from "@/lib/format";

/**
 * Experiences and their promotional prices (D65, D66).
 *
 * An experience is a named package with a fixed length and a flat price — the simulators are sold
 * this way. Billiards and VR keep their hourly rate, which is on the "Rates & happy hours" screen.
 */

interface Promo {
  id: string;
  experience_id: string;
  name: string;
  days_of_week: number[];
  start_time: string;
  end_time: string;
  price_cents: number;
  claimed: boolean;
  active: boolean;
  sort: number;
}

interface Experience {
  id: string;
  key: string;
  resource_type_id: string;
  name: string;
  tagline: string | null;
  bullets: string[];
  badges: string[];
  minutes: number;
  price_cents: number;
  active: boolean;
  sort: number;
  promos: Promo[];
}

interface ResourceType {
  id: string;
  name: string;
  active: boolean;
}

export default function ExperiencesPage() {
  const experiences = useApiData<{ experiences: Experience[] }>("/admin/experiences");
  const types = useApiData<{ resourceTypes: ResourceType[] }>("/admin/resource-types");
  const settings = useApiData<{ settings: { session_minutes: number } }>("/admin/settings");
  const [editing, setEditing] = useState<Experience | null>(null);
  const [adding, setAdding] = useState(false);
  const [addingPromoFor, setAddingPromoFor] = useState<Experience | null>(null);
  const [showRetired, setShowRetired] = useState(false);

  const { api } = usePos();
  const action = useAction();
  const all = experiences.data?.experiences ?? [];
  const visible = all.filter((e) => showRetired || e.active);
  const activeTypes = (types.data?.resourceTypes ?? []).filter((t) => t.active);
  const typeName = (id: string) => types.data?.resourceTypes.find((t) => t.id === id)?.name ?? "—";
  const sessionMinutes = settings.data?.settings.session_minutes ?? 30;

  return (
    <>
      <PageHeader
        title="Experiences"
        description="Named packages sold at a flat price for a fixed length. All prices include GST. Anything sold by the hour is on Rates & happy hours."
        actions={
          <div className="flex gap-2">
            <Button variant={showRetired ? "primary" : "secondary"} onClick={() => setShowRetired((v) => !v)}>
              {showRetired ? "Showing retired" : "Show retired"}
            </Button>
            <Button onClick={() => setAdding(true)}>Add experience</Button>
          </div>
        }
      />
      <ErrorNote error={experiences.error ?? types.error ?? action.error} />

      <div className="space-y-6">
        {visible.map((exp) => (
          <Card
            key={exp.id}
            title={
              <span className="flex flex-wrap items-center gap-2">
                {exp.name}
                {exp.active ? null : <Badge tone="grey">Off</Badge>}
                {exp.badges.map((b) => (
                  <Badge key={b} tone="blue">
                    {b}
                  </Badge>
                ))}
              </span>
            }
            actions={
              <div className="flex gap-2">
                <Button size="sm" variant="ghost" onClick={() => setAddingPromoFor(exp)}>
                  Add price
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setEditing(exp)}>
                  Edit
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={action.busy}
                  onClick={() => void action.run(async () => (await api(`/admin/experiences/${exp.id}`, { method: "PATCH", body: { active: !exp.active } }), experiences.reload()))}
                >
                  {exp.active ? "Turn off" : "Turn on"}
                </Button>
              </div>
            }
          >
            <div className="mb-4 flex flex-wrap items-baseline gap-x-6 gap-y-1 text-sm">
              <span className="tnum text-lg font-semibold">{money(exp.price_cents)}</span>
              <span className="text-ink-400">
                {exp.minutes} min · {typeName(exp.resource_type_id)}
              </span>
              {exp.tagline ? <span className="text-ink-400">{exp.tagline}</span> : null}
            </div>

            <Table head={["Promotional price", "Days", "Time", "Price", "How it applies", "", ""]} empty={exp.promos.length === 0}>
              {exp.promos.map((p) => (
                <tr key={p.id}>
                  <Td className="font-medium">{p.name}</Td>
                  <Td>{daysLabel(p.days_of_week)}</Td>
                  <Td className="tnum">
                    {p.start_time}–{p.end_time}
                  </Td>
                  <Td className="tnum font-semibold">{money(p.price_cents)}</Td>
                  <Td className="text-ink-400">{p.claimed ? "Only if the customer asks" : "Automatically"}</Td>
                  <Td>{p.active ? <Badge tone="green">On</Badge> : <Badge tone="grey">Off</Badge>}</Td>
                  <Td>
                    <div className="flex gap-1">
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={action.busy}
                        onClick={() => void action.run(async () => (await api(`/admin/experience-promos/${p.id}`, { method: "PATCH", body: { active: !p.active } }), experiences.reload()))}
                      >
                        {p.active ? "Turn off" : "Turn on"}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={action.busy}
                        onClick={() => {
                          if (!confirm(`Delete the ${p.name} price for ${exp.name}? This cannot be undone.`)) return;
                          void action.run(async () => (await api(`/admin/experience-promos/${p.id}`, { method: "DELETE" }), experiences.reload()));
                        }}
                      >
                        Delete
                      </Button>
                    </div>
                  </Td>
                </tr>
              ))}
            </Table>
            <p className="mt-3 text-sm text-ink-400">
              When more than one price matches, the <strong>cheapest</strong> one wins. That is what keeps a price the customer has to ask for — a student
              price — from undercutting happy hour.
            </p>
          </Card>
        ))}
        {experiences.data && visible.length === 0 ? (
          <Card>
            <p className="text-sm text-ink-400">No experiences yet. Add one to sell a named package at a flat price.</p>
          </Card>
        ) : null}
      </div>

      {adding && types.data ? (
        <ExperienceDialog
          types={activeTypes}
          sessionMinutes={sessionMinutes}
          onClose={() => setAdding(false)}
          onSaved={() => {
            setAdding(false);
            experiences.reload();
          }}
        />
      ) : null}
      {editing && types.data ? (
        <ExperienceDialog
          experience={editing}
          types={activeTypes}
          sessionMinutes={sessionMinutes}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            experiences.reload();
          }}
        />
      ) : null}
      {addingPromoFor ? (
        <PromoDialog
          experience={addingPromoFor}
          onClose={() => setAddingPromoFor(null)}
          onSaved={() => {
            setAddingPromoFor(null);
            experiences.reload();
          }}
        />
      ) : null}
    </>
  );
}

function ExperienceDialog({
  experience,
  types,
  sessionMinutes,
  onClose,
  onSaved,
}: {
  experience?: Experience;
  types: ResourceType[];
  sessionMinutes: number;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { api } = usePos();
  const action = useAction();
  const [key, setKey] = useState(experience?.key ?? "");
  const [name, setName] = useState(experience?.name ?? "");
  const [typeId, setTypeId] = useState(experience?.resource_type_id ?? types[0]?.id ?? "");
  const [tagline, setTagline] = useState(experience?.tagline ?? "");
  const [minutes, setMinutes] = useState(String(experience?.minutes ?? sessionMinutes));
  const [price, setPrice] = useState(experience ? centsToInput(experience.price_cents) : "");
  const [bullets, setBullets] = useState((experience?.bullets ?? []).join("\n"));
  const [badges, setBadges] = useState((experience?.badges ?? []).join(", "));
  const [reason, setReason] = useState("");

  const priceCents = parseDollars(price);
  const minutesNumber = /^\d+$/.test(minutes) ? Number(minutes) : null;
  const lengthOk = minutesNumber !== null && minutesNumber > 0 && minutesNumber % sessionMinutes === 0;
  const keyOk = experience ? true : /^[a-z0-9_]+$/.test(key);

  const body = {
    name: name.trim(),
    resourceTypeId: typeId,
    tagline: tagline.trim(),
    minutes: minutesNumber,
    priceCents,
    bullets: bullets
      .split("\n")
      .map((b) => b.trim())
      .filter(Boolean),
    badges: badges
      .split(",")
      .map((b) => b.trim())
      .filter(Boolean),
    ...(reason.trim() ? { reason: reason.trim() } : {}),
  };

  return (
    <Modal title={experience ? `Edit ${experience.name}` : "Add experience"} onClose={onClose}>
      <div className="space-y-4">
        {experience ? null : (
          <Field label="Short code" hint="Lower-case letters, numbers and underscores. Used in links, e.g. quick_race.">
            <Input value={key} onChange={(e) => setKey(e.target.value.toLowerCase())} placeholder="quick_race" />
          </Field>
        )}
        <Field label="Name">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Quick Race" />
        </Field>
        <Field label="Runs on">
          <select value={typeId} onChange={(e) => setTypeId(e.target.value)} className="h-11 rounded-lg bg-ink-900 px-3 ring-1 ring-ink-700">
            {types.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Length in minutes" hint={`A whole number of ${sessionMinutes}-minute sessions`}>
            <Input inputMode="numeric" value={minutes} onChange={(e) => setMinutes(e.target.value)} />
          </Field>
          <Field label="Price (incl. GST)" hint={priceCents !== null ? `GST ${money(Math.floor((priceCents * 2 + 11) / 22))}` : "Enter an amount"}>
            <Input inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="35.00" />
          </Field>
        </div>
        <Field label="Tagline (optional)">
          <Input value={tagline} onChange={(e) => setTagline(e.target.value)} placeholder="Single session" />
        </Field>
        <Field label="Bullet points" hint="One per line. These are the ticks on the card.">
          <textarea
            value={bullets}
            onChange={(e) => setBullets(e.target.value)}
            rows={4}
            className="w-full rounded-lg bg-ink-900 p-3 text-sm ring-1 ring-ink-700"
            placeholder={"Perfect for a first time behind the wheel\nOne 30-minute session"}
          />
        </Field>
        <Field label="Badges (optional)" hint="Separated by commas, e.g. Most popular, Save over 20%">
          <Input value={badges} onChange={(e) => setBadges(e.target.value)} />
        </Field>
        <Field label="Reason (optional)">
          <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. price review" />
        </Field>

        <ErrorNote error={action.error} />
        {minutesNumber !== null && !lengthOk ? <p className="text-sm text-amber-300">A length has to be a whole number of {sessionMinutes}-minute sessions.</p> : null}

        <Button
          variant="primary"
          className="w-full"
          disabled={action.busy || !name.trim() || !typeId || priceCents === null || !lengthOk || !keyOk}
          onClick={() =>
            void action.run(async () => {
              if (experience) await api(`/admin/experiences/${experience.id}`, { method: "PATCH", body });
              else await api("/admin/experiences", { body: { ...body, key: key.trim() } });
              onSaved();
            })
          }
        >
          {experience ? `Save ${experience.name}` : "Add experience"}
        </Button>
      </div>
    </Modal>
  );
}

function PromoDialog({ experience, onClose, onSaved }: { experience: Experience; onClose: () => void; onSaved: () => void }) {
  const { api } = usePos();
  const action = useAction();
  const [name, setName] = useState("");
  const [days, setDays] = useState<number[]>([1, 2, 3, 4, 5, 6, 7]);
  const [start, setStart] = useState("12:00");
  const [end, setEnd] = useState("15:00");
  const [price, setPrice] = useState("");
  const [claimed, setClaimed] = useState(false);
  const [reason, setReason] = useState("");
  const priceCents = parseDollars(price);

  return (
    <Modal title={`Add a price for ${experience.name}`} onClose={onClose}>
      <div className="space-y-4">
        <Field label="Name" hint="What the customer sees, e.g. Happy Hour or Student">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Happy Hour" />
        </Field>
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
        <Field label="Price (incl. GST)" hint={`Normally ${money(experience.price_cents)}`}>
          <Input inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="29.00" />
        </Field>
        <label className="flex items-start gap-3 text-sm">
          <input type="checkbox" className="mt-1 size-4" checked={claimed} onChange={(e) => setClaimed(e.target.checked)} />
          <span>
            The customer has to ask for this price
            <span className="block text-ink-400">Tick for a student or concession price. Leave it off for happy hour, which applies by itself.</span>
          </span>
        </label>
        <Field label="Reason (optional)">
          <Input value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>

        <ErrorNote error={action.error} />
        <p className="text-sm text-ink-400">
          Prices may overlap. When more than one matches, the customer gets the <strong>cheapest</strong>.
        </p>
        <Button
          variant="primary"
          className="w-full"
          disabled={action.busy || !name.trim() || priceCents === null || days.length === 0}
          onClick={() =>
            void action.run(async () => {
              await api("/admin/experience-promos", {
                body: {
                  experienceId: experience.id,
                  name: name.trim(),
                  daysOfWeek: days,
                  startTime: start,
                  endTime: end,
                  priceCents,
                  claimed,
                  ...(reason.trim() ? { reason: reason.trim() } : {}),
                },
              });
              onSaved();
            })
          }
        >
          Add price
        </Button>
      </div>
    </Modal>
  );
}
