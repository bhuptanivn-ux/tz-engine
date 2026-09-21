import { NextRequest, NextResponse } from "next/server";
import { fetchFirstTradeDate } from "@/lib/marketData";

// Underscore and a longer max length accommodate the pseudo-suffixed Blob
// symbols in lib/otherMarkets.ts (e.g. "NIFTY_FINANCIAL_SERVICES.IDX"),
// alongside plain Yahoo tickers like "^NSEI" or "RELIANCE.NS".
const SYMBOL_RE = /^[A-Za-z0-9._\-^&]{1,40}$/;

export async function GET(req: NextRequest) {
  const symbol = req.nextUrl.searchParams.get("symbol")?.trim() || "";

  if (!SYMBOL_RE.test(symbol)) {
    return NextResponse.json({ error: "Invalid or missing symbol" }, { status: 400 });
  }

  try {
    const firstTradeDate = await fetchFirstTradeDate(symbol);
    return NextResponse.json({ symbol, firstTradeDate });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Metadata fetch failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
