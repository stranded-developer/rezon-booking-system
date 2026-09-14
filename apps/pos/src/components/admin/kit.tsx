"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { usePos } from "../pos-provider";

export const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

const message = (err: unknown) => (err instanceof Error ? err.message : "Something went wrong");

/** GET an admin endpoint; re-fetch with reload(). */
export function useApiData<T>(path: string) {
  const { api } = usePos();
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let cancelled = false;
    api<T>(path)
      .then((d) => {
        if (cancelled) return;
        setData(d);
        setError(null);
      })
      .catch((err: unknown) => !cancelled && setError(message(err)));
    return () => {
      cancelled = true;
    };
  }, [api, path, version]);

  return { data, error, reload: useCallback(() => setVersion((v) => v + 1), []) };
}

/** Run a write with busy + error state. Returns the result, or undefined if it failed. */
export function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = useCallback(async <T,>(fn: () => Promise<T>): Promise<T | undefined> => {
    setBusy(true);
    setError(null);
    try {
      return await fn();
    } catch (err) {
      setError(message(err));
      return undefined;
    } finally {
      setBusy(false);
    }
  }, []);
  return { busy, error, setError, run };
}

export function PageHeader({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-bold">{title}</h1>
        {description ? <p className="mt-1 max-w-2xl text-sm text-ink-400">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}

export function Card({ title, children, actions }: { title?: ReactNode; children: ReactNode; actions?: ReactNode }) {
  return (
    <section className="rounded-2xl bg-ink-900 ring-1 ring-ink-800">
      {title ? (
        <div className="flex items-center justify-between gap-3 border-b border-ink-800 px-5 py-3">
          <h2 className="font-semibold">{title}</h2>
          {actions}
        </div>
      ) : null}
      <div className="p-5">{children}</div>
    </section>
  );
}

export function Table({ head, children, empty }: { head: ReactNode[]; children: ReactNode; empty?: boolean }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead className="text-xs uppercase tracking-wide text-ink-400">
          <tr>
            {head.map((h, i) => (
              <th key={i} className="whitespace-nowrap px-3 py-2 font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-ink-800">{children}</tbody>
      </table>
      {empty ? <p className="px-3 py-6 text-center text-sm text-ink-400">Nothing here yet.</p> : null}
    </div>
  );
}

export function Td({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <td className={`px-3 py-2.5 align-middle ${className}`}>{children}</td>;
}

export function Badge({ tone, children }: { tone: "green" | "red" | "amber" | "grey" | "blue"; children: ReactNode }) {
  const tones = {
    green: "bg-emerald-400/10 text-emerald-300 ring-emerald-400/30",
    red: "bg-red-500/10 text-red-300 ring-red-500/30",
    amber: "bg-amber-400/10 text-amber-200 ring-amber-400/30",
    grey: "bg-ink-800 text-ink-400 ring-ink-700",
    blue: "bg-sky-400/10 text-sky-300 ring-sky-400/30",
  };
  return <span className={`inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ${tones[tone]}`}>{children}</span>;
}

export function DaysPicker({ value, onChange }: { value: number[]; onChange: (days: number[]) => void }) {
  return (
    <div className="flex flex-wrap gap-1">
      {DAY_NAMES.map((name, i) => {
        const day = i + 1;
        const on = value.includes(day);
        return (
          <button
            key={name}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(on ? value.filter((d) => d !== day) : [...value, day].sort())}
            className={`h-9 w-11 rounded-lg text-sm font-medium ring-1 ${on ? "bg-flag text-ink-950 ring-flag" : "bg-ink-900 text-ink-200 ring-ink-700"}`}
          >
            {name}
          </button>
        );
      })}
    </div>
  );
}

export const daysLabel = (days: number[]) =>
  days.length === 7 ? "Every day" : days.join(",") === "1,2,3,4,5" ? "Mon–Fri" : days.join(",") === "6,7" ? "Sat–Sun" : days.map((d) => DAY_NAMES[d - 1]).join(", ");

/** "12.5" (percent) → 1250 bp. */
export function parsePercent(input: string): number | null {
  const cleaned = input.trim().replace(/%$/, "");
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  return Math.round(Number(cleaned) * 100);
}

export const bpToInput = (bp: number) => String(bp / 100);
