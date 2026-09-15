import { Suspense } from "react";
import type { Metadata } from "next";
import { AccountView } from "@/components/account-view";

export const metadata: Metadata = { title: "Your account — Raceground", robots: { index: false, follow: false } };

export default function AccountPage() {
  return (
    <Suspense>
      <AccountView />
    </Suspense>
  );
}
