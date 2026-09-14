"use client";

import { useEffect, useState } from "react";
import { ApiRequestError } from "@/lib/api";
import type { Operator, StaffTile } from "@/lib/types";
import { PinPad } from "./pin-pad";
import { Wordmark } from "./wordmark";
import { usePos } from "./pos-provider";
import { Button, ErrorNote } from "./ui";

export function LockScreen() {
  const { api, signInOperator, signOutDevice, lockReason, session } = usePos();
  const [staff, setStaff] = useState<StaffTile[] | null>(null);
  const [selected, setSelected] = useState<StaffTile | null>(null);
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api<{ staff: StaffTile[] }>("/pos/staff")
      .then((r) => !cancelled && setStaff(r.staff))
      .catch((err: unknown) => !cancelled && setError(err instanceof Error ? err.message : "Could not load staff"));
    return () => {
      cancelled = true;
    };
  }, [api]);

  async function submit(code: string) {
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ operator: Operator; token: string }>("/pos/operator", { body: { staffId: selected.id, pin: code } });
      signInOperator(r.operator, r.token);
    } catch (err) {
      setPin("");
      if (err instanceof ApiRequestError && err.code === "pin_invalid") {
        const left = (err.details as { attemptsRemaining?: number } | undefined)?.attemptsRemaining;
        setError(left !== undefined ? `Incorrect PIN — ${left} ${left === 1 ? "try" : "tries"} left` : "Incorrect PIN");
      } else {
        setError(err instanceof Error ? err.message : "Could not sign in");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-dvh flex-col">
      <header className="flex items-center justify-between px-6 py-4">
        <Wordmark className="text-xl" />
        <div className="flex items-center gap-3 text-sm text-ink-400">
          <span>Device: {session?.user.email}</span>
          <Button variant="ghost" size="sm" onClick={() => void signOutDevice()}>
            Sign out device
          </Button>
        </div>
      </header>
      <div className="flex flex-1 items-center justify-center p-6">
        <div className="w-full max-w-3xl">
          {lockReason ? <p className="mb-4 text-center text-sm text-amber-300">{lockReason}</p> : null}
          {!selected ? (
            <div>
              <h1 className="mb-6 text-center text-2xl font-semibold">Who&apos;s on the counter?</h1>
              <ErrorNote error={error} />
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {(staff ?? []).map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => {
                      setSelected(s);
                      setPin("");
                      setError(null);
                    }}
                    className="rounded-2xl bg-ink-900 p-5 text-left ring-1 ring-ink-800 transition hover:ring-flag"
                  >
                    <div className="grid size-12 place-items-center rounded-full bg-ink-800 text-lg font-bold">{s.display_name.slice(0, 1)}</div>
                    <div className="mt-3 font-semibold">{s.display_name}</div>
                    <div className="text-xs uppercase tracking-wide text-ink-400">{s.role}</div>
                  </button>
                ))}
                {staff === null && !error ? <p className="col-span-full text-center text-ink-400">Loading staff…</p> : null}
              </div>
            </div>
          ) : (
            <div className="mx-auto max-w-xs space-y-5">
              <div className="text-center">
                <p className="text-sm text-ink-400">Enter PIN for</p>
                <p className="text-xl font-semibold">{selected.display_name}</p>
              </div>
              <PinPad value={pin} onChange={setPin} onComplete={(p) => void submit(p)} disabled={busy} />
              <ErrorNote error={error} />
              <Button variant="ghost" className="w-full" onClick={() => setSelected(null)}>
                ← Choose someone else
              </Button>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
