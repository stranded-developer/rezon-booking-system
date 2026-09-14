"use client";

import { useState } from "react";
import { Badge, bpToInput, Card, PageHeader, parsePercent, useAction, useApiData } from "@/components/admin/kit";
import { usePos } from "@/components/pos-provider";
import { Button, ErrorNote, Field, Input } from "@/components/ui";
import { centsToInput, money, parseDollars } from "@/lib/format";

interface Tier {
  id: string;
  name: string;
  discount_bp: number;
  monthly_price_cents: number;
  monthly_free_minutes: number;
  max_balance_minutes: number;
  active: boolean;
  activeMembers: number;
}

export default function TiersPage() {
  const { data, error, reload } = useApiData<{ tiers: Tier[] }>("/admin/tiers");
  return (
    <>
      <PageHeader
        title="Membership tiers"
        description="Discount, monthly price, free play and balance cap for each tier. Prices include GST. Price changes will sync to online billing once Stripe is connected."
      />
      <ErrorNote error={error} />
      <div className="grid gap-4 lg:grid-cols-3">
        {(data?.tiers ?? []).map((t) => (
          <TierCard key={t.id} tier={t} onSaved={reload} />
        ))}
      </div>
    </>
  );
}

function TierCard({ tier, onSaved }: { tier: Tier; onSaved: () => void }) {
  const { api } = usePos();
  const benefits = useAction();
  const price = useAction();
  const [discount, setDiscount] = useState(bpToInput(tier.discount_bp));
  const [free, setFree] = useState(String(tier.monthly_free_minutes));
  const [cap, setCap] = useState(String(tier.max_balance_minutes));
  const [newPrice, setNewPrice] = useState(centsToInput(tier.monthly_price_cents));
  const [reason, setReason] = useState("");
  const [saved, setSaved] = useState<string | null>(null);
  const bp = parsePercent(discount);
  const priceCents = parseDollars(newPrice);

  return (
    <Card title={tier.name} actions={<Badge tone={tier.active ? "green" : "grey"}>{tier.activeMembers} members</Badge>}>
      <div className="space-y-4">
        <div className="grid grid-cols-3 gap-2">
          <Field label="% off">
            <Input inputMode="decimal" value={discount} onChange={(e) => setDiscount(e.target.value)} />
          </Field>
          <Field label="Free min/mo">
            <Input inputMode="numeric" value={free} onChange={(e) => setFree(e.target.value)} />
          </Field>
          <Field label="Balance cap">
            <Input inputMode="numeric" value={cap} onChange={(e) => setCap(e.target.value)} />
          </Field>
        </div>
        <ErrorNote error={benefits.error} />
        <Button
          className="w-full"
          disabled={benefits.busy || bp === null || !/^\d+$/.test(free) || !/^\d+$/.test(cap)}
          onClick={() =>
            void benefits.run(async () => {
              await api(`/admin/tiers/${tier.id}`, { method: "PATCH", body: { discountBp: bp, monthlyFreeMinutes: Number(free), maxBalanceMinutes: Number(cap) } });
              setSaved("Benefits saved");
              onSaved();
            })
          }
        >
          Save benefits
        </Button>

        <div className="space-y-2 border-t border-ink-800 pt-4">
          <Field label="Monthly price (incl. GST)" hint={priceCents !== null ? `Currently ${money(tier.monthly_price_cents)} · GST ${money(Math.floor((priceCents * 2 + 11) / 22))}` : "Enter an amount"}>
            <Input inputMode="decimal" value={newPrice} onChange={(e) => setNewPrice(e.target.value)} />
          </Field>
          <Field label="Reason">
            <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. annual review" />
          </Field>
          <ErrorNote error={price.error} />
          <Button
            variant="primary"
            className="w-full"
            disabled={price.busy || priceCents === null || priceCents === tier.monthly_price_cents || reason.trim().length < 3}
            onClick={() =>
              void price.run(async () => {
                await api(`/admin/tiers/${tier.id}/price`, { body: { amountCents: priceCents, reason: reason.trim() } });
                setSaved("Price changed. Existing members move to it at their next renewal once billing is connected.");
                setReason("");
                onSaved();
              })
            }
          >
            Change price
          </Button>
        </div>
        {saved ? <p className="text-sm text-emerald-300">{saved}</p> : null}
      </div>
    </Card>
  );
}
