"use client";

import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import { ApiRequestError } from "@/lib/api";
import { centsToInput, money, parseDollars, percent, timeIn } from "@/lib/format";
import type { CounterPackage, MemberSummary, PackageQuote, Receipt } from "@/lib/types";
import { PrintableReceipt, ReceiptBody } from "./receipt";
import { usePos } from "./pos-provider";
import { Button, ErrorNote, Field, Input, Modal, Row } from "./ui";

type Method = "cash" | "card_terminal";

/**
 * A walk-in package (D115): a set length at the package's price, paid now, before the table starts.
 * Priced like an online booking — promotions, the member's price, free play in whole sessions, or a
 * referral code — and closed later with nothing more to pay. Or paid at the end (D116): the table
 * starts now, and the close screen charges the package's price, with the member card or code given then.
 */
export function PackageDialog({
  resourceId,
  title,
  pkg,
  hasShift,
  onCancel,
  onDone,
}: {
  resourceId: string;
  title: string;
  pkg: CounterPackage;
  hasShift: boolean;
  onCancel: () => void;
  onDone: () => void;
}) {
  const { api, config } = usePos();
  const tz = config?.timeZone ?? "Australia/Sydney";
  const [quote, setQuote] = useState<PackageQuote | null>(null);
  const [member, setMember] = useState<MemberSummary | null>(null);
  const [referralCode, setReferralCode] = useState<string | null>(null);
  const [freeMinutes, setFreeMinutes] = useState(0);
  const [claimed, setClaimed] = useState<string[]>([]);
  const [scan, setScan] = useState("");
  const [searchResults, setSearchResults] = useState<MemberSummary[] | null>(null);
  const [method, setMethod] = useState<Method>("card_terminal");
  const [tendered, setTendered] = useState("");
  const [terminalRef, setTerminalRef] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [payAtEnd, setPayAtEnd] = useState(false);
  const [done, setDone] = useState<{ receipt: Receipt | null; changeCents: number; endsAt: string } | null>(null);
  const scanRef = useRef<HTMLInputElement>(null);

  type Options = { memberId?: string | undefined; referralCode?: string | undefined; freeMinutes?: number; claimedPromoIds?: string[] };
  const fetchQuote = useCallback(
    async (next: Options) => {
      setBusy(true);
      setError(null);
      try {
        const r = await api<{ quote: PackageQuote }>("/pos/packages/quote", { body: { resourceId, experienceId: pkg.id, ...next } });
        setQuote(r.quote);
        return r.quote;
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not price the package");
        return null;
      } finally {
        setBusy(false);
      }
    },
    [api, pkg.id, resourceId],
  );

  useEffect(() => {
    let cancelled = false;
    api<{ quote: PackageQuote }>("/pos/packages/quote", { body: { resourceId, experienceId: pkg.id } })
      .then((r) => !cancelled && setQuote(r.quote))
      .catch((err: unknown) => !cancelled && setError(err instanceof Error ? err.message : "Could not price the package"));
    scanRef.current?.focus();
    return () => {
      cancelled = true;
    };
  }, [api, pkg.id, resourceId]);

  const current: Options = { memberId: member?.id, referralCode: referralCode ?? undefined, freeMinutes, claimedPromoIds: claimed };

  async function applyMember(m: MemberSummary) {
    setSearchResults(null);
    setScan("");
    if (!m.eligible) {
      setError(`${m.name}'s membership is ${m.status.replace("_", " ")} — no member benefits.`);
      return;
    }
    if (await fetchQuote({ memberId: m.id, claimedPromoIds: claimed })) {
      setMember(m);
      setReferralCode(null);
      setFreeMinutes(0);
    }
  }

  async function applyReferral(code: string) {
    const q = await fetchQuote({ referralCode: code, claimedPromoIds: claimed });
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

  const totalCents = quote?.totalCents ?? 0;
  const tenderedCents = parseDollars(tendered);
  const needsMoney = totalCents > 0;
  const quickCash = [...new Set([totalCents, Math.ceil(totalCents / 500) * 500, Math.ceil(totalCents / 1000) * 1000, Math.ceil(totalCents / 2000) * 2000, 5000, 10000])]
    .filter((c) => c >= totalCents)
    .sort((a, b) => a - b)
    .slice(0, 5);
  const canPay =
    quote !== null &&
    !busy &&
    (payAtEnd || ((!needsMoney || hasShift) && (!needsMoney || method === "card_terminal" || (tenderedCents !== null && tenderedCents >= totalCents))));

  /** D116: the member card, code and free play are given at the end, so switching clears them. */
  function choosePayAtEnd(next: boolean) {
    if (next === payAtEnd) return;
    setPayAtEnd(next);
    if (next && (member || referralCode || freeMinutes || claimed.length)) {
      setMember(null);
      setReferralCode(null);
      setFreeMinutes(0);
      setClaimed([]);
      void fetchQuote({});
    }
  }

  async function pay() {
    if (!quote) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const r = await api<{ receipt: Receipt | null; changeCents: number; endsAt: string }>("/pos/packages", {
        body: payAtEnd ? { resourceId, experienceId: pkg.id, payAtEnd: true } : {
          resourceId,
          experienceId: pkg.id,
          ...current,
          expectedTotalCents: quote.totalCents,
          tender: !needsMoney
            ? { method: "free" }
            : method === "cash"
              ? { method: "cash", tenderedCents }
              : { method: "card_terminal", ...(terminalRef.trim() ? { externalRef: terminalRef.trim() } : {}) },
        },
      });
      setDone(r);
    } catch (err) {
      if (err instanceof ApiRequestError && err.code === "quote_changed") {
        const fresh = await fetchQuote(current);
        setNotice(fresh ? `The price changed to ${money(fresh.totalCents)}. Check it before taking payment.` : err.message);
      } else {
        setError(err instanceof Error ? err.message : "Payment could not be recorded");
      }
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <Modal title={`${title} — ${pkg.name} started`} onClose={onDone}>
        <div className="space-y-5" data-testid="package-started">
          {done.receipt && done.receipt.tenderedCents !== null ? (
            <div className="rounded-xl bg-flag p-4 text-center text-ink-950">
              <div className="text-sm font-semibold uppercase">Change due</div>
              <div className="tnum text-5xl font-black">{money(done.changeCents)}</div>
            </div>
          ) : null}
          <p className="rounded-xl bg-ink-850 p-4 text-center text-lg">
            Time is up at <span className="font-bold">{timeIn(done.endsAt, tz)}</span>
            {done.receipt ? null : <span className="mt-1 block text-sm text-ink-200">They pay when they finish — tap the table and Close &amp; pay.</span>}
          </p>
          {done.receipt ? (
            <>
              <div className="rounded-xl bg-white p-4 text-black">
                <ReceiptBody receipt={done.receipt} />
              </div>
              <PrintableReceipt receipt={done.receipt} />
            </>
          ) : null}
          <div className="flex gap-2">
            {done.receipt ? (
              <Button className="flex-1" size="lg" onClick={() => window.print()}>
                Print receipt
              </Button>
            ) : null}
            <Button className="flex-1" size="lg" variant="primary" onClick={onDone}>
              Done
            </Button>
          </div>
        </div>
      </Modal>
    );
  }

  const step = quote?.freeStepMinutes ?? 30;
  return (
    <Modal title={`${title} · ${pkg.name}`} onClose={onCancel} wide>
      <div className="grid gap-6 md:grid-cols-2">
        <div className="space-y-5">
          {payAtEnd ? (
            <p className="rounded-xl bg-ink-850 p-4 text-sm text-ink-200">Member card, referral code, free play or a student price are given when the table closes.</p>
          ) : (
          <>
          <Field label="Member card, referral code or search" hint="Optional. Scan, or type a code / name / phone and press Enter">
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
                    void fetchQuote({ claimedPromoIds: claimed });
                  }}
                >
                  Remove
                </Button>
              </div>
              {quote && quote.maxFreeMinutes >= step ? (
                <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="Free play">
                  {Array.from({ length: quote.maxFreeMinutes / step + 1 }, (_, i) => i * step).map((m) => (
                    <Button
                      key={m}
                      size="sm"
                      variant={m === freeMinutes ? "primary" : "secondary"}
                      aria-pressed={m === freeMinutes}
                      onClick={() => {
                        setFreeMinutes(m);
                        void fetchQuote({ memberId: member.id, freeMinutes: m, claimedPromoIds: claimed });
                      }}
                    >
                      {m === 0 ? "No free play" : `${m} min free`}
                    </Button>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}

          {referralCode ? (
            <div className="flex items-center justify-between rounded-xl bg-sky-400/10 p-4 ring-1 ring-sky-400/30">
              <div className="font-semibold">Referral {referralCode}</div>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setReferralCode(null);
                  void fetchQuote({ claimedPromoIds: claimed });
                }}
              >
                Remove
              </Button>
            </div>
          ) : null}

          {quote && quote.claimablePromos.length > 0 ? (
            <fieldset>
              <legend className="text-xs font-medium uppercase tracking-wide text-ink-400">Prices they can ask for</legend>
              <div className="mt-2 flex flex-wrap gap-2">
                {quote.claimablePromos.map((p) => {
                  const on = claimed.includes(p.id);
                  return (
                    <Button
                      key={p.id}
                      size="sm"
                      variant={on ? "primary" : "secondary"}
                      aria-pressed={on}
                      onClick={() => {
                        const next = on ? claimed.filter((id) => id !== p.id) : [...claimed, p.id];
                        setClaimed(next);
                        void fetchQuote({ ...current, claimedPromoIds: next });
                      }}
                    >
                      {p.name} {money(p.priceCents)}
                    </Button>
                  );
                })}
              </div>
            </fieldset>
          ) : null}
          </>
          )}

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
          <div className="grid grid-cols-2 gap-2" role="group" aria-label="When they pay">
            {([false, true] as const).map((later) => (
              <button
                key={String(later)}
                type="button"
                aria-pressed={payAtEnd === later}
                onClick={() => choosePayAtEnd(later)}
                className={`h-12 rounded-xl font-semibold ring-2 ${payAtEnd === later ? "bg-flag text-ink-950 ring-flag" : "bg-ink-800 ring-ink-700"}`}
              >
                {later ? "Pay at the end" : "Pay now"}
              </button>
            ))}
          </div>

          <div className="rounded-xl bg-ink-850 p-5 text-center">
            <div className="text-xs font-semibold uppercase tracking-widest text-ink-400">{payAtEnd ? "To pay at the end" : "Pay now"}</div>
            <div className="tnum text-5xl font-black" data-testid="package-total">
              {money(totalCents)}
            </div>
            {quote ? (
              <div className="mt-1 text-sm text-ink-200">
                Until {timeIn(quote.endsAt, tz)} if started now · {payAtEnd ? "nothing extra for running over" : "nothing to pay at the end"}
              </div>
            ) : null}
          </div>

          {!payAtEnd && needsMoney && !hasShift ? <ErrorNote error="Open the till before taking payment." /> : null}

          {!payAtEnd && needsMoney ? (
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
                  {tenderedCents !== null && tenderedCents >= totalCents ? <Row label="Change" value={money(tenderedCents - totalCents)} strong /> : null}
                </>
              ) : (
                <Field label="Terminal receipt no. (optional)" hint={`Enter ${money(totalCents)} on the terminal first.`}>
                  <Input value={terminalRef} onChange={(e) => setTerminalRef(e.target.value)} />
                </Field>
              )}
            </div>
          ) : null}

          {notice ? <p className="rounded-lg bg-amber-400/10 px-3 py-2 text-sm text-amber-200">{notice}</p> : null}
          <ErrorNote error={error} />

          <Button variant="primary" size="lg" className="w-full" disabled={!canPay} onClick={() => void pay()}>
            {busy ? "Working…" : payAtEnd ? "Start — pay at the end" : needsMoney ? `Take ${money(totalCents)} ${method === "cash" ? "cash" : "by card"} and start` : "Start"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
