"use client";

import { createClient, type Session, type SupabaseClient } from "@supabase/supabase-js";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createApiClient, type ApiRequest } from "@/lib/api";
import { operatorToken } from "@/lib/operator-token";
import type { Operator, PosConfig } from "@/lib/types";

/** Client-side idle lock. The API enforces the same limit on the operator token. */
export const IDLE_LOCK_MS = 5 * 60_000;

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const API_URL = process.env.NEXT_PUBLIC_API_URL;

export const missingEnv = [
  !SUPABASE_URL && "NEXT_PUBLIC_SUPABASE_URL",
  !SUPABASE_KEY && "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  !API_URL && "NEXT_PUBLIC_API_URL",
].filter(Boolean) as string[];

let supabaseSingleton: SupabaseClient | null = null;
function getSupabase(): SupabaseClient {
  supabaseSingleton ??= createClient(SUPABASE_URL!, SUPABASE_KEY!, {
    auth: { persistSession: true, autoRefreshToken: true, storageKey: "raceground-pos-device" },
  });
  return supabaseSingleton;
}

interface PosContextValue {
  supabase: SupabaseClient;
  session: Session | null;
  sessionLoaded: boolean;
  operator: Operator | null;
  config: PosConfig | null;
  api: ApiRequest;
  signInOperator: (operator: Operator, token: string) => void;
  lock: () => void;
  signOutDevice: () => Promise<void>;
  lockReason: string | null;
}

const PosContext = createContext<PosContextValue | null>(null);

export function usePos(): PosContextValue {
  const ctx = useContext(PosContext);
  if (!ctx) throw new Error("usePos must be used inside PosProvider");
  return ctx;
}

export function PosProvider({ children }: { children: ReactNode }) {
  const supabase = useMemo(() => getSupabase(), []);
  const [session, setSession] = useState<Session | null>(null);
  const [sessionLoaded, setSessionLoaded] = useState(false);
  const [operator, setOperator] = useState<Operator | null>(null);
  const [config, setConfig] = useState<PosConfig | null>(null);
  const [lockReason, setLockReason] = useState<string | null>(null);
  const lastActivity = useRef(0);

  useEffect(() => {
    let cancelled = false;
    supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return;
      setSession(data.session);
      setSessionLoaded(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => setSession(next));
    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, [supabase]);

  const lock = useCallback((reason: string | null = null) => {
    operatorToken.set(null);
    setOperator(null);
    setLockReason(reason);
  }, []);

  const signOutDevice = useCallback(async () => {
    lock();
    await supabase.auth.signOut();
  }, [lock, supabase]);

  const api = useMemo(
    () =>
      createApiClient({
        baseUrl: API_URL ?? "",
        getJwt: async () => (await supabase.auth.getSession()).data.session?.access_token ?? null,
        getOperatorToken: operatorToken.get,
        onOperatorToken: operatorToken.set,
        onOperatorExpired: () => lock("Your session timed out. Enter your PIN to continue."),
        onDeviceExpired: () => {
          lock();
          void supabase.auth.signOut();
        },
      }),
    [lock, supabase],
  );

  const signInOperator = useCallback((next: Operator, token: string) => {
    operatorToken.set(token);
    lastActivity.current = Date.now();
    setLockReason(null);
    setOperator(next);
  }, []);

  // Load venue config once someone is operating.
  useEffect(() => {
    if (!operator || config) return;
    let cancelled = false;
    api<PosConfig>("/pos/config", { passive: true })
      .then((c) => {
        if (!cancelled) setConfig(c);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [api, config, operator]);

  // Idle lock: any pointer or key activity counts.
  useEffect(() => {
    if (!operator) return;
    const touch = () => {
      lastActivity.current = Date.now();
    };
    const events = ["pointerdown", "keydown", "wheel"] as const;
    events.forEach((e) => window.addEventListener(e, touch, { passive: true }));
    const timer = window.setInterval(() => {
      if (Date.now() - lastActivity.current > IDLE_LOCK_MS) lock("Locked after 5 minutes without activity.");
    }, 5_000);
    return () => {
      events.forEach((e) => window.removeEventListener(e, touch));
      window.clearInterval(timer);
    };
  }, [lock, operator]);

  const value = useMemo<PosContextValue>(
    () => ({ supabase, session, sessionLoaded, operator, config, api, signInOperator, lock: () => lock(), signOutDevice, lockReason }),
    [api, config, lock, lockReason, operator, session, sessionLoaded, signInOperator, signOutDevice, supabase],
  );

  return <PosContext.Provider value={value}>{children}</PosContext.Provider>;
}
