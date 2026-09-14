"use client";

import { useState } from "react";
import { Badge, Card, PageHeader, Table, Td, useAction, useApiData } from "@/components/admin/kit";
import { usePos } from "@/components/pos-provider";
import { PrintableReceipt, ReceiptBody } from "@/components/receipt";
import { Button, ErrorNote, Field, Input, Modal } from "@/components/ui";
import { money, parseDollars, timeIn } from "@/lib/format";
import type { Receipt } from "@/lib/types";

interface Sale {
  sessionId: string;
  kind: string;
  status: "closed" | "voided";
  resource: string;
  openedAt: string;
  closedAt: string;
  totalCents: number;
  voidReason: string | null;
  closedBy: string | null;
  overridden: boolean;
  bookingRef: string | null;
  payment: { id: string; method: string; amountCents: number; receiptNo: number; refundedCents: number } | null;
}

const METHOD: Record<string, string> = { cash: "Cash", card_terminal: "Card", free: "Free", stripe: "Online" };

export default function SalesPage() {
  const { config } = usePos();
  const tz = config?.timeZone ?? "Australia/Sydney";
  const [date, setDate] = useState("");
  const { data, error, reload } = useApiData<{ date: string; sales: Sale[] }>(`/admin/sales${date ? `?date=${date}` : ""}`);
  const [selected, setSelected] = useState<Sale | null>(null);

  const sales = data?.sales ?? [];
  const closed = sales.filter((s) => s.status === "closed");
  const takings = closed.reduce((a, s) => a + (s.payment?.amountCents ?? 0) - (s.payment?.refundedCents ?? 0), 0);

  return (
    <>
      <PageHeader
        title="Sales"
        description="Every closed or voided session for a day. Open a sale to reprint its receipt, refund part of it or void it."
        actions={<Input type="date" aria-label="Day" value={date || data?.date || ""} onChange={(e) => setDate(e.target.value)} />}
      />
      <ErrorNote error={error} />
      <div className="mb-4 grid grid-cols-3 gap-3">
        {[
          ["Sales", closed.length],
          ["Takings after refunds", money(takings)],
          ["Voided", sales.length - closed.length],
        ].map(([label, value]) => (
          <div key={label} className="rounded-2xl bg-ink-900 p-4 ring-1 ring-ink-800">
            <div className="text-xs uppercase tracking-wide text-ink-400">{label}</div>
            <div className="tnum mt-1 text-2xl font-bold">{value}</div>
          </div>
        ))}
      </div>
      <Card>
        <Table head={["Time", "Receipt", "Resource", "Total", "Paid by", "Refunded", "Staff", ""]} empty={data !== null && sales.length === 0}>
          {sales.map((s) => (
            <tr key={s.sessionId} className="cursor-pointer hover:bg-ink-850" onClick={() => setSelected(s)}>
              <Td className="tnum">{timeIn(s.closedAt, tz)}</Td>
              <Td className="tnum">{s.payment?.receiptNo ?? "—"}</Td>
              <Td>
                {s.resource}
                {s.bookingRef ? <span className="ml-1 text-xs text-ink-400">booking {s.bookingRef}</span> : null}
              </Td>
              <Td className="tnum font-semibold">{money(s.totalCents)}</Td>
              <Td>{s.payment ? METHOD[s.payment.method] : "Prepaid"}</Td>
              <Td className="tnum">{s.payment?.refundedCents ? money(s.payment.refundedCents) : "—"}</Td>
              <Td>{s.closedBy}</Td>
              <Td>
                {s.status === "voided" ? <Badge tone="red">Voided</Badge> : null}
                {s.overridden ? <Badge tone="amber">Adjusted</Badge> : null}
              </Td>
            </tr>
          ))}
        </Table>
      </Card>
      {selected ? (
        <SaleDialog
          sale={selected}
          onClose={() => setSelected(null)}
          onChanged={() => {
            setSelected(null);
            reload();
          }}
        />
      ) : null}
    </>
  );
}

function SaleDialog({ sale, onClose, onChanged }: { sale: Sale; onClose: () => void; onChanged: () => void }) {
  const { api } = usePos();
  const { data } = useApiData<{ receipt: Receipt }>(`/pos/sessions/${sale.sessionId}/receipt`);
  const refundAction = useAction();
  const voidAction = useAction();
  const [amount, setAmount] = useState("");
  const [refundReason, setRefundReason] = useState("");
  const [voidReason, setVoidReason] = useState("");
  const refundable = sale.payment && ["cash", "card_terminal"].includes(sale.payment.method) ? sale.payment.amountCents - sale.payment.refundedCents : 0;
  const amountCents = parseDollars(amount);

  return (
    <Modal title={`Sale · ${sale.resource}`} onClose={onClose} wide>
      <div className="grid gap-6 md:grid-cols-2">
        <div>
          {data ? (
            <>
              <div className="rounded-xl bg-white p-4 text-black">
                <ReceiptBody receipt={data.receipt} />
              </div>
              <PrintableReceipt receipt={data.receipt} />
              <Button className="mt-3 w-full" onClick={() => window.print()}>
                Reprint receipt
              </Button>
            </>
          ) : (
            <p className="text-ink-400">Loading receipt…</p>
          )}
        </div>
        <div className="space-y-6">
          {sale.status === "voided" ? (
            <p className="rounded-lg bg-red-500/10 p-3 text-sm text-red-200">Voided: {sale.voidReason}</p>
          ) : (
            <>
              {refundable > 0 ? (
                <div className="space-y-3 rounded-xl bg-ink-850 p-4">
                  <h3 className="font-semibold">Refund part of this sale</h3>
                  <p className="text-sm text-ink-400">Up to {money(refundable)}. Give cash back from the till or refund on the CommBank terminal.</p>
                  <Field label="Amount">
                    <Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" />
                  </Field>
                  <Field label="Reason">
                    <Input value={refundReason} onChange={(e) => setRefundReason(e.target.value)} placeholder="e.g. controller fault" />
                  </Field>
                  <ErrorNote error={refundAction.error} />
                  <Button
                    className="w-full"
                    disabled={refundAction.busy || !amountCents || amountCents > refundable || refundReason.trim().length < 3}
                    onClick={async () => {
                      const ok = await refundAction.run(() =>
                        api(`/admin/payments/${sale.payment!.id}/refund`, { body: { amountCents, reason: refundReason.trim() } }),
                      );
                      if (ok) onChanged();
                    }}
                  >
                    Refund {amountCents ? money(amountCents) : ""}
                  </Button>
                </div>
              ) : null}
              <div className="space-y-3 rounded-xl bg-ink-850 p-4">
                <h3 className="font-semibold">Void this sale</h3>
                <p className="text-sm text-ink-400">Refunds what is left of the payment and returns any free-play minutes used.</p>
                <Field label="Reason">
                  <Input value={voidReason} onChange={(e) => setVoidReason(e.target.value)} placeholder="e.g. charged the wrong table" />
                </Field>
                <ErrorNote error={voidAction.error} />
                <Button
                  variant="danger"
                  className="w-full"
                  disabled={voidAction.busy || voidReason.trim().length < 3}
                  onClick={async () => {
                    const ok = await voidAction.run(() => api(`/admin/sales/${sale.sessionId}/void`, { body: { reason: voidReason.trim() } }));
                    if (ok) onChanged();
                  }}
                >
                  Void sale
                </Button>
              </div>
            </>
          )}
        </div>
      </div>
    </Modal>
  );
}
