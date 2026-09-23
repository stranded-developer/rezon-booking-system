import type { Metadata, Viewport } from "next";
import { Barlow_Condensed, Inter } from "next/font/google";
import { connection } from "next/server";
import { AccountProvider } from "@/components/account-provider";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { EventBanner, EventPopup } from "@/components/site-events";
import { api } from "@/lib/api";
import type { PublicConfig } from "@/lib/types";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });
/** Headings in the reference are condensed italic capitals (D64). */
const display = Barlow_Condensed({ subsets: ["latin"], weight: ["600", "700"], style: ["normal", "italic"], variable: "--font-display" });

export const metadata: Metadata = {
  title: "Raceground — Sydney's sim racing, billiards and VR lounge",
  description:
    "Book a driving simulator, billiard table or VR seat at Raceground in Sydney. Quick Race, Double Race and Leaderboard Challenge, with member pricing and happy hour.",
};

export const viewport: Viewport = {
  themeColor: "#0a0a18",
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
    <html lang="en-AU" className={`${inter.variable} ${display.variable}`}>
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
