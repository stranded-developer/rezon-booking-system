"use client";

import { useEffect, useState } from "react";
import { money, parseDollars } from "@/lib/format";
import type { ShiftReport } from "@/lib/types";
import { usePos } from "./pos-provider";
import { Button, ErrorNote, Field, Input, Modal, Row } from "./ui";

export function ShiftDialog({ onClose, onChanged }: { onClose: () => void; onChanged: () => void }) {
  const { api, config } = usePos();
  const tz = config?.timeZone ?? "Australia/Sydney";
  const [report, setReport] = useState<ShiftReport | null | undefined>(undefined);
  const [closedReport, setClosedReport] = useState<ShiftReport | null>(null);
  const [float, setFloat] = useState("200.00");
  const [movementKind, setMovementKind] = useState<"paid_in" | "paid_out">("paid_out");
  const [movementAmount, setMovementAmount] = useState("");
  const [movementReason, setMovementReason] = useState("");
  const [counted, setCounted] = useState("");
  const [terminal, setTerminal] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let cancelled = false;
    api<{ shift: ShiftReport | null }>("/pos/shifts/current")
      .then((r) => !cancelled && setReport(r.shift))
      .catch((err: unknown) => !cancelled && setError(err instanceof Error ? err.message : "Could not load the shift"));
    return () => {
      cancelled = true;
    };
  }, [api, version]);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      onChanged();
      setVersion((v) => v + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  const time = (iso: string) =>
    new Intl.DateTimeFormat("en-AU", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23", day: "numeric", month: "short" }).format(new Date(iso));

  if (closedReport) {
    return (
      <Modal title="Shift closed" onClose={onClose} wide>
        <ReportView report={closedReport} time={time} />
        <div className="mt-5 flex gap-2">
          <Button className="flex-1" onClick={() => window.print()}>
            Print
          </Button>
          <Button className="flex-1" variant="primary" onClick={onClose}>
            Done
          </Button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal title={report ? "Till" : "Open the till"} onClose={onClose} wide>
      {report === undefined ? <p className="text-ink-400">Loading…</p> : null}

      {report === null ? (
        <div className="space-y-4">
          <p className="text-sm text-ink-400">Count the cash in the drawer before the first sale.</p>
          <Field label="Opening float">
            <Input inputMode="decimal" value={float} onChange={(e) => setFloat(e.target.value)} />
          </Field>
          <ErrorNote error={error} />
          <Button
            variant="primary"
            size="lg"
            className="w-full"
            disabled={busy || parseDollars(float) === null}
            onClick={() => void run(async () => void (await api("/pos/shifts/open", { body: { openingFloatCents: parseDollars(float) } })))}
          >
            Open till with {money(parseDollars(float))}
          </Button>
        </div>
      ) : null}

      {report ? (
        <div className="grid gap-6 md:grid-cols-2">
          <ReportView report={report} time={time} />
          <div className="space-y-6">
            <div className="space-y-3 rounded-xl bg-ink-850 p-4">
              <h3 className="font-semibold">Cash in / out</h3>
              <div className="grid grid-cols-2 gap-2">
                {(["paid_out", "paid_in"] as const).map((k) => (
                  <Button key={k} variant={movementKind === k ? "primary" : "secondary"} onClick={() => setMovementKind(k)}>
                    {k === "paid_out" ? "Paid out" : "Paid in"}
                  </Button>
                ))}
              </div>
              <Field label="Amount">
                <Input inputMode="decimal" value={movementAmount} onChange={(e) => setMovementAmount(e.target.value)} placeholder="0.00" />
              </Field>
              <Field label="Reason">
                <Input value={movementReason} onChange={(e) => setMovementReason(e.target.value)} placeholder="e.g. cleaning supplies" />
              </Field>
              <Button
                className="w-full"
                disabled={busy || !parseDollars(movementAmount) || movementReason.trim().length === 0}
                onClick={() =>
                  void run(async () => {
                    await api("/pos/shifts/current/movements", {
                      body: { kind: movementKind, amountCents: parseDollars(movementAmount), reason: movementReason.trim() },
                    });
                    setMovementAmount("");
                    setMovementReason("");
                  })
                }
              >
                Record {movementKind === "paid_out" ? "paid out" : "paid in"}
              </Button>
            </div>

            <div className="space-y-3 rounded-xl bg-ink-850 p-4">
              <h3 className="font-semibold">Close the till</h3>
              <Field label="Cash counted in drawer">
                <Input inputMode="decimal" value={counted} onChange={(e) => setCounted(e.target.value)} placeholder="0.00" />
              </Field>
              <Field label="CommBank terminal end-of-day total">
                <Input inputMode="decimal" value={terminal} onChange={(e) => setTerminal(e.target.value)} placeholder="0.00" />
              </Field>
              <ErrorNote error={error} />
              <Button
                variant="primary"
                className="w-full"
                disabled={busy || parseDollars(counted) === null || parseDollars(terminal) === null}
                onClick={() =>
                  void run(async () => {
                    const r = await api<{ report: ShiftReport }>("/pos/shifts/current/close", {
                      body: { countedCashCents: parseDollars(counted), terminalCardTotalCents: parseDollars(terminal) },
                    });
                    setClosedReport(r.report);
                  })
                }
              >
                Close till
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </Modal>
  );
}

export function ReportView({ report, time }: { report: ShiftReport; time: (iso: string) => string }) {
  const minus = (cents: number) => (cents > 0 ? `−${money(cents)}` : money(0));
  const variance = (cents: number | null) =>
    cents === null ? "—" : <span className={cents === 0 ? "text-emerald-300" : "text-red-300"}>{cents > 0 ? `+${money(cents)}` : money(cents)}</span>;
  return (
    <div className="space-y-4">
      <div className="text-sm text-ink-400">
        Opened {time(report.shift.openedAt)} by {report.shift.openedBy}
        {report.shift.closedAt ? ` · closed ${time(report.shift.closedAt)} by ${report.shift.closedBy}` : ""}
        {report.shift.flagged ? <span className="ml-2 font-semibold text-red-300">Flagged for review</span> : null}
      </div>
      <div className="space-y-1.5 rounded-xl bg-ink-850 p-4">
        <Row label="Sessions closed" value={report.sessionsClosed} />
        <Row label="Voided" value={report.sessionsVoided} />
        <Row label="Takings" value={money(report.grossCents)} strong />
        <Row label="Card" value={money(report.tender.cardCents)} />
        <Row label="Cash" value={money(report.tender.cashCents)} />
        <Row label="Refunds" value={money(report.refundsCents)} />
      </div>
      <div className="space-y-1.5 rounded-xl bg-ink-850 p-4">
        <Row label="Opening float" value={money(report.cash.openingFloatCents)} />
        <Row label="Cash sales" value={money(report.cash.salesCents)} />
        <Row label="Cash refunds" value={minus(report.cash.refundsCents)} />
        <Row label="Paid in / out" value={`${money(report.cash.paidInCents)} / ${minus(report.cash.paidOutCents)}`} />
        <Row label="Expected in drawer" value={money(report.cash.expectedCents)} strong />
        {report.cash.countedCents !== null ? <Row label="Counted" value={money(report.cash.countedCents)} /> : null}
        {report.cash.varianceCents !== null ? <Row label="Cash variance" value={variance(report.cash.varianceCents)} /> : null}
      </div>
      <div className="space-y-1.5 rounded-xl bg-ink-850 p-4">
        <Row label="Card total (POS)" value={money(report.card.posTotalCents)} strong />
        {report.card.terminalTotalCents !== null ? <Row label="Terminal total" value={money(report.card.terminalTotalCents)} /> : null}
        {report.card.varianceCents !== null ? <Row label="Card variance" value={variance(report.card.varianceCents)} /> : null}
      </div>
      <div className="space-y-1.5 rounded-xl bg-ink-850 p-4">
        <Row label="Happy hour discounts" value={money(report.discounts.happyHourCents)} />
        <Row label="Member discounts" value={money(report.discounts.memberCents)} />
        <Row label="Referral discounts" value={money(report.discounts.referralCents)} />
        <Row label="Price adjustments" value={money(report.discounts.overrideCents)} />
        <Row label="Free play used" value={`${report.freeMinutesUsed} min`} />
      </div>
    </div>
  );
}
