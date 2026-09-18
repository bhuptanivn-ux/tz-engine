import type { Metadata } from "next";
import { IBM_Plex_Sans, IBM_Plex_Mono } from "next/font/google";
import Sidebar from "@/components/Sidebar";
import "./globals.css";

// Used only by the results table (see .ledger-table in globals.css) --
// the rest of the page keeps the existing system-font stack.
const plexSans = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-plex-sans",
});
const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-plex-mono",
});

export const metadata: Metadata = {
  title: "TZ Engine — NSE Historical Data",
  description: "Look up OHLC historical data for NSE-listed stocks",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${plexSans.variable} ${plexMono.variable}`}>
      <body>
        <Sidebar />
        {children}
      </body>
    </html>
  );
}
