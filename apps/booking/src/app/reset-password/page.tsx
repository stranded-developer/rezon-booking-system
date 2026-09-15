import type { Metadata } from "next";
import { ResetPasswordForm } from "@/components/auth-forms";

export const metadata: Metadata = { title: "Set a new password — Raceground", robots: { index: false, follow: false } };

export default function ResetPasswordPage() {
  return <ResetPasswordForm />;
}
