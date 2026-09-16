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

interface CounterSale {
  memberNo: string;
  tierName: string;
  months: number;
  amountCents: number;
  gstCents: number;
  minutesGranted: number;
  currentPeriodEnd: string;
  newMember: boolean;
  member: MemberSummary;
  card: { qr: string };
}

const MONTHS = [1, 3, 6, 9, 12] as const;

const POLL_MS = 3_000;

/**
 * Two ways to sell: the customer pays a monthly subscription on their phone (Stripe), or they pay
 * here and now in cash or on the card terminal for a set number of months (D61), which simply runs
 * out at the end.
 */
export function SellMembershipDialog({ onClose }: { onClose: () => void }) {
  const { api, config } = usePos();
  const allTiers = config?.tiers ?? [];
  const [mode, setMode] = useState<"online" | "counter">("online");
  // Paying at the counter needs no Stripe, so every active tier can be sold that way.
  const tiers = mode === "online" ? allTiers.filter((t) => t.sellable) : allTiers;
  const start = useAction();
  const counter = useAction();
  const card = useAction();
  const [months, setMonths] = useState<number>(1);
  const [method, setMethod] = useState<"cash" | "card_terminal">("cash");
  const [sale, setSale] = useState<CounterSale | null>(null);
  const [form, setForm] = useState({ name: "", email: "", phone: "", tierId: "" });
  const [checkout, setCheckout] = useState<Checkout | null>(null);
  const [member, setMember] = useState<MemberSummary | null>(null);
  const [hasCard, setHasCard] = useState(false);
  const [qr, setQr] = useState<string | null>(null);
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const chosenTier = tiers.find((t) => t.id === form.tierId) ?? null;

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

  if (sale) {
    return (
      <Modal title="Membership paid" onClose={onClose}>
        <div className="space-y-4" data-testid="counter-sale-done">
          <div className="rounded-xl bg-emerald-400/10 p-5 text-center ring-1 ring-emerald-400/30">
            <div className="text-3xl">✓</div>
            <div className="mt-1 text-lg font-semibold">{sale.member.name}</div>
            <div className="text-sm text-emerald-200">
              {sale.tierName} · {sale.memberNo}
            </div>
            <div className="mt-2 text-sm">
              {money(sale.amountCents)} taken ({method === "cash" ? "cash" : "card"}) · GST {money(sale.gstCents)}
            </div>
            <div className="text-sm">
              {sale.minutesGranted} min free play · runs until {new Date(sale.currentPeriodEnd).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" })}
            </div>
          </div>
          <p className="text-sm text-ink-400">
            This membership is not billed automatically. It stops on the date above unless it is sold again.
          </p>
          <MemberCard qr={sale.card.qr} name={sale.member.name} memberNo={sale.memberNo} />
        </div>
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
        <div className="grid grid-cols-2 gap-2" role="group" aria-label="How they pay">
          <button
            type="button"
            onClick={() => setMode("online")}
            aria-pressed={mode === "online"}
            className={`rounded-xl p-3 text-left ring-2 ${mode === "online" ? "bg-flag/10 ring-flag" : "bg-ink-850 ring-ink-700"}`}
          >
            <div className="font-semibold">On their phone</div>
            <div className="text-xs text-ink-400">Monthly subscription, renews itself</div>
          </button>
          <button
            type="button"
            onClick={() => setMode("counter")}
            aria-pressed={mode === "counter"}
            className={`rounded-xl p-3 text-left ring-2 ${mode === "counter" ? "bg-flag/10 ring-flag" : "bg-ink-850 ring-ink-700"}`}
          >
            <div className="font-semibold">At the counter</div>
            <div className="text-xs text-ink-400">Cash or card terminal, runs out at the end</div>
          </button>
        </div>
        {config && tiers.length === 0 ? (
          <ErrorNote
            error={
              mode === "online"
                ? "No tiers are set up for online billing yet. A superadmin can sync them with Stripe in the back office."
                : "No active membership tiers yet."
            }
          />
        ) : null}
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
        {mode === "counter" ? (
          <>
            <fieldset>
              <legend className="text-xs font-medium uppercase tracking-wide text-ink-400">How many months</legend>
              <div className="mt-2 flex flex-wrap gap-2">
                {MONTHS.map((m) => (
                  <Button key={m} size="sm" variant={m === months ? "primary" : "secondary"} aria-pressed={m === months} onClick={() => setMonths(m)}>
                    {m} {m === 1 ? "month" : "months"}
                  </Button>
                ))}
              </div>
            </fieldset>
            <fieldset>
              <legend className="text-xs font-medium uppercase tracking-wide text-ink-400">Paying by</legend>
              <div className="mt-2 flex gap-2">
                <Button size="sm" variant={method === "cash" ? "primary" : "secondary"} aria-pressed={method === "cash"} onClick={() => setMethod("cash")}>
                  Cash
                </Button>
                <Button
                  size="sm"
                  variant={method === "card_terminal" ? "primary" : "secondary"}
                  aria-pressed={method === "card_terminal"}
                  onClick={() => setMethod("card_terminal")}
                >
                  Card terminal
                </Button>
              </div>
            </fieldset>
          </>
        ) : null}
        <Field label="Name">
          <Input value={form.name} onChange={set("name")} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={mode === "counter" ? "Email (or phone)" : "Email"} hint="Receipts and membership emails">
            <Input type="email" value={form.email} onChange={set("email")} />
          </Field>
          <Field label="Phone (optional)">
            <Input value={form.phone} onChange={set("phone")} />
          </Field>
        </div>
        <ErrorNote error={start.error ?? counter.error} />
        {mode === "counter" ? (
          <>
            {chosenTier ? (
              <div className="flex items-baseline justify-between rounded-xl bg-ink-850 px-4 py-3">
                <span className="text-sm text-ink-200">
                  {chosenTier.name} · {months} {months === 1 ? "month" : "months"}
                </span>
                <span className="text-lg font-bold">{money(chosenTier.monthly_price_cents * months)}</span>
              </div>
            ) : null}
            <Button
              variant="primary"
              size="lg"
              className="w-full"
              disabled={counter.busy || !form.name.trim() || (!form.email.includes("@") && !form.phone.trim()) || !form.tierId}
              onClick={async () => {
                const r = await counter.run(() =>
                  api<CounterSale>("/pos/memberships/counter", {
                    body: {
                      name: form.name.trim(),
                      ...(form.email.trim() ? { email: form.email.trim() } : {}),
                      ...(form.phone.trim() ? { phone: form.phone.trim() } : {}),
                      tierId: form.tierId,
                      months,
                      method,
                    },
                  }),
                );
                if (r) setSale(r);
              }}
            >
              {chosenTier ? `Take ${money(chosenTier.monthly_price_cents * months)}` : "Take payment"}
            </Button>
          </>
        ) : (
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
        )}
      </div>
    </Modal>
  );
}
