import type { Metadata } from "next";
import { ForgotPasswordForm } from "@/components/auth-forms";

export const metadata: Metadata = { title: "Forgot your password — Raceground" };

export default function ForgotPasswordPage() {
  return <ForgotPasswordForm />;
}
