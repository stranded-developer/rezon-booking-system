"use client";

import type { ReactNode } from "react";
import { LockScreen } from "./lock-screen";
import { LoginScreen } from "./login-screen";
import { missingEnv, PosProvider, usePos } from "./pos-provider";

/** Wraps every route: device sign-in, then PIN lock, then the page. */
export function PosShell({ children }: { children: ReactNode }) {
  if (missingEnv.length > 0) {
    return (
      <main className="mx-auto max-w-lg p-8">
        <h1 className="text-xl font-semibold">POS is not configured</h1>
        <p className="mt-2 text-ink-400">Missing environment variables: {missingEnv.join(", ")}. See apps/pos/.env.example.</p>
      </main>
    );
  }
  return (
    <PosProvider>
      <Gate>{children}</Gate>
    </PosProvider>
  );
}

function Gate({ children }: { children: ReactNode }) {
  const { session, sessionLoaded, operator } = usePos();
  if (!sessionLoaded) return <div className="grid min-h-dvh place-items-center text-ink-400">Loading…</div>;
  if (!session) return <LoginScreen />;
  if (!operator) return <LockScreen />;
  return <>{children}</>;
}
