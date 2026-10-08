import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { connection } from "next/server";
import { AccountProvider } from "@/components/account-provider";
import { BottomBar } from "@/components/bottom-bar";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { EventBanner, EventPopup } from "@/components/site-events";
import { api } from "@/lib/api";
import type { PublicConfig } from "@/lib/types";
import "./globals.css";

/**
 * Garet, the owner's licensed font (D93): Book (300) for text, Heavy (850) for headings, buttons
 * and labels. These are the only two faces, so any bold weight resolves to Heavy and any normal
 * one to Book; `font-synthesis: none` (globals.css) stops the browser faking weights in between.
 */
const garet = localFont({
  src: [
    { path: "../fonts/garet/Garet-Book.woff2", weight: "300", style: "normal" },
    { path: "../fonts/garet/Garet-Heavy.woff2", weight: "850", style: "normal" },
  ],
  variable: "--font-body",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Racegrounds — Sydney's sim racing, billiards and VR lounge",
  description:
    "Book a driving simulator (standard or VR) or a billiard table at Racegrounds in Sydney. Quick Race, Double Race and Leaderboard Challenge, with member pricing and happy hour.",
};

export const viewport: Viewport = {
  themeColor: "#0d0a14",
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
    <html lang="en-AU" className={garet.variable}>
      {/* Padded by the bottom bar's height, so the footer is never hidden behind it (D81). */}
      <body className="flex min-h-dvh flex-col pb-[calc(4.25rem+env(safe-area-inset-bottom))] font-sans">
        <AccountProvider>
          <EventBanner events={events} />
          <SiteHeader />
          <main className="flex-1">{children}</main>
          <SiteFooter venue={config?.venue ?? null} />
          <BottomBar />
          <EventPopup events={events} />
        </AccountProvider>
      </body>
    </html>
  );
}
