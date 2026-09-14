"use client";

import { money } from "@/lib/format";
import type { Receipt } from "@/lib/types";

const METHOD_LABEL: Record<string, string> = { cash: "Cash", card_terminal: "Card", free: "No charge", stripe: "Paid online" };

/** Receipt body used both on screen and for the 80 mm print layout. */
export function ReceiptBody({ receipt }: { receipt: Receipt }) {
  return (
    <div className="space-y-2 font-mono text-[12px] leading-snug">
      <div className="text-center">
        <div className="text-sm font-bold uppercase">{receipt.businessName}</div>
        {receipt.abn ? <div>ABN {receipt.abn}</div> : null}
        <div className="font-bold">{receipt.voided ? `VOIDED ${receipt.title.toUpperCase()}` : receipt.title.toUpperCase()}</div>
        <div>
          {receipt.receiptNo ? `No. ${receipt.receiptNo} · ` : ""}
          {receipt.issuedAt}
        </div>
      </div>
      <div className="border-t border-dashed border-current pt-2">
        <div>
          {receipt.resource} ({receipt.resourceType})
        </div>
        <div>
          {receipt.openedAt.slice(11)} – {receipt.closedAt.slice(11)} · {receipt.closedAt.slice(0, 10)}
        </div>
        {receipt.memberNo ? <div>Member {receipt.memberNo}</div> : null}
      </div>
      <div className="space-y-0.5 border-t border-dashed border-current pt-2">
        {receipt.lines.map((line, i) => {
          const parts = line.split(/\s{2,}/);
          return (
            <div key={i} className="flex justify-between gap-2">
              <span>{parts.slice(0, -1).join(" ") || parts[0]}</span>
              {parts.length > 1 ? <span className="whitespace-nowrap">{parts.at(-1)}</span> : null}
            </div>
          );
        })}
      </div>
      {receipt.override ? (
        <div className="border-t border-dashed border-current pt-2">
          <div className="flex justify-between">
            <span>Price adjusted from</span>
            <span>{money(receipt.override.originalCents)}</span>
          </div>
          <div>Reason: {receipt.override.reason}</div>
        </div>
      ) : null}
      <div className="border-t border-dashed border-current pt-2">
        <div className="flex justify-between text-sm font-bold">
          <span>TOTAL</span>
          <span>{money(receipt.totalCents)}</span>
        </div>
        <div className="flex justify-between">
          <span>Includes GST</span>
          <span>{money(receipt.gstCents)}</span>
        </div>
        <div className="flex justify-between">
          <span>Paid by</span>
          <span>{receipt.paymentMethod ? (METHOD_LABEL[receipt.paymentMethod] ?? receipt.paymentMethod) : "Prepaid booking"}</span>
        </div>
        {receipt.tenderedCents !== null ? (
          <>
            <div className="flex justify-between">
              <span>Cash received</span>
              <span>{money(receipt.tenderedCents)}</span>
            </div>
            <div className="flex justify-between">
              <span>Change</span>
              <span>{money(receipt.changeCents)}</span>
            </div>
          </>
        ) : null}
      </div>
      <div className="border-t border-dashed border-current pt-2 text-center">
        {receipt.servedBy ? <div>Served by {receipt.servedBy}</div> : null}
        <div>Thanks for racing with us</div>
      </div>
    </div>
  );
}

/** Renders the receipt into the print-only area; call window.print() to print it. */
export function PrintableReceipt({ receipt }: { receipt: Receipt }) {
  return (
    <div className="print-only">
      <ReceiptBody receipt={receipt} />
    </div>
  );
}
