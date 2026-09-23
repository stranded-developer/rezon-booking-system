import type { Metadata } from "next";
import { ForgotPasswordForm } from "@/components/auth-forms";
import { PageShell } from "@/components/ui";

export const metadata: Metadata = { title: "Forgot your password — Raceground" };

export default function ForgotPasswordPage() {
  return (
    <PageShell width="narrow">
      <ForgotPasswordForm />
    </PageShell>
  );
}
