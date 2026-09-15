import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ComponentProps, ReactNode } from "react";
import Link from "next/link";

type Variant = "primary" | "secondary" | "ghost" | "danger";

const VARIANTS: Record<Variant, string> = {
  primary: "bg-flag text-ink-950 ring-1 ring-ink-950/10 hover:brightness-105 disabled:bg-line disabled:text-ink-500",
  secondary: "bg-paper text-ink-950 ring-1 ring-line hover:bg-mist disabled:text-ink-500",
  ghost: "text-ink-600 hover:bg-mist disabled:text-ink-500",
  danger: "bg-red-600 text-white hover:bg-red-700 disabled:bg-red-300",
};
const SIZES = { sm: "h-9 px-3 text-sm", md: "h-11 px-4 text-sm", lg: "h-13 px-6 text-base" };
const base = "inline-flex items-center justify-center gap-2 rounded-xl font-semibold transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink-950 disabled:cursor-not-allowed";

export function Button({
  variant = "secondary",
  size = "md",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: "sm" | "md" | "lg" }) {
  return <button type="button" className={`${base} ${SIZES[size]} ${VARIANTS[variant]} ${className}`} {...props} />;
}

export function ButtonLink({
  href,
  variant = "secondary",
  size = "md",
  className = "",
  ...props
}: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string; variant?: Variant; size?: "sm" | "md" | "lg" }) {
  return <Link href={href} className={`${base} ${SIZES[size]} ${VARIANTS[variant]} ${className}`} {...props} />;
}

export function Input({ className = "", ...props }: ComponentProps<"input">) {
  return (
    <input
      className={`h-11 w-full rounded-xl border border-line bg-paper px-3 text-ink-950 placeholder:text-ink-500 focus:border-ink-950 focus:outline-none ${className}`}
      {...props}
    />
  );
}

export function Field({ label, hint, error, children }: { label: string; hint?: ReactNode; error?: string | null; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-sm font-medium text-ink-800">{label}</span>
      {children}
      {error ? <span className="text-sm text-red-700">{error}</span> : hint ? <span className="text-sm text-ink-500">{hint}</span> : null}
    </label>
  );
}

export function Card({ title, children, className = "" }: { title?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-2xl border border-line bg-paper p-5 sm:p-6 ${className}`}>
      {title ? <h2 className="mb-4 text-lg font-bold">{title}</h2> : null}
      {children}
    </section>
  );
}

export function Notice({ tone = "info", children }: { tone?: "info" | "warn" | "error" | "good"; children: ReactNode }) {
  const tones = {
    info: "bg-mist text-ink-800 border-line",
    warn: "bg-amber-50 text-amber-900 border-amber-200",
    error: "bg-red-50 text-red-800 border-red-200",
    good: "bg-emerald-50 text-emerald-900 border-emerald-200",
  };
  return (
    <p role={tone === "error" ? "alert" : undefined} className={`rounded-xl border px-4 py-3 text-sm ${tones[tone]}`}>
      {children}
    </p>
  );
}

export function Row({ label, value, strong = false }: { label: ReactNode; value: ReactNode; strong?: boolean }) {
  return (
    <div className={`flex items-baseline justify-between gap-4 ${strong ? "text-base font-bold" : "text-sm text-ink-600"}`}>
      <span>{label}</span>
      <span className="tnum text-right">{value}</span>
    </div>
  );
}

export function Wordmark({ className = "" }: { className?: string }) {
  return (
    <span className={`font-black uppercase italic tracking-tight ${className}`}>
      Race<span className="rounded bg-flag px-1 text-ink-950">ground</span>
    </span>
  );
}

export function Spinner({ label }: { label: string }) {
  return (
    <p className="flex items-center gap-2 text-sm text-ink-500">
      <span aria-hidden className="size-4 animate-spin rounded-full border-2 border-line border-t-ink-950" />
      {label}
    </p>
  );
}
