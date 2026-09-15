import { Suspense } from "react";
import type { Metadata } from "next";
import { SignUpForm } from "@/components/auth-forms";

export const metadata: Metadata = { title: "Create an account — Raceground" };

export default function SignUpPage() {
  return (
    <Suspense>
      <SignUpForm />
    </Suspense>
  );
}
