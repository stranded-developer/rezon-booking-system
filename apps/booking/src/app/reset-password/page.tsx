import type { Metadata } from "next";
import { ResetPasswordForm } from "@/components/auth-forms";
import { PageShell } from "@/components/ui";

export const metadata: Metadata = { title: "Set a new password — Raceground", robots: { index: false, follow: false } };

export default function ResetPasswordPage() {
  return (
    <PageShell width="narrow">
      <ResetPasswordForm />
    </PageShell>
  );
}
