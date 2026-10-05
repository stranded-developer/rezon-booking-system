import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { PosShell } from "@/components/pos-app";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });

export const metadata: Metadata = {
  title: "Racegrounds POS",
  description: "Point of sale and floor control for Racegrounds",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: "#0b0d10",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en-AU" className={inter.variable}>
      <body className="min-h-dvh font-sans">
        <PosShell>{children}</PosShell>
      </body>
    </html>
  );
}
