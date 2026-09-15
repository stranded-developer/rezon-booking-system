import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import Link from "next/link";
import { AccountProvider } from "@/components/account-provider";
import { SiteHeader } from "@/components/site-header";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });

export const metadata: Metadata = {
  title: "Raceground — book a table, sim or VR seat in Sydney",
  description: "Book billiard tables, driving simulators and VR seats at Raceground in Sydney. Pay online, show your code at the counter.",
};

export const viewport: Viewport = {
  themeColor: "#f5f6f8",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en-AU" className={inter.variable}>
      <body className="flex min-h-dvh flex-col font-sans">
        <AccountProvider>
        <SiteHeader />
        <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">{children}</main>
        <footer className="border-t border-line bg-paper">
          <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center justify-between gap-3 px-4 py-6 text-sm text-ink-500">
            <p>© {new Date().getFullYear()} Raceground, Sydney</p>
            <nav className="flex flex-wrap gap-4">
              <Link href="/terms" className="hover:text-ink-950">
                Terms
              </Link>
              <Link href="/refund-policy" className="hover:text-ink-950">
                Cancellations &amp; refunds
              </Link>
              <Link href="/privacy" className="hover:text-ink-950">
                Privacy
              </Link>
            </nav>
          </div>
        </footer>
        </AccountProvider>
      </body>
    </html>
  );
}
