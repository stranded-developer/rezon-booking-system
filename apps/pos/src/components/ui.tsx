"use client";

import { useEffect, type ButtonHTMLAttributes, type ComponentProps, type ReactNode } from "react";

type Variant = "primary" | "secondary" | "ghost" | "danger";

const VARIANTS: Record<Variant, string> = {
  primary: "bg-flag text-ink-950 hover:brightness-110 disabled:bg-ink-700 disabled:text-ink-400",
  secondary: "bg-ink-800 text-ink-50 ring-1 ring-ink-700 hover:bg-ink-700 disabled:text-ink-400",
  ghost: "text-ink-200 hover:bg-ink-800 disabled:text-ink-600",
  danger: "bg-red-500/15 text-red-300 ring-1 ring-red-500/40 hover:bg-red-500/25 disabled:opacity-50",
};

export function Button({
  variant = "secondary",
  size = "md",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: "sm" | "md" | "lg" }) {
  const sizes = { sm: "h-9 px-3 text-sm", md: "h-11 px-4 text-sm", lg: "h-14 px-6 text-base" };
  return (
    <button
      type="button"
      className={`inline-flex items-center justify-center gap-2 rounded-lg font-semibold transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-flag disabled:cursor-not-allowed ${sizes[size]} ${VARIANTS[variant]} ${className}`}
      {...props}
    />
  );
}

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs font-medium uppercase tracking-wide text-ink-400">{label}</span>
      {children}
      {hint ? <span className="text-xs text-ink-400">{hint}</span> : null}
    </label>
  );
}

export function Input({ className = "", ...props }: ComponentProps<"input">) {
  return (
    <input
      className={`h-11 rounded-lg bg-ink-900 px-3 text-ink-50 ring-1 ring-ink-700 placeholder:text-ink-600 focus:outline-none focus:ring-2 focus:ring-flag ${className}`}
      {...props}
    />
  );
}

export function Modal({
  title,
  onClose,
  children,
  wide = false,
}: {
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-black/70 p-4 sm:p-8" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        role="dialog"
        aria-modal="true"
        className={`w-full ${wide ? "max-w-3xl" : "max-w-lg"} rounded-2xl bg-ink-900 shadow-2xl ring-1 ring-ink-700`}
      >
        <div className="flex items-center justify-between border-b border-ink-800 px-5 py-4">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button type="button" onClick={onClose} className="rounded-md p-2 text-ink-400 hover:bg-ink-800 hover:text-ink-50" aria-label="Close">
            ✕
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

export function ErrorNote({ error }: { error: string | null | undefined }) {
  if (!error) return null;
  return (
    <p role="alert" className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-300 ring-1 ring-red-500/30">
      {error}
    </p>
  );
}

export function Row({ label, value, strong = false }: { label: ReactNode; value: ReactNode; strong?: boolean }) {
  return (
    <div className={`flex items-baseline justify-between gap-4 ${strong ? "text-base font-semibold" : "text-sm text-ink-200"}`}>
      <span>{label}</span>
      <span className="tnum">{value}</span>
    </div>
  );
}
