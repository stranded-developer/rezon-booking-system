"use client";

import { QRCodeSVG } from "qrcode.react";
import { useEffect, useState } from "react";
import { money, percent } from "@/lib/format";
import type { MemberSummary } from "@/lib/types";
import { MemberCard } from "./admin/member-card";
import { useAction } from "./admin/kit";
import { usePos } from "./pos-provider";
import { Button, ErrorNote, Field, Input, Modal } from "./ui";

interface Checkout {
  memberId: string;
  memberNo: string;
  checkoutUrl: string;
  expiresAt: string;
}

const POLL_MS = 3_000;

/** Counter sale: the customer pays the monthly subscription on their own phone via Stripe Checkout. */
export function SellMembershipDialog({ onClose }: { onClose: () => void }) {
  const { api, config } = usePos();
  const tiers = (config?.tiers ?? []).filter((t) => t.sellable);
  const start = useAction();
  const card = useAction();
  const [form, setForm] = useState({ name: "", email: "", phone: "", tierId: "" });
  const [checkout, setCheckout] = useState<Checkout | null>(null);
  const [member, setMember] = useState<MemberSummary | null>(null);
  const [hasCard, setHasCard] = useState(false);
  const [qr, setQr] = useState<string | null>(null);
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));

  // Wait for Stripe to confirm the payment (the webhook activates the member).
  useEffect(() => {
    if (!checkout || member?.eligible) return;
    let cancelled = false;
    const tick = () =>
      api<{ member: MemberSummary; hasCard: boolean }>(`/pos/memberships/${checkout.memberId}`, { passive: true })
        .then((r) => {
          if (cancelled) return;
          setMember(r.member);
          setHasCard(r.hasCard);
        })
        .catch(() => undefined);
    const timer = window.setInterval(tick, POLL_MS);
    tick();
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [api, checkout, member?.eligible]);

  if (qr && member) {
    return (
      <Modal title="Member card" onClose={onClose}>
        <MemberCard qr={qr} name={member.name} memberNo={member.memberNo} />
      </Modal>
    );
  }

  if (checkout) {
    const active = member?.eligible === true;
    return (
      <Modal title={active ? "Membership active" : "Scan to pay"} onClose={onClose}>
        {active && member ? (
          <div className="space-y-4 text-center" data-testid="membership-active">
            <div className="rounded-xl bg-emerald-400/10 p-5 ring-1 ring-emerald-400/30">
              <div className="text-3xl">✓</div>
              <div className="mt-1 text-lg font-semibold">{member.name}</div>
              <div className="text-sm text-emerald-200">
                {member.tierName} · {percent(member.discountBp)} off · {member.memberNo}
              </div>
              <div className="mt-2 text-sm">{member.balanceMinutes} min free play ready</div>
            </div>
            <ErrorNote error={card.error} />
            {hasCard ? (
              <p className="text-sm text-ink-400">This member already has a card. Reissue it in the back office if needed.</p>
            ) : (
              <Button
                variant="primary"
                size="lg"
                className="w-full"
                disabled={card.busy}
                onClick={async () => {
                  const r = await card.run(() => api<{ qr: string }>(`/pos/memberships/${checkout.memberId}/card`, { body: {} }));
                  if (r) setQr(r.qr);
                }}
              >
                Print member card
              </Button>
            )}
          </div>
        ) : (
          <div className="space-y-4 text-center">
            <p className="text-sm text-ink-200">Ask the customer to scan this with their phone camera and pay by card, Apple Pay or Google Pay.</p>
            <div className="mx-auto inline-block rounded-2xl bg-white p-4" data-testid="checkout-qr">
              <QRCodeSVG value={checkout.checkoutUrl} size={220} marginSize={1} />
            </div>
            <div className="flex items-center justify-center gap-2 text-sm text-ink-400">
              <span className="size-2 animate-pulse rounded-full bg-amber-400" /> Waiting for payment…
            </div>
            <a href={checkout.checkoutUrl} target="_blank" rel="noreferrer" className="block text-xs text-ink-400 underline" data-testid="checkout-link">
              Open the payment page on this screen instead
            </a>
          </div>
        )}
      </Modal>
    );
  }

  return (
    <Modal title="Sell a membership" onClose={onClose}>
      <div className="space-y-4">
        {config && tiers.length === 0 ? <ErrorNote error="No tiers are set up for online billing yet. A superadmin can sync them with Stripe in the back office." /> : null}
        <div className="grid grid-cols-3 gap-2">
          {tiers.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setForm((f) => ({ ...f, tierId: t.id }))}
              className={`rounded-xl p-3 text-left ring-2 ${form.tierId === t.id ? "bg-flag/10 ring-flag" : "bg-ink-850 ring-ink-700"}`}
            >
              <div className="font-semibold">{t.name}</div>
              <div className="text-xs text-ink-400">{percent(t.discount_bp)} off</div>
              <div className="text-xs text-ink-400">{t.monthly_free_minutes} min/mo</div>
              <div className="mt-1 text-sm font-semibold">{money(t.monthly_price_cents)}/mo</div>
            </button>
          ))}
        </div>
        <Field label="Name">
          <Input value={form.name} onChange={set("name")} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Email" hint="Receipts and membership emails">
            <Input type="email" value={form.email} onChange={set("email")} />
          </Field>
          <Field label="Phone (optional)">
            <Input value={form.phone} onChange={set("phone")} />
          </Field>
        </div>
        <ErrorNote error={start.error} />
        <Button
          variant="primary"
          size="lg"
          className="w-full"
          disabled={start.busy || !form.name.trim() || !form.email.includes("@") || !form.tierId}
          onClick={async () => {
            const r = await start.run(() =>
              api<Checkout>("/pos/memberships/checkout", {
                body: { name: form.name.trim(), email: form.email.trim(), ...(form.phone.trim() ? { phone: form.phone.trim() } : {}), tierId: form.tierId },
              }),
            );
            if (r) setCheckout(r);
          }}
        >
          Show payment QR
        </Button>
      </div>
    </Modal>
  );
}
