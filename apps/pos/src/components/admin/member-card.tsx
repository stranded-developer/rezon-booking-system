"use client";

import { QRCodeSVG } from "qrcode.react";
import { Button } from "../ui";

export function MemberCard({ qr, name, memberNo }: { qr: string; name: string; memberNo: string }) {
  return (
    <div className="space-y-3 text-center">
      <div className="mx-auto inline-block rounded-2xl bg-white p-4" data-testid="member-qr">
        <QRCodeSVG value={qr} size={196} marginSize={1} />
      </div>
      <div>
        <div className="font-semibold">{name}</div>
        <div className="text-sm text-ink-400">{memberNo}</div>
      </div>
      <p className="text-xs text-amber-200">This code is shown once. Print it or have the member take a photo; it can be reissued any time.</p>
      <div className="print-only">
        <div style={{ textAlign: "center" }}>
          <QRCodeSVG value={qr} size={220} marginSize={1} />
          <div>{name}</div>
          <div>{memberNo}</div>
        </div>
      </div>
      <Button onClick={() => window.print()}>Print card</Button>
    </div>
  );
}
