import type { Metadata, Viewport } from "next";
import { Chakra_Petch, Manrope } from "next/font/google";
import { connection } from "next/server";
import { AccountProvider } from "@/components/account-provider";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { EventBanner, EventPopup } from "@/components/site-events";
import { api } from "@/lib/api";
import type { PublicConfig } from "@/lib/types";
import "./globals.css";

const body = Manrope({ subsets: ["latin"], variable: "--font-body" });
/** Headings are squared, upright capitals — Raceground's own, not the reference's condensed italic (D76). */
const heading = Chakra_Petch({ subsets: ["latin"], weight: ["600", "700"], variable: "--font-heading" });

export const metadata: Metadata = {
  title: "Raceground — Sydney's sim racing, billiards and VR lounge",
  description:
    "Book a driving simulator (standard or VR) or a billiard table at Raceground in Sydney. Quick Race, Double Race and Leaderboard Challenge, with member pricing and happy hour.",
};

export const viewport: Viewport = {
  themeColor: "#0b0d10",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  // The venue's details and what's on are edited in the back office, so this is read per request.
  await connection();
  let config: PublicConfig | null = null;
  try {
    config = await api<PublicConfig>("/public/config");
  } catch {
    config = null;
  }
  const events = config?.events ?? [];

  return (
    <html lang="en-AU" className={`${body.variable} ${heading.variable}`}>
      <body className="flex min-h-dvh flex-col font-sans">
        <AccountProvider>
          <EventBanner events={events} />
          <SiteHeader />
          <main className="flex-1">{children}</main>
          <SiteFooter venue={config?.venue ?? null} />
          <EventPopup events={events} />
        </AccountProvider>
      </body>
    </html>
  );
}
