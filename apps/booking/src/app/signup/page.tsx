import { Suspense } from "react";
import type { Metadata } from "next";
import { SignUpForm } from "@/components/auth-forms";
import { PageShell } from "@/components/ui";

export const metadata: Metadata = { title: "Create an account — Racegrounds" };

export default function SignUpPage() {
  return (
    <Suspense>
      <PageShell width="narrow"><SignUpForm /></PageShell>
    </Suspense>
  );
}
