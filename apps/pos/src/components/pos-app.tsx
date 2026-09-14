"use client";

import { LockScreen } from "./lock-screen";
import { LoginScreen } from "./login-screen";
import { MainScreen } from "./main-screen";
import { missingEnv, PosProvider, usePos } from "./pos-provider";

export function PosApp() {
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
      <Gate />
    </PosProvider>
  );
}

function Gate() {
  const { session, sessionLoaded, operator } = usePos();
  if (!sessionLoaded) return <div className="grid min-h-dvh place-items-center text-ink-400">Loading…</div>;
  if (!session) return <LoginScreen />;
  if (!operator) return <LockScreen />;
  return <MainScreen />;
}
