import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ComponentProps, ReactNode } from "react";
import Link from "next/link";

type Variant = "primary" | "gold" | "secondary" | "ghost" | "danger";

const VARIANTS: Record<Variant, string> = {
  primary: "bg-flag text-on-flag shadow-[0_6px_24px_-10px_var(--color-flag)] hover:bg-flag-bright disabled:bg-line disabled:text-ink-500 disabled:shadow-none",
  gold: "bg-gold text-night hover:brightness-110 disabled:bg-line disabled:text-ink-500",
  secondary: "bg-paper text-ink-950 ring-1 ring-line hover:bg-mist hover:ring-ink-500 disabled:text-ink-500",
  ghost: "text-ink-600 hover:bg-mist hover:text-ink-950 disabled:text-ink-500",
  danger: "bg-red-600 text-white hover:bg-red-500 disabled:bg-red-900 disabled:text-ink-500",
};
/** Measured from the owner's video (D92): the hero's Book now is 44px tall with ~10.5px capitals. */
const SIZES = { sm: "h-9 px-3 text-[0.6rem]", md: "h-11 px-4 text-[0.65rem]", lg: "h-11 px-5 text-[0.68rem]" };
/** The mockup's buttons: small, wide-spaced heavy capitals (D88). */
const base =
  "inline-flex items-center justify-center gap-2 rounded-lg font-[family-name:var(--font-display)] font-bold uppercase tracking-[0.04em] transition-all duration-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-flag-bright disabled:cursor-not-allowed";

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
      className={`h-11 w-full rounded-xl border border-line bg-night/60 px-3 text-ink-950 placeholder:text-ink-500 focus:border-flag focus:outline-none ${className}`}
      {...props}
    />
  );
}

export function Select({ className = "", ...props }: ComponentProps<"select">) {
  return (
    <select
      className={`h-11 w-full rounded-xl border border-line bg-night/60 px-3 text-ink-950 focus:border-flag focus:outline-none ${className}`}
      {...props}
    />
  );
}

export function Field({ label, hint, error, children }: { label: string; hint?: ReactNode; error?: string | null; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-sm font-medium text-ink-800">{label}</span>
      {children}
      {error ? <span className="text-sm text-red-300">{error}</span> : hint ? <span className="text-sm text-ink-500">{hint}</span> : null}
    </label>
  );
}

export function Card({ title, children, className = "" }: { title?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-2xl border border-line bg-paper/80 p-5 backdrop-blur-sm sm:p-6 ${className}`}>
      {title ? <h2 className="display mb-4 text-xl">{title}</h2> : null}
      {children}
    </section>
  );
}

export function Notice({ tone = "info", children }: { tone?: "info" | "warn" | "error" | "good"; children: ReactNode }) {
  const tones = {
    info: "bg-mist/70 text-ink-800 border-line",
    warn: "bg-amber-400/10 text-amber-200 border-amber-400/30",
    error: "bg-red-500/10 text-red-200 border-red-500/30",
    good: "bg-emerald-400/10 text-emerald-200 border-emerald-400/30",
  };
  return (
    <p role={tone === "error" ? "alert" : undefined} className={`rounded-xl border px-4 py-3 text-sm ${tones[tone]}`}>
      {children}
    </p>
  );
}

export function Row({ label, value, strong = false }: { label: ReactNode; value: ReactNode; strong?: boolean }) {
  return (
    <div className={`flex items-baseline justify-between gap-4 ${strong ? "text-base font-bold text-ink-950" : "text-sm text-ink-600"}`}>
      <span>{label}</span>
      <span className="tnum text-right">{value}</span>
    </div>
  );
}

/**
 * The logo as it is on the rigs' screens: thin, widely spaced capitals, with the A drawn as a Λ
 * (D88). Screen readers get the name, not the letter shapes.
 */
export function Wordmark({ className = "" }: { className?: string }) {
  return (
    <span className={`whitespace-nowrap font-[family-name:var(--font-display)] font-light uppercase tracking-[0.42em] ${className}`}>
      <span className="sr-only">Racegrounds</span>
      <span aria-hidden>RΛCEGROUNDS</span>
    </span>
  );
}

export function Spinner({ label }: { label: string }) {
  return (
    <p className="flex items-center gap-2 text-sm text-ink-500">
      <span aria-hidden className="size-4 animate-spin rounded-full border-2 border-line border-t-flag" />
      {label}
    </p>
  );
}

/** A short label on a card, as the reference badges its most popular experience. */
export function Badge({ children, tone = "flag" }: { children: ReactNode; tone?: "flag" | "gold" | "quiet" }) {
  const tones = {
    flag: "bg-flag text-on-flag",
    gold: "bg-gold text-night",
    quiet: "bg-mist text-ink-600 ring-1 ring-line",
  };
  return <span className={`display inline-block rounded-md px-2 py-1 text-xs tracking-wide ${tones[tone]}`}>{children}</span>;
}

/** The checkered flag strip the reference uses between sections. */
export function Checkers({ className = "" }: { className?: string }) {
  return <div aria-hidden className={`checkers w-full ${className}`} />;
}

/**
 * A section heading: capitals, with part of it in the accent colour.
 * `level` is 1 where the section heading is the page's own title, so every page has one h1.
 */
export function SectionTitle({
  children,
  kicker,
  level = 2,
  className = "",
}: {
  children: ReactNode;
  kicker?: string;
  level?: 1 | 2;
  className?: string;
}) {
  const Heading = level === 1 ? "h1" : "h2";
  return (
    <div className={`text-center ${className}`}>
      {kicker ? <p className="display mb-3 text-sm tracking-[0.2em] text-flag">{kicker}</p> : null}
      <Heading className="display text-3xl sm:text-4xl">{children}</Heading>
    </div>
  );
}

/**
 * The page container. The layout is full-bleed so the home page can run sections edge to edge,
 * so every other page wraps its own content in this.
 */
export function PageShell({ children, width = "wide", className = "" }: { children: ReactNode; width?: "wide" | "narrow"; className?: string }) {
  const max = width === "narrow" ? "max-w-2xl" : "max-w-5xl";
  return <div className={`mx-auto w-full ${max} px-4 py-10 ${className}`}>{children}</div>;
}
