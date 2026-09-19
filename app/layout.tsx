import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Market Data Vault",
  description: "Download OHLC data as Excel from your own stored market data files.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
