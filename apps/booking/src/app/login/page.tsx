import { Suspense } from "react";
import type { Metadata } from "next";
import { LoginForm } from "@/components/auth-forms";
import { PageShell } from "@/components/ui";

export const metadata: Metadata = { title: "Member log in — Racegrounds" };

export default function LoginPage() {
  return (
    <Suspense>
      <PageShell width="narrow"><LoginForm /></PageShell>
    </Suspense>
  );
}
