"use client";

import { useEffect } from "react";

/** 4-digit PIN entry. Works with the on-screen keys and the keyboard. */
export function PinPad({ value, onChange, onComplete, disabled = false }: {
  value: string;
  onChange: (next: string) => void;
  onComplete: (pin: string) => void;
  disabled?: boolean;
}) {
  const press = (key: string) => {
    if (disabled) return;
    if (key === "back") return onChange(value.slice(0, -1));
    if (key === "clear") return onChange("");
    if (value.length >= 4) return;
    const next = value + key;
    onChange(next);
    if (next.length === 4) onComplete(next);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return;
      if (/^\d$/.test(e.key)) press(e.key);
      else if (e.key === "Backspace") press("back");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return (
    <div className="space-y-5">
      <div className="flex justify-center gap-3" aria-label={`${value.length} of 4 digits entered`}>
        {[0, 1, 2, 3].map((i) => (
          <span key={i} className={`size-4 rounded-full ring-2 ${i < value.length ? "bg-flag ring-flag" : "ring-ink-600"}`} />
        ))}
      </div>
      <div className="grid grid-cols-3 gap-2">
        {["1", "2", "3", "4", "5", "6", "7", "8", "9", "clear", "0", "back"].map((k) => (
          <button
            key={k}
            type="button"
            disabled={disabled}
            onClick={() => press(k)}
            className="h-16 rounded-xl bg-ink-800 text-2xl font-semibold ring-1 ring-ink-700 transition hover:bg-ink-700 active:scale-95 disabled:opacity-40"
          >
            {k === "back" ? "⌫" : k === "clear" ? <span className="text-sm uppercase">Clear</span> : k}
          </button>
        ))}
      </div>
    </div>
  );
}
