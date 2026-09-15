"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase, useAccount } from "@/components/account-provider";
import { Button, Card, Field, Input, Notice, Spinner } from "@/components/ui";

const message = (err: unknown) => (err instanceof Error ? err.message : "Something went wrong. Please try again.");

/** Where Supabase sends people back to after they click a link in an email. */
const siteUrl = () => (typeof window === "undefined" ? "" : window.location.origin);

export function LoginForm() {
  const router = useRouter();
  const search = useSearchParams();
  const { session, ready } = useAccount();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const next = search.get("next") ?? "/account";

  // Confirmation and password links sign people in on arrival; send them straight on.
  useEffect(() => {
    if (ready && session) router.replace(next);
  }, [ready, session, router, next]);

  if (ready && session) return <Spinner label="Signing you in…" />;

  async function signIn() {
    setBusy(true);
    setError(null);
    const { error: authError } = await supabase().auth.signInWithPassword({ email: email.trim(), password });
    setBusy(false);
    if (authError) {
      setError(
        authError.message.toLowerCase().includes("email not confirmed")
          ? "Please confirm your email first. Check your inbox for the link we sent."
          : "That email and password don't match. Please try again.",
      );
      return;
    }
    router.replace(next);
  }

  return (
    <div className="mx-auto max-w-md space-y-6">
      <h1 className="text-2xl font-black">Member log in</h1>
      {search.get("confirmed") === "1" ? <Notice tone="good">Your email is confirmed. Log in to see your membership.</Notice> : null}
      {search.get("reset") === "1" ? <Notice tone="good">Your password is updated. Log in with your new password.</Notice> : null}
      <Card>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            void signIn();
          }}
        >
          <Field label="Email">
            <Input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </Field>
          <Field label="Password">
            <Input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </Field>
          {error ? <Notice tone="error">{error}</Notice> : null}
          <Button type="submit" variant="primary" size="lg" className="w-full" disabled={busy}>
            {busy ? "Logging in…" : "Log in"}
          </Button>
        </form>
        <div className="mt-4 flex justify-between text-sm">
          <Link href="/forgot-password" className="underline">
            Forgot your password?
          </Link>
          <Link href="/signup" className="underline">
            Create an account
          </Link>
        </div>
      </Card>
      <p className="text-center text-sm text-ink-500">Booking a table? You don&apos;t need an account for that.</p>
    </div>
  );
}

export function SignUpForm() {
  const search = useSearchParams();
  const [form, setForm] = useState({ name: "", email: "", phone: "", password: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function signUp() {
    setBusy(true);
    setError(null);
    const { error: authError } = await supabase().auth.signUp({
      email: form.email.trim(),
      password: form.password,
      options: {
        data: { name: form.name.trim(), phone: form.phone.trim() },
        emailRedirectTo: `${siteUrl()}/login?confirmed=1`,
      },
    });
    setBusy(false);
    if (authError) {
      setError(authError.message.toLowerCase().includes("password") ? "Please use a password of at least 8 characters." : message(authError));
      return;
    }
    setSent(true);
  }

  if (sent) {
    return (
      <div className="mx-auto max-w-md space-y-6">
        <h1 className="text-2xl font-black">Check your email</h1>
        <Notice tone="good">
          We&apos;ve sent a confirmation link to {form.email.trim()}. Click it, then log in. Confirming proves the address is yours, so nobody
          else can take over your membership.
        </Notice>
        <Link href="/login" className="underline">
          Back to log in
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-md space-y-6">
      <h1 className="text-2xl font-black">Create your account</h1>
      <p className="text-sm text-ink-600">
        {search.get("join") === "1"
          ? "Memberships need an account so you can see your discount, free minutes and member QR."
          : "Already a member from the counter? Sign up with the email you gave us and your membership joins this account."}
      </p>
      <Card>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            void signUp();
          }}
        >
          <Field label="Name">
            <Input autoComplete="name" value={form.name} onChange={set("name")} required />
          </Field>
          <Field label="Email">
            <Input type="email" autoComplete="email" value={form.email} onChange={set("email")} required />
          </Field>
          <Field label="Phone (optional)">
            <Input type="tel" autoComplete="tel" value={form.phone} onChange={set("phone")} />
          </Field>
          <Field label="Password" hint="At least 8 characters.">
            <Input type="password" autoComplete="new-password" minLength={8} value={form.password} onChange={set("password")} required />
          </Field>
          {error ? <Notice tone="error">{error}</Notice> : null}
          <Button type="submit" variant="primary" size="lg" className="w-full" disabled={busy}>
            {busy ? "Creating your account…" : "Create account"}
          </Button>
        </form>
        <p className="mt-4 text-sm">
          Already have an account?{" "}
          <Link href="/login" className="underline">
            Log in
          </Link>
        </p>
      </Card>
    </div>
  );
}

export function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  async function send() {
    setBusy(true);
    // Always the same answer, so nobody can use this to find out who has an account.
    await supabase().auth.resetPasswordForEmail(email.trim(), { redirectTo: `${siteUrl()}/reset-password` });
    setBusy(false);
    setSent(true);
  }

  return (
    <div className="mx-auto max-w-md space-y-6">
      <h1 className="text-2xl font-black">Forgot your password?</h1>
      {sent ? (
        <Notice tone="good">If there&apos;s an account for {email.trim()}, we&apos;ve sent a link to set a new password.</Notice>
      ) : (
        <Card>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              void send();
            }}
          >
            <Field label="Email">
              <Input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </Field>
            <Button type="submit" variant="primary" size="lg" className="w-full" disabled={busy}>
              {busy ? "Sending…" : "Send me a link"}
            </Button>
          </form>
        </Card>
      )}
      <Link href="/login" className="underline">
        Back to log in
      </Link>
    </div>
  );
}

export function ResetPasswordForm() {
  const router = useRouter();
  const { session, ready } = useAccount();
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setError(null);
    const { error: authError } = await supabase().auth.updateUser({ password });
    setBusy(false);
    if (authError) {
      setError(message(authError));
      return;
    }
    await supabase().auth.signOut();
    router.replace("/login?reset=1");
  }

  if (!ready) return <Spinner label="Checking your link…" />;

  return (
    <div className="mx-auto max-w-md space-y-6">
      <h1 className="text-2xl font-black">Set a new password</h1>
      {session ? (
        <Card>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
          >
            <Field label="New password" hint="At least 8 characters.">
              <Input type="password" autoComplete="new-password" minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} required />
            </Field>
            {error ? <Notice tone="error">{error}</Notice> : null}
            <Button type="submit" variant="primary" size="lg" className="w-full" disabled={busy}>
              {busy ? "Saving…" : "Save new password"}
            </Button>
          </form>
        </Card>
      ) : (
        <>
          <Notice tone="warn">This link has expired or has already been used. Ask for a new one.</Notice>
          <Link href="/forgot-password" className="underline">
            Send another link
          </Link>
        </>
      )}
    </div>
  );
}
