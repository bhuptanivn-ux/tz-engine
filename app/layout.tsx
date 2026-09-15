import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "TZ Engine — NSE Historical Data",
  description: "Look up OHLC historical data for NSE-listed stocks",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
