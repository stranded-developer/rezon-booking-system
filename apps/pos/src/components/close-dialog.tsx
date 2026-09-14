"use client";

import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import { ApiRequestError } from "@/lib/api";
import { centsToInput, money, parseDollars, percent } from "@/lib/format";
import type { MemberSummary, Quote, Receipt, StaffTile } from "@/lib/types";
import { PrintableReceipt, ReceiptBody } from "./receipt";
import { usePos } from "./pos-provider";
import { Button, ErrorNote, Field, Input, Modal, Row } from "./ui";

/** A quote's frozen close time is honoured by the API for 2 minutes. */
const QUOTE_TTL_MS = 110_000;

type Method = "cash" | "card_terminal";

export function CloseDialog({
  sessionId,
  title,
  hasShift,
  onCancel,
  onDone,
}: {
  sessionId: string;
  title: string;
  hasShift: boolean;
  onCancel: () => void;
  onDone: () => void;
}) {
  const { api, operator } = usePos();
  const [quote, setQuote] = useState<Quote | null>(null);
  const [quotedAt, setQuotedAt] = useState(0);
  const [member, setMember] = useState<MemberSummary | null>(null);
  const [referralCode, setReferralCode] = useState<string | null>(null);
  const [freeMinutes, setFreeMinutes] = useState(0);
  const [scan, setScan] = useState("");
  const [searchResults, setSearchResults] = useState<MemberSummary[] | null>(null);
  const [method, setMethod] = useState<Method>("card_terminal");
  const [tendered, setTendered] = useState("");
  const [terminalRef, setTerminalRef] = useState("");
  const [overrideOpen, setOverrideOpen] = useState(false);
  const [overrideAmount, setOverrideAmount] = useState("");
  const [overrideReason, setOverrideReason] = useState("");
  const [approvers, setApprovers] = useState<StaffTile[]>([]);
  const [approverId, setApproverId] = useState("");
  const [approverPin, setApproverPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ receipt: Receipt; changeCents: number } | null>(null);
  const scanRef = useRef<HTMLInputElement>(null);

  const fetchQuote = useCallback(
    async (next: { memberId?: string | undefined; referralCode?: string | undefined; freeMinutes?: number }) => {
      setBusy(true);
      setError(null);
      try {
        const r = await api<{ quote: Quote }>(`/pos/sessions/${sessionId}/quote`, { body: next });
        setQuote(r.quote);
        setQuotedAt(Date.now());
        return r.quote;
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not calculate the total");
        return null;
      } finally {
        setBusy(false);
      }
    },
    [api, sessionId],
  );

  useEffect(() => {
    let cancelled = false;
    api<{ quote: Quote }>(`/pos/sessions/${sessionId}/quote`, { body: {} })
      .then((r) => {
        if (cancelled) return;
        setQuote(r.quote);
        setQuotedAt(Date.now());
      })
      .catch((err: unknown) => !cancelled && setError(err instanceof Error ? err.message : "Could not calculate the total"));
    if (operator?.role === "cashier") {
      api<{ staff: StaffTile[] }>("/pos/staff")
        .then((r) => !cancelled && setApprovers(r.staff.filter((s) => s.role === "superadmin")))
        .catch(() => undefined);
    }
    scanRef.current?.focus();
    return () => {
      cancelled = true;
    };
  }, [api, operator?.role, sessionId]);

  const current = { memberId: member?.id, referralCode: referralCode ?? undefined, freeMinutes };

  async function applyMember(m: MemberSummary) {
    setSearchResults(null);
    setScan("");
    if (!m.eligible) {
      setError(`${m.name}'s membership is ${m.status.replace("_", " ")} — no member benefits.`);
      return;
    }
    const q = await fetchQuote({ memberId: m.id });
    if (q) {
      setMember(m);
      setReferralCode(null);
      setFreeMinutes(0);
    }
  }

  async function applyReferral(code: string) {
    const q = await fetchQuote({ referralCode: code });
    if (q) {
      setReferralCode(q.referral?.code ?? code);
      setMember(null);
      setFreeMinutes(0);
      setScan("");
    }
  }

  /** USB scanners type the code and press Enter. Typed text works the same way. */
  async function onScanKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key !== "Enter") return;
    e.preventDefault();
    const value = scan.trim();
    if (!value) return;
    setError(null);
    try {
      if (value.startsWith("rg:m:")) {
        const r = await api<{ member: MemberSummary }>("/pos/members/scan", { body: { code: value } });
        await applyMember(r.member);
      } else if (/^(rg:r:)?[23456789A-Za-z]{6}$/.test(value) && !value.includes("@")) {
        await applyReferral(value);
      } else {
        const r = await api<{ members: MemberSummary[] }>(`/pos/members/search?q=${encodeURIComponent(value)}`);
        setSearchResults(r.members);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Lookup failed");
    }
  }

  const overrideCents = overrideOpen ? parseDollars(overrideAmount) : null;
  const totalCents = overrideCents ?? quote?.totalCents ?? 0;
  const tenderedCents = parseDollars(tendered);
  const needsMoney = totalCents > 0;
  const quickCash = [...new Set([totalCents, Math.ceil(totalCents / 500) * 500, Math.ceil(totalCents / 1000) * 1000, Math.ceil(totalCents / 2000) * 2000, 5000, 10000])]
    .filter((c) => c >= totalCents)
    .sort((a, b) => a - b)
    .slice(0, 5);

  const canPay =
    quote !== null &&
    !busy &&
    (!needsMoney || hasShift) &&
    (!needsMoney || method === "card_terminal" || (tenderedCents !== null && tenderedCents >= totalCents)) &&
    (!overrideOpen ||
      (overrideCents !== null &&
        overrideCents !== quote.totalCents &&
        overrideReason.trim().length >= 3 &&
        (operator?.role === "superadmin" || (approverId && /^\d{4}$/.test(approverPin)))));

  async function pay() {
    if (!quote) return;
    let q = quote;
    if (Date.now() - quotedAt > QUOTE_TTL_MS) {
      const fresh = await fetchQuote(current);
      if (!fresh) return;
      if (fresh.totalCents !== q.totalCents) {
        setNotice(`Time moved on — the total is now ${money(fresh.totalCents)}. Check it and press pay again.`);
        return;
      }
      q = fresh;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const r = await api<{ receipt: Receipt; changeCents: number }>(`/pos/sessions/${sessionId}/close`, {
        body: {
          ...current,
          closedAt: q.closedAt,
          expectedTotalCents: q.totalCents,
          tender: !needsMoney
            ? { method: "free" }
            : method === "cash"
              ? { method: "cash", tenderedCents }
              : { method: "card_terminal", ...(terminalRef.trim() ? { externalRef: terminalRef.trim() } : {}) },
          ...(overrideOpen && overrideCents !== null
            ? {
                override: {
                  totalCents: overrideCents,
                  reason: overrideReason.trim(),
                  ...(operator?.role === "cashier" ? { approver: { staffId: approverId, pin: approverPin } } : {}),
                },
              }
            : {}),
        },
      });
      setDone(r);
    } catch (err) {
      if (err instanceof ApiRequestError && (err.code === "quote_changed" || err.code === "quote_expired")) {
        const fresh = await fetchQuote(current);
        setNotice(fresh ? `The total changed to ${money(fresh.totalCents)}. Check it before taking payment.` : err.message);
      } else {
        setError(err instanceof Error ? err.message : "Payment could not be recorded");
      }
      setApproverPin("");
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <Modal title={`${title} — paid`} onClose={onDone}>
        <div className="space-y-5">
          {done.receipt.tenderedCents !== null ? (
            <div className="rounded-xl bg-flag p-4 text-center text-ink-950">
              <div className="text-sm font-semibold uppercase">Change due</div>
              <div className="tnum text-5xl font-black">{money(done.changeCents)}</div>
            </div>
          ) : null}
          <div className="rounded-xl bg-white p-4 text-black">
            <ReceiptBody receipt={done.receipt} />
          </div>
          <PrintableReceipt receipt={done.receipt} />
          <div className="flex gap-2">
            <Button className="flex-1" size="lg" onClick={() => window.print()}>
              Print receipt
            </Button>
            <Button className="flex-1" size="lg" variant="primary" onClick={onDone}>
              Done
            </Button>
          </div>
        </div>
      </Modal>
    );
  }

  return (
    <Modal title={`Close ${title}`} onClose={onCancel} wide>
      <div className="grid gap-6 md:grid-cols-2">
        <div className="space-y-5">
          <Field label="Member card, referral code or search" hint="Scan now, or type a code / name / phone and press Enter">
            <Input ref={scanRef} value={scan} onChange={(e) => setScan(e.target.value)} onKeyDown={(e) => void onScanKey(e)} placeholder="Scan or type…" />
          </Field>

          {searchResults ? (
            <div className="space-y-1 rounded-xl bg-ink-850 p-2">
              {searchResults.length === 0 ? <p className="p-2 text-sm text-ink-400">No members found</p> : null}
              {searchResults.map((m) => (
                <button key={m.id} type="button" onClick={() => void applyMember(m)} className="flex w-full justify-between rounded-lg p-2 text-left text-sm hover:bg-ink-800">
                  <span>
                    <span className="font-semibold">{m.name}</span> <span className="text-ink-400">{m.email ?? m.phone}</span>
                  </span>
                  <span className={m.eligible ? "text-emerald-300" : "text-red-300"}>{m.eligible ? m.tierName : m.status}</span>
                </button>
              ))}
            </div>
          ) : null}

          {member ? (
            <div className="rounded-xl bg-emerald-400/10 p-4 ring-1 ring-emerald-400/30">
              <div className="flex items-start justify-between">
                <div>
                  <div className="text-lg font-semibold">{member.name}</div>
                  <div className="text-sm text-emerald-200">
                    {member.tierName} · {percent(member.discountBp)} off · {member.memberNo}
                  </div>
                  <div className="mt-1 text-xs text-amber-200">Confirm the name with the customer.</div>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setMember(null);
                    setFreeMinutes(0);
                    void fetchQuote({});
                  }}
                >
                  Remove
                </Button>
              </div>
              {quote && quote.maxFreeMinutes > 0 ? (
                <div className="mt-3 flex items-end gap-2">
                  <Field label={`Free play (balance ${member.balanceMinutes} min)`}>
                    <Input
                      type="number"
                      min={0}
                      max={quote.maxFreeMinutes}
                      value={freeMinutes}
                      className="w-28"
                      onChange={(e) => setFreeMinutes(Math.max(0, Math.min(quote.maxFreeMinutes, Number(e.target.value) || 0)))}
                    />
                  </Field>
                  <Button size="md" onClick={() => void fetchQuote({ memberId: member.id, freeMinutes })}>
                    Apply
                  </Button>
                  <Button
                    size="md"
                    onClick={() => {
                      setFreeMinutes(quote.maxFreeMinutes);
                      void fetchQuote({ memberId: member.id, freeMinutes: quote.maxFreeMinutes });
                    }}
                  >
                    Use {quote.maxFreeMinutes} min
                  </Button>
                </div>
              ) : null}
            </div>
          ) : null}

          {referralCode ? (
            <div className="flex items-center justify-between rounded-xl bg-sky-400/10 p-4 ring-1 ring-sky-400/30">
              <div>
                <div className="font-semibold">Referral {referralCode}</div>
                <div className="text-sm text-sky-200">
                  {quote?.referral?.type === "percent" ? percent(quote.referral.value) : money(quote?.referral?.value)} off
                </div>
              </div>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setReferralCode(null);
                  void fetchQuote({});
                }}
              >
                Remove
              </Button>
            </div>
          ) : null}

          <div className="rounded-xl bg-ink-850 p-4">
            {quote ? (
              <div className="space-y-1.5">
                {quote.explanation.map((line, i) => {
                  const parts = line.split(/\s{2,}/);
                  return <Row key={i} label={parts.slice(0, -1).join(" ") || parts[0]} value={parts.length > 1 ? parts.at(-1) : ""} />;
                })}
              </div>
            ) : (
              <p className="text-sm text-ink-400">Calculating…</p>
            )}
          </div>
        </div>

        <div className="space-y-5">
          <div className="rounded-xl bg-ink-850 p-5 text-center">
            <div className="text-xs font-semibold uppercase tracking-widest text-ink-400">{overrideOpen && overrideCents !== null ? "Adjusted total" : "Total"}</div>
            <div className="tnum text-5xl font-black">{money(totalCents)}</div>
            {quote?.mode === "overstay" ? <div className="mt-1 text-sm text-amber-300">Overstay past the booking</div> : null}
            {quote?.mode === "prepaid" ? <div className="mt-1 text-sm text-emerald-300">Prepaid booking — nothing to pay</div> : null}
          </div>

          {needsMoney && !hasShift ? <ErrorNote error="Open the till before taking payment." /> : null}

          {needsMoney ? (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                {(["card_terminal", "cash"] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setMethod(m)}
                    className={`h-14 rounded-xl font-semibold ring-2 ${method === m ? "bg-flag text-ink-950 ring-flag" : "bg-ink-800 ring-ink-700"}`}
                  >
                    {m === "cash" ? "Cash" : "Card (CommBank)"}
                  </button>
                ))}
              </div>
              {method === "cash" ? (
                <>
                  <div className="flex flex-wrap gap-2">
                    {quickCash.map((c) => (
                      <Button key={c} size="sm" onClick={() => setTendered(centsToInput(c))}>
                        {money(c)}
                      </Button>
                    ))}
                  </div>
                  <Field label="Cash received">
                    <Input inputMode="decimal" value={tendered} onChange={(e) => setTendered(e.target.value)} placeholder="0.00" />
                  </Field>
                  {tenderedCents !== null && tenderedCents >= totalCents ? (
                    <Row label="Change" value={money(tenderedCents - totalCents)} strong />
                  ) : null}
                </>
              ) : (
                <Field label="Terminal receipt no. (optional)" hint={`Enter ${money(totalCents)} on the terminal first.`}>
                  <Input value={terminalRef} onChange={(e) => setTerminalRef(e.target.value)} />
                </Field>
              )}
            </div>
          ) : null}

          <div className="rounded-xl ring-1 ring-ink-800">
            <button type="button" onClick={() => setOverrideOpen((v) => !v)} className="flex w-full justify-between px-4 py-3 text-sm text-ink-200">
              <span>Adjust price</span>
              <span>{overrideOpen ? "−" : "+"}</span>
            </button>
            {overrideOpen ? (
              <div className="space-y-3 border-t border-ink-800 p-4">
                <Field label="New total">
                  <Input inputMode="decimal" value={overrideAmount} onChange={(e) => setOverrideAmount(e.target.value)} placeholder="0.00" />
                </Field>
                <Field label="Reason">
                  <Input value={overrideReason} onChange={(e) => setOverrideReason(e.target.value)} placeholder="e.g. cue broken, regular" />
                </Field>
                {operator?.role === "cashier" ? (
                  <div className="grid grid-cols-[1fr_7rem] gap-2">
                    <Field label="Approved by">
                      <select
                        value={approverId}
                        onChange={(e) => setApproverId(e.target.value)}
                        className="h-11 rounded-lg bg-ink-900 px-3 ring-1 ring-ink-700"
                      >
                        <option value="">Choose…</option>
                        {approvers.map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.display_name}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field label="Their PIN">
                      <Input type="password" inputMode="numeric" maxLength={4} value={approverPin} onChange={(e) => setApproverPin(e.target.value.replace(/\D/g, ""))} />
                    </Field>
                  </div>
                ) : (
                  <p className="text-xs text-ink-400">Recorded as approved by you.</p>
                )}
              </div>
            ) : null}
          </div>

          {notice ? <p className="rounded-lg bg-amber-400/10 px-3 py-2 text-sm text-amber-200">{notice}</p> : null}
          <ErrorNote error={error} />

          <Button variant="primary" size="lg" className="w-full" disabled={!canPay} onClick={() => void pay()}>
            {busy ? "Working…" : needsMoney ? `Take ${money(totalCents)} ${method === "cash" ? "cash" : "by card"}` : "Close session"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
