import { Suspense } from "react";
import type { Metadata } from "next";
import { MembershipView } from "@/components/membership-view";

export const metadata: Metadata = {
  title: "Membership — Raceground",
  description: "Silver, Gold and Diamond memberships: a discount on every session and free play minutes each month.",
};

export default function MembershipPage() {
  return (
    <Suspense>
      <MembershipView />
    </Suspense>
  );
}
