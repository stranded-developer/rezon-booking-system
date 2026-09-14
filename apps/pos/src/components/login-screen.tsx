"use client";

import { useState, type FormEvent } from "react";
import { ApiRequestError } from "@/lib/api";
import { Wordmark } from "./wordmark";
import { usePos } from "./pos-provider";
import { Button, ErrorNote, Field, Input } from "./ui";

export function LoginScreen() {
  const { supabase, api } = usePos();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error: authError } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    if (authError) {
      setBusy(false);
      setError("Email or password is incorrect.");
      return;
    }
    try {
      await api("/pos/staff");
    } catch (err) {
      await supabase.auth.signOut();
      setError(err instanceof ApiRequestError && err.status === 403 ? "This account is not active staff." : "Could not reach the POS server.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="grid min-h-dvh place-items-center p-6">
      <form onSubmit={submit} className="w-full max-w-sm space-y-5 rounded-2xl bg-ink-900 p-8 ring-1 ring-ink-800">
        <div>
          <Wordmark className="text-3xl" />
          <p className="mt-1 text-sm text-ink-400">Sign in this counter device</p>
        </div>
        <Field label="Staff email">
          <Input type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label="Password">
          <Input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <ErrorNote error={error} />
        <Button type="submit" variant="primary" size="lg" className="w-full" disabled={busy}>
          {busy ? "Signing in…" : "Sign in"}
        </Button>
      </form>
    </main>
  );
}
