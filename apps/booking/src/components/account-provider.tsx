"use client";

import { createClient, type Session, type SupabaseClient } from "@supabase/supabase-js";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api, type ApiOptions } from "@/lib/api";
import type { Account } from "@/lib/types";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

export const missingEnv = [!SUPABASE_URL && "NEXT_PUBLIC_SUPABASE_URL", !SUPABASE_KEY && "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"].filter(Boolean) as string[];

let client: SupabaseClient | null = null;
/** One browser client for the whole site; it keeps the member signed in between visits. */
export function supabase(): SupabaseClient {
  client ??= createClient(SUPABASE_URL ?? "", SUPABASE_KEY ?? "", {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storageKey: "raceground-member" },
  });
  return client;
}

interface AccountContextValue {
  session: Session | null;
  /** false until Supabase has restored any stored session. */
  ready: boolean;
  account: Account | null;
  accountError: string | null;
  reloadAccount: () => void;
  /** Calls the API as the signed-in member (no token when signed out). */
  request: <T>(path: string, opts?: ApiOptions) => Promise<T>;
  signOut: () => Promise<void>;
}

const AccountContext = createContext<AccountContextValue | null>(null);

export function useAccount(): AccountContextValue {
  const ctx = useContext(AccountContext);
  if (!ctx) throw new Error("useAccount must be used inside AccountProvider");
  return ctx;
}

export function AccountProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [sessionChecked, setSessionChecked] = useState(false);
  const [account, setAccount] = useState<Account | null>(null);
  const [accountError, setAccountError] = useState<string | null>(null);
  const [reloads, setReloads] = useState(0);

  useEffect(() => {
    if (missingEnv.length > 0) return;
    const auth = supabase().auth;
    auth
      .getSession()
      .then(({ data }) => {
        setSession(data.session);
        setSessionChecked(true);
      })
      .catch(() => setSessionChecked(true));
    const { data: sub } = auth.onAuthStateChange((_event, next) => setSession(next));
    return () => sub.subscription.unsubscribe();
  }, []);

  // Without Supabase configured there is nothing to wait for.
  const ready = missingEnv.length > 0 || sessionChecked;

  const token = session?.access_token ?? null;

  const request = useCallback(
    async <T,>(path: string, opts: ApiOptions = {}): Promise<T> => api<T>(path, { ...opts, ...(token ? { token } : {}) }),
    [token],
  );

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    api<Account>("/me", { token })
      .then((a) => !cancelled && setAccount(a))
      .catch((err: unknown) => !cancelled && setAccountError(err instanceof Error ? err.message : "Could not load your account"));
    return () => {
      cancelled = true;
    };
  }, [token, reloads]);

  const value = useMemo<AccountContextValue>(
    () => ({
      session,
      ready,
      account: token ? account : null,
      accountError: token ? accountError : null,
      reloadAccount: () => {
        setAccountError(null);
        setReloads((n) => n + 1);
      },
      request,
      signOut: async () => {
        await supabase().auth.signOut();
        setAccount(null);
        setAccountError(null);
      },
    }),
    [session, ready, account, accountError, token, request],
  );

  return <AccountContext.Provider value={value}>{children}</AccountContext.Provider>;
}
